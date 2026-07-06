import { PaperclipApiError } from "./paperclip-client.mjs";
import { TelegramUserbotError } from "./telegram-userbot.mjs";

const TERMINAL_STATUSES = new Set(["done", "cancelled"]);
const TERMINAL_RUN_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "error",
  "failed",
  "success",
  "succeeded",
  "timed_out",
  "timeout",
]);

function issueDepth(issue, byId, seen = new Set()) {
  if (!issue?.parentId || seen.has(issue.id)) return 0;
  seen.add(issue.id);
  const parent = byId.get(issue.parentId);
  return 1 + issueDepth(parent, byId, seen);
}

export function paperclipCleanupOrder(issues) {
  const byId = new Map((issues || []).map((issue) => [issue.id, issue]));
  return [...(issues || [])].sort((left, right) => {
    const depthDelta = issueDepth(right, byId) - issueDepth(left, byId);
    if (depthDelta) return depthDelta;
    return String(left.identifier || left.id).localeCompare(String(right.identifier || right.id));
  });
}

function fallbackPatchBody(issue, now) {
  const body = { hiddenAt: now.toISOString() };
  if (!TERMINAL_STATUSES.has(String(issue.status || "").toLowerCase())) body.status = "cancelled";
  return body;
}

function activeRunStabilizationBody(issue, now) {
  return {
    ...fallbackPatchBody(issue, now),
    assigneeAgentId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
  };
}

function shouldStabilizeActiveRunIssue(issue) {
  return Boolean(
    issue?.assigneeAgentId
      || issue?.checkoutRunId
      || issue?.executionRunId
      || issue?.executionAgentNameKey
      || issue?.executionLockedAt
      || String(issue?.status || "").toLowerCase() === "in_progress",
  );
}

export function isActivePaperclipRun(run) {
  return !TERMINAL_RUN_STATUSES.has(String(run?.status || "").toLowerCase());
}

function compactRun(run) {
  return {
    id: run?.id || run?.runId || run?.heartbeatRunId || "",
    status: run?.status || "",
    phase: run?.phase || "",
    startedAt: run?.startedAt || run?.started_at || "",
  };
}

async function activeRunsBeforeCleanup({ client, issue }) {
  if (typeof client.listIssueRuns !== "function") return [];
  const runs = await client.listIssueRuns(issue.id);
  if (!Array.isArray(runs)) return [];
  return runs.filter(isActivePaperclipRun).map(compactRun);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cancelActiveRuns({ client, issue, activeRuns, actions }) {
  const cancelledRuns = [];
  if (typeof client.cancelHeartbeatRun !== "function") return cancelledRuns;
  for (const run of activeRuns) {
    const runId = run.id;
    if (!runId) continue;
    const action = {
      type: "paperclip",
      method: "CANCEL_RUN",
      issueId: issue.id,
      ref: issue.identifier || issue.id,
      runId,
      runStatus: run.status,
    };
    actions.push(action);
    try {
      const result = await client.cancelHeartbeatRun(runId);
      action.ok = true;
      action.resultStatus = result?.status || "";
      cancelledRuns.push({
        issueId: issue.id,
        ref: issue.identifier || issue.id,
        runId,
        statusBefore: run.status,
        statusAfter: result?.status || "",
      });
    } catch (error) {
      action.ok = false;
      action.error = error instanceof PaperclipApiError ? error.message : String(error?.message || error);
      cancelledRuns.push({
        issueId: issue.id,
        ref: issue.identifier || issue.id,
        runId,
        statusBefore: run.status,
        error: action.error,
      });
    }
  }
  return cancelledRuns;
}

async function waitForTerminalRuns({ client, issue, attempts, delayMs }) {
  let activeRuns = [];
  const totalAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    activeRuns = await activeRunsBeforeCleanup({ client, issue });
    if (!activeRuns.length) return { ok: true, activeRuns: [], attempts: attempt + 1 };
    if (delayMs > 0 && attempt < totalAttempts - 1) await sleep(delayMs);
  }
  return { ok: false, activeRuns, attempts: totalAttempts };
}

async function stabilizeActiveRunIssue({ client, issue, now, actions, residuals }) {
  if (!shouldStabilizeActiveRunIssue(issue)) return;
  const body = activeRunStabilizationBody(issue, now);
  const action = { type: "paperclip", method: "PATCH", issueId: issue.id, ref: issue.identifier || issue.id, body };
  actions.push(action);
  try {
    await client.patchIssue(issue.id, body);
    action.ok = true;
  } catch (error) {
    action.ok = false;
    action.error = error instanceof PaperclipApiError ? error.message : String(error?.message || error);
    residuals.push({
      type: "paperclip",
      kind: "paperclip",
      issueId: issue.id,
      id: issue.identifier || issue.id,
      ref: issue.identifier || issue.id,
      reason: "active-run-stabilization-failed",
      error: action.error,
    });
  }
}

function pushActiveRunBlocked({ issue, activeRuns, actions, residuals, waitAttempts = 0 }) {
  actions.push({
    type: "paperclip",
    method: "SKIP_DELETE_ACTIVE_RUNS",
    issueId: issue.id,
    ref: issue.identifier || issue.id,
    activeRuns,
    ok: false,
    blocked: true,
    waitAttempts,
  });
  residuals.push({
    type: "paperclip",
    kind: "paperclip",
    issueId: issue.id,
    id: issue.identifier || issue.id,
    ref: issue.identifier || issue.id,
    reason: "active-runs-before-cleanup",
    activeRuns,
    waitAttempts,
  });
}

export async function cleanupPaperclipIssues({
  client,
  manifest,
  mode = "hard",
  now = new Date(),
  dryRun = false,
  runWaitAttempts = 4,
  runWaitDelayMs = 1000,
}) {
  const actions = [];
  const residuals = [];
  const activeRunsBeforeCleanupRecords = [];
  const cancelledRuns = [];
  if (mode === "none") return { actions, residuals, activeRunsBeforeCleanup: activeRunsBeforeCleanupRecords, cancelledRuns };

  for (const issue of paperclipCleanupOrder(manifest.paperclip?.issues || [])) {
    if (!issue?.id) continue;
    if (mode === "hard") {
      if (!dryRun) {
        let activeRuns = [];
        try {
          activeRuns = await activeRunsBeforeCleanup({ client, issue });
        } catch (error) {
          const message = error instanceof PaperclipApiError ? error.message : String(error?.message || error);
          const action = {
            type: "paperclip",
            method: "SKIP_DELETE_RUN_CHECK_FAILED",
            issueId: issue.id,
            ref: issue.identifier || issue.id,
            ok: false,
            blocked: true,
            error: message,
          };
          actions.push(action);
          residuals.push({
            type: "paperclip",
            kind: "paperclip",
            issueId: issue.id,
            id: issue.identifier || issue.id,
            ref: issue.identifier || issue.id,
            reason: "live-run-check-failed",
            error: message,
          });
          continue;
        }
        if (activeRuns.length) {
          const record = { issueId: issue.id, ref: issue.identifier || issue.id, runs: activeRuns };
          activeRunsBeforeCleanupRecords.push(record);
          await stabilizeActiveRunIssue({ client, issue, now, actions, residuals });
          const cancelled = await cancelActiveRuns({ client, issue, activeRuns, actions });
          cancelledRuns.push(...cancelled);
          const wait = await waitForTerminalRuns({
            client,
            issue,
            attempts: runWaitAttempts,
            delayMs: Math.max(0, Number(runWaitDelayMs) || 0),
          });
          if (!wait.ok) {
            pushActiveRunBlocked({ issue, activeRuns: wait.activeRuns, actions, residuals, waitAttempts: wait.attempts });
            continue;
          }
        }
      }
      const deleteAction = { type: "paperclip", method: "DELETE", issueId: issue.id, ref: issue.identifier || issue.id };
      actions.push(deleteAction);
      if (!dryRun) {
        try {
          await client.deleteIssue(issue.id);
          deleteAction.ok = true;
          continue;
        } catch (error) {
          deleteAction.ok = false;
          deleteAction.error = error instanceof PaperclipApiError ? error.message : String(error?.message || error);
        }
      }
    }

    const body = fallbackPatchBody(issue, now);
    const patchAction = { type: "paperclip", method: "PATCH", issueId: issue.id, ref: issue.identifier || issue.id, body };
    actions.push(patchAction);
    if (!dryRun) {
      try {
        await client.patchIssue(issue.id, body);
        patchAction.ok = true;
      } catch (error) {
        patchAction.ok = false;
        patchAction.error = error instanceof PaperclipApiError ? error.message : String(error?.message || error);
        residuals.push({ type: "paperclip", issueId: issue.id, ref: issue.identifier || issue.id, error: patchAction.error });
      }
    }
  }
  return { actions, residuals, activeRunsBeforeCleanup: activeRunsBeforeCleanupRecords, cancelledRuns };
}

export function telegramMessageIds(manifest) {
  const ids = [];
  for (const message of manifest.telegram?.messages || []) {
    const raw = message?.messageId ?? message?.id;
    const id = Number(raw);
    if (Number.isInteger(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

export function cleanupTelegramMessages({ userbot, manifest, mode = "hard", dryRun = false }) {
  const actions = [];
  const residuals = [];
  if (mode === "none") return { actions, residuals };

  const messageIds = telegramMessageIds(manifest);
  if (!messageIds.length) return { actions, residuals };

  const action = { type: "telegram", method: "delete", messageIds };
  actions.push(action);
  if (dryRun) {
    action.ok = true;
    action.dryRun = true;
    return { actions, residuals };
  }

  try {
    userbot.deleteMessages({ ids: messageIds });
    action.ok = true;
  } catch (error) {
    action.ok = false;
    action.error = error instanceof TelegramUserbotError ? error.message : String(error?.message || error);
    residuals.push({ type: "telegram", messageIds, error: action.error });
  }
  return { actions, residuals };
}
