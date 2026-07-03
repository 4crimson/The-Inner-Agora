#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = process.env.PAPERCLIP_COCKPIT_CONFIG || path.join(ROOT, "paperclip-cockpit.json");
const API_BASE = (process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api").replace(/\/$/, "");
const DEFAULT_TERMINAL_STATUSES = new Set(["done", "blocked", "cancelled"]);

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/paperclip-cockpit-monitor.mjs once [--root ISSUE] [--dry-run] [--json]
  node scripts/paperclip-cockpit-monitor.mjs watch [--interval SECONDS] [--dry-run]
  node scripts/paperclip-cockpit-monitor.mjs install [--dry-run] [--json]
  node scripts/paperclip-cockpit-monitor.mjs status [--json]
  node scripts/paperclip-cockpit-monitor.mjs uninstall [--dry-run] [--json]

The monitor is config-driven:
  monitor.synthesis_action defaults to "synth"
  monitor.notify.exec defaults to "node scripts/paperclip-cockpit-telegram.mjs send-result {issue}"
`);
  process.exit(exitCode);
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

const config = readJson(CONFIG_PATH);
const monitor = config.monitor && typeof config.monitor === "object" ? config.monitor : {};
const statePath = path.resolve(config.cwd || ROOT, monitor.state_file || ".paperclip-cockpit-monitor-state.json");

function sanitizeLabelPart(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

function launchdConfig() {
  return monitor.launchd && typeof monitor.launchd === "object" ? monitor.launchd : {};
}

function launchdLabel() {
  const launchd = launchdConfig();
  if (launchd.label || monitor.launchd_label) return String(launchd.label || monitor.launchd_label);
  const profile = config.telegram?.profile || config.command?.name || path.basename(config.cwd || ROOT);
  return `local.paperclip-cockpit.${sanitizeLabelPart(profile)}`;
}

function launchdPlistPath(label = launchdLabel()) {
  const launchd = launchdConfig();
  const configured = launchd.plist_path || monitor.launchd_plist_path;
  if (configured) return path.resolve(String(configured).replace(/^~(?=$|\/)/, os.homedir()));
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function launchdLogDir() {
  const launchd = launchdConfig();
  const profile = sanitizeLabelPart(config.telegram?.profile || config.command?.name || "default");
  const configured = launchd.log_dir || monitor.log_dir;
  if (configured) return path.resolve(String(configured).replace(/^~(?=$|\/)/, os.homedir()));
  return path.join(os.homedir(), "Library", "Logs", "paperclip-cockpit", profile);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plistArray(values) {
  return [
    "<array>",
    ...values.map((value) => `    <string>${xmlEscape(value)}</string>`),
    "  </array>",
  ].join("\n  ");
}

function plistEnvironment(env) {
  const lines = ["<dict>"];
  for (const [key, value] of Object.entries(env)) {
    if (value == null || value === "") continue;
    lines.push(`    <key>${xmlEscape(key)}</key>`);
    lines.push(`    <string>${xmlEscape(value)}</string>`);
  }
  lines.push("  </dict>");
  return lines.join("\n  ");
}

function launchdSpec() {
  const label = launchdLabel();
  const plistPath = launchdPlistPath(label);
  const logDir = launchdLogDir();
  const interval = Math.max(10, Number(monitor.interval_seconds || 60));
  const programArguments = [process.execPath, fileURLToPath(import.meta.url), "watch", "--interval", String(interval)];
  const env = {
    PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: os.homedir(),
    PAPERCLIP_COCKPIT_CONFIG: CONFIG_PATH,
    PAPERCLIP_API_BASE: API_BASE,
    HERMES_PROFILE: config.telegram?.profile || process.env.HERMES_PROFILE || "",
  };
  return {
    label,
    plistPath,
    logDir,
    programArguments,
    stdout: path.join(logDir, `${label}.out.log`),
    stderr: path.join(logDir, `${label}.err.log`),
    workingDirectory: config.cwd || ROOT,
    env,
  };
}

function renderLaunchdPlist(spec) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(spec.label)}</string>
  <key>ProgramArguments</key>
  ${plistArray(spec.programArguments)}
  <key>WorkingDirectory</key>
  <string>${xmlEscape(spec.workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  ${plistEnvironment(spec.env)}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(spec.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(spec.stderr)}</string>
</dict>
</plist>
`;
}

function launchctl(args, options = {}) {
  return spawnSync("launchctl", args, {
    encoding: "utf8",
    ...options,
  });
}

function guiDomain() {
  return `gui/${process.getuid()}`;
}

function issueRef(issue) {
  return issue?.identifier || issue?.id || "";
}

function issueNumber(issue) {
  const direct = Number(issue?.issueNumber);
  if (Number.isFinite(direct)) return direct;
  const match = String(issueRef(issue)).match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function byIssueNumber(left, right) {
  const delta = issueNumber(left) - issueNumber(right);
  if (delta) return delta;
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
}

function isTerminal(issue) {
  const statuses = new Set([...(monitor.terminal_statuses || [])].map((item) => String(item).trim().toLowerCase()).filter(Boolean));
  const terminal = statuses.size ? statuses : DEFAULT_TERMINAL_STATUSES;
  return terminal.has(String(issue?.status || "").toLowerCase());
}

function isVisible(issue) {
  return Boolean(issue && !issue.hiddenAt && !issue.deletedAt);
}

function isSynthesis(issue) {
  const pattern = monitor.synthesis_title_pattern || config.telegram?.synthesis_title_pattern || "^Синтез:|^Synthesis:";
  return new RegExp(pattern, "i").test(String(issue?.title || ""));
}

function rootStateKey(root) {
  return issueRef(root) || root?.id || "";
}

function childrenFingerprint(children) {
  return children
    .map((issue) => `${issue.id}:${issue.status}:${issue.updatedAt || issue.lastActivityAt || ""}`)
    .sort()
    .join("|");
}

function formatTemplate(value, vars) {
  return String(value).replace(/\{([a-z0-9_]+)\}/gi, (_, key) => (vars[key] == null ? "" : String(vars[key])));
}

function actionCommand(action, vars, extraArgs = []) {
  const raw = action?.exec || action?.command;
  let command = [];
  if (Array.isArray(raw)) command = raw.map(String);
  else if (typeof raw === "string") command = raw.split(/\s+/).filter(Boolean);
  command = command.map((item) => formatTemplate(item, vars));
  if (action?.append_args !== false) command.push(...extraArgs.map(String));
  return command;
}

function projectAction(name, vars, extraArgs = []) {
  const action = config.actions?.[name];
  if (!action) throw new Error(`Project action is not configured: ${name}`);
  return actionCommand(action, vars, extraArgs);
}

function notifyCommand(vars) {
  const notify = monitor.notify && typeof monitor.notify === "object" ? monitor.notify : {};
  const configured = notify.exec || notify.command;
  const action = configured
    ? { ...notify, exec: configured, append_args: false }
    : { exec: ["node", "scripts/paperclip-cockpit-telegram.mjs", "send-result", "{issue}"], append_args: false };
  return actionCommand(action, vars);
}

function progressNotifyCommand(vars) {
  const notify = monitor.progress_notify && typeof monitor.progress_notify === "object" ? monitor.progress_notify : {};
  const configured = notify.exec || notify.command;
  const action = configured
    ? { ...notify, exec: configured, append_args: false }
    : { exec: ["node", "scripts/paperclip-cockpit-telegram.mjs", "send-progress", "{root}"], append_args: false };
  return actionCommand(action, vars);
}

function progressFingerprint(voiceChildren) {
  const voices = [...voiceChildren].sort(byIssueNumber);
  const doneCount = voices.filter(isTerminal).length;
  const statusParts = voices.map((issue) => `${issueRef(issue)}:${String(issue.status || "").toLowerCase()}`);
  return `${doneCount}/${voices.length}:${statusParts.join("|")}`;
}

function runCommand(command, label, dryRun) {
  if (!command.length) throw new Error(`${label} command is empty`);
  if (dryRun) return { ok: true, dryRun: true, command };
  const result = spawnSync(command[0], command.slice(1), {
    cwd: config.cwd || ROOT,
    encoding: "utf8",
    timeout: Number(monitor.timeout_seconds || 900) * 1000,
    env: process.env,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status !== 0) throw new Error(output || `${command.join(" ")} exited ${result.status}`);
  return { ok: true, command, output };
}

async function api(pathname, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
  return data;
}

async function rootOf(issue) {
  let current = issue;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = await api(`/issues/${current.parentId}`);
  }
  return current;
}

function childrenOf(root, issues) {
  return issues.filter((issue) => issue.parentId === root.id && isVisible(issue)).sort(byIssueNumber);
}

function latestSynthesis(children) {
  return children.filter(isSynthesis).sort(byIssueNumber).at(-1) || null;
}

function dispositionAutoFinalizeConfig() {
  const raw = monitor.auto_finalize_disposition_waits || monitor.disposition_auto_finalize;
  if (raw === true) return { enabled: true };
  if (raw && typeof raw === "object") return { enabled: raw.enabled !== false, ...raw };
  return { enabled: false };
}

function terminalLiveRunCleanupConfig() {
  const raw = monitor.cancel_terminal_live_runs || monitor.terminal_live_run_cleanup;
  if (raw === true) return { enabled: true };
  if (raw && typeof raw === "object") return { enabled: raw.enabled !== false, ...raw };
  return { enabled: false };
}

function commentBody(comment) {
  return String(comment?.body || "").trim();
}

function matchesPattern(value, pattern) {
  try {
    return new RegExp(pattern, "i").test(String(value || ""));
  } catch {
    return /needs a disposition/i.test(String(value || ""));
  }
}

async function issueComments(issue) {
  return api(`/issues/${issue.id || issueRef(issue)}/comments`);
}

async function issueLiveRuns(issue) {
  try {
    const runs = await api(`/issues/${issue.id || issueRef(issue)}/live-runs`);
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

function isLiveRun(run) {
  return !["succeeded", "failed", "cancelled", "timed_out"].includes(String(run?.status || "").toLowerCase());
}

async function cancelHeartbeatRun(run, dryRun) {
  if (dryRun) return { ok: true, dryRun: true, id: run?.id };
  return api(`/heartbeat-runs/${run.id}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function forceReleaseIssue(issue, dryRun) {
  if (dryRun) return { ok: true, dryRun: true };
  return api(`/issues/${issue.id || issueRef(issue)}/admin/force-release`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function releaseIssueAssignee(issue, dryRun) {
  if (dryRun) return { ok: true, dryRun: true };
  return api(`/issues/${issue.id || issueRef(issue)}/release`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function updateIssueStatus(issue, status, dryRun, patch = {}) {
  const body = { status, ...patch };
  if (dryRun) return { ok: true, dryRun: true, ...body };
  return api(`/issues/${issue.id || issueRef(issue)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function addIssueComment(issue, body, dryRun) {
  const text = String(body || "").trim();
  if (!text || dryRun) return null;
  return api(`/issues/${issue.id || issueRef(issue)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: text }),
  });
}

async function autoFinalizeDispositionWaits(children, options) {
  const disposition = dispositionAutoFinalizeConfig();
  if (!disposition.enabled) return [];

  const targetStatus = String(disposition.status || "done");
  const minAgentCommentChars = Math.max(1, Number(disposition.min_agent_comment_chars || 80));
  const systemPattern = disposition.system_comment_pattern || "needs a disposition";
  const commentTemplate =
    disposition.comment ||
    "Auto-finalized by Paperclip cockpit monitor: agent output exists and Paperclip is waiting for a disposition.";
  const cancelLiveRuns = disposition.cancel_live_runs !== false;
  const forceReleaseAfterCancel = disposition.force_release_after_cancel !== false;
  const releaseAssigneeAfterCancel = disposition.release_assignee_after_cancel !== false;
  const operations = [];

  for (const issue of children.filter((child) => !isTerminal(child))) {
    let fullIssue = issue;
    try {
      fullIssue = await api(`/issues/${issueRef(issue) || issue.id}`);
    } catch {
      fullIssue = issue;
    }
    const comments = await issueComments(fullIssue);
    const needsDisposition =
      fullIssue?.successfulRunHandoff?.required === true ||
      comments.some((comment) => String(comment?.authorType || "").toLowerCase() === "system" && matchesPattern(commentBody(comment), systemPattern));
    const agentOutput = comments
      .filter((comment) => String(comment?.authorType || "").toLowerCase() === "agent")
      .map(commentBody)
      .find((body) => body.length >= minAgentCommentChars);

    if (!needsDisposition || !agentOutput) continue;

    let cancelledLiveRuns = [];
    if (cancelLiveRuns) {
      cancelledLiveRuns = (await issueLiveRuns(fullIssue)).filter(isLiveRun);
      for (const run of cancelledLiveRuns) {
        await cancelHeartbeatRun(run, options.dryRun);
        operations.push({
          type: "cancel_live_run",
          issue: issueRef(issue),
          run: run.id,
          status: run.status,
          dryRun: options.dryRun,
          reason: "agent-output-needs-disposition",
        });
      }
      if (cancelledLiveRuns.length && forceReleaseAfterCancel) {
        await forceReleaseIssue(fullIssue, options.dryRun);
        operations.push({
          type: "force_release_issue",
          issue: issueRef(issue),
          dryRun: options.dryRun,
          reason: "agent-output-needs-disposition",
        });
      }
      if (cancelledLiveRuns.length && releaseAssigneeAfterCancel) {
        await releaseIssueAssignee(fullIssue, options.dryRun);
        operations.push({
          type: "release_issue_assignee",
          issue: issueRef(issue),
          dryRun: options.dryRun,
          reason: "agent-output-needs-disposition",
        });
      }
    }

    const finalizePatch =
      disposition.clear_execution_lock === false
        ? {}
        : {
            checkoutRunId: null,
            executionRunId: null,
            executionLockedAt: null,
            completedAt: new Date().toISOString(),
          };
    if (cancelledLiveRuns.length && disposition.clear_assignee_after_cancel !== false) {
      finalizePatch.assigneeAgentId = null;
      finalizePatch.assigneeUserId = null;
      finalizePatch.assigneeAdapterOverrides = null;
    }
    const updated = await updateIssueStatus(fullIssue, targetStatus, options.dryRun, finalizePatch);
    await addIssueComment(fullIssue, commentTemplate, options.dryRun);
    issue.status = targetStatus;
    issue.updatedAt = updated?.updatedAt || new Date().toISOString();
    operations.push({
      type: "auto_finalize_disposition_wait",
      issue: issueRef(issue),
      status: targetStatus,
      dryRun: options.dryRun,
      reason: "agent-output-needs-disposition",
    });
  }

  return operations;
}

async function cancelTerminalLiveRuns(children, options) {
  const cleanup = terminalLiveRunCleanupConfig();
  if (!cleanup.enabled) return [];

  const disposition = dispositionAutoFinalizeConfig();
  const markerPattern =
    cleanup.comment_pattern ||
    disposition.system_comment_pattern ||
    "needs a disposition|Auto-finalized by Paperclip cockpit monitor|Автоматически закрыто через Paperclip cockpit monitor";
  const requireMarker = cleanup.only_with_disposition_marker !== false;
  const operations = [];

  for (const issue of children.filter((child) => isTerminal(child))) {
    const liveRuns = (await issueLiveRuns(issue)).filter(isLiveRun);
    if (!liveRuns.length) continue;

    if (requireMarker) {
      let comments = [];
      try {
        comments = await issueComments(issue);
      } catch {
        comments = [];
      }
      if (!comments.some((comment) => matchesPattern(commentBody(comment), markerPattern))) continue;
    }

    for (const run of liveRuns) {
      await cancelHeartbeatRun(run, options.dryRun);
      operations.push({
        type: "cancel_terminal_live_run",
        issue: issueRef(issue),
        run: run.id,
        status: run.status,
        dryRun: options.dryRun,
        reason: "terminal-issue-has-live-run",
      });
    }
  }

  return operations;
}

function freshState() {
  return { version: 1, activatedAt: new Date().toISOString(), roots: {} };
}

function loadState() {
  const state = readJson(statePath, freshState());
  if (!state.activatedAt) state.activatedAt = new Date().toISOString();
  if (!state.roots || typeof state.roots !== "object") state.roots = {};
  return state;
}

function parseTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function ignoreExistingRoots() {
  if ("ignore_existing_roots" in monitor) return Boolean(monitor.ignore_existing_roots);
  if ("ignore_existing_on_start" in monitor) return Boolean(monitor.ignore_existing_on_start);
  return true;
}

function shouldSkipBackfillRoot(root, state, options) {
  if (options.root || !ignoreExistingRoots()) return false;
  const rootTime = parseTime(root?.createdAt);
  const activatedTime = parseTime(state.activatedAt);
  return Boolean(rootTime && activatedTime && rootTime < activatedTime);
}

function companyMatches(company) {
  const hints = [
    ...(Array.isArray(config.company_hints) ? config.company_hints : []),
    process.env.PAPERCLIP_DEFAULT_COMPANY || "",
    process.env.PAPERCLIP_COMPANY_NAME || "",
  ]
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  if (!hints.length) return true;
  const name = String(company?.name || "").toLowerCase();
  const prefix = String(company?.issuePrefix || "").toLowerCase();
  return hints.some((hint) => name.includes(hint) || hint.includes(name) || hint === prefix);
}

async function rootsToScan(rootArg) {
  if (rootArg) {
    const issue = await api(`/issues/${rootArg}`);
    const root = await rootOf(issue);
    const issues = await api(`/companies/${root.companyId}/issues`);
    return [{ root, issues }];
  }

  const companies = (await api("/companies")).filter(companyMatches);
  const limit = Number(monitor.max_roots || 20);
  const roots = [];
  for (const company of companies) {
    const issues = await api(`/companies/${company.id}/issues`);
    for (const root of issues.filter((issue) => isVisible(issue) && !issue.parentId).sort(byIssueNumber).reverse()) {
      roots.push({ root, issues });
      if (roots.length >= limit) return roots;
    }
  }
  return roots;
}

async function inspectRoot(root, issues, state, options) {
  const children = childrenOf(root, issues);
  const synthesis = latestSynthesis(children);
  const voiceChildren = children.filter((issue) => issue.id !== synthesis?.id && !isSynthesis(issue));
  const rootKey = rootStateKey(root);
  const rootState = state.roots[rootKey] || {};
  const operations = [];

  if (shouldSkipBackfillRoot(root, state, options)) {
    if (!rootState.ignoredExistingAt) {
      rootState.ignoredExistingAt = new Date().toISOString();
      rootState.ignoredExistingReason = "root-created-before-monitor-activation";
      state.roots[rootKey] = rootState;
    }
    operations.push({ type: "skip", root: issueRef(root), reason: "root-before-monitor-activation" });
    return operations;
  }

  if (!voiceChildren.length) {
    operations.push({ type: "skip", root: issueRef(root), reason: "no-visible-children" });
    return operations;
  }

  operations.push(...(await autoFinalizeDispositionWaits(voiceChildren, options)));
  operations.push(...(await cancelTerminalLiveRuns(voiceChildren, options)));

  const openChildren = voiceChildren.filter((issue) => !isTerminal(issue));
  if (openChildren.length) {
    const progress = progressFingerprint(voiceChildren);
    if (rootState.lastProgressFingerprint !== progress) {
      const command = progressNotifyCommand({ root: issueRef(root), issue: issueRef(root) });
      const run = runCommand(command, `progress ${issueRef(root)}`, options.dryRun);
      operations.push({ type: "progress_notify", root: issueRef(root), command, run });
      rootState.lastProgressFingerprint = progress;
      rootState.lastProgressAt = new Date().toISOString();
      state.roots[rootKey] = rootState;
    }
    operations.push({
      type: "wait",
      root: issueRef(root),
      open: openChildren.map((issue) => ({ issue: issueRef(issue), status: issue.status })),
    });
    return operations;
  }

  const fingerprint = childrenFingerprint(voiceChildren);
  if (!synthesis) {
    if (rootState.lastSynthFingerprint === fingerprint) {
      operations.push({ type: "skip", root: issueRef(root), reason: "synthesis-already-requested" });
      return operations;
    }
    const actionName = monitor.synthesis_action || "synth";
    const command = projectAction(actionName, { root: issueRef(root), issue: issueRef(root) }, [issueRef(root)]);
    const run = runCommand(command, `synthesis ${issueRef(root)}`, options.dryRun);
    operations.push({ type: "synthesize", root: issueRef(root), action: actionName, command, run });
    rootState.lastSynthFingerprint = fingerprint;
    rootState.lastSynthRequestedAt = new Date().toISOString();
    state.roots[rootKey] = rootState;
    return operations;
  }

  if (!isTerminal(synthesis)) {
    operations.push(...(await autoFinalizeDispositionWaits([synthesis], options)));
  }
  operations.push(...(await cancelTerminalLiveRuns([synthesis], options)));

  if (!isTerminal(synthesis)) {
    operations.push({ type: "wait", root: issueRef(root), synthesis: issueRef(synthesis), status: synthesis.status });
    return operations;
  }

  if (rootState.lastNotifiedSynthesisId === synthesis.id) {
    operations.push({ type: "skip", root: issueRef(root), synthesis: issueRef(synthesis), reason: "already-notified" });
    return operations;
  }

  const command = notifyCommand({ root: issueRef(root), issue: issueRef(synthesis), synthesis: issueRef(synthesis) });
  const run = runCommand(command, `notify ${issueRef(synthesis)}`, options.dryRun);
  operations.push({ type: "notify", root: issueRef(root), synthesis: issueRef(synthesis), command, run });
  rootState.lastNotifiedSynthesisId = synthesis.id;
  rootState.lastNotifiedAt = new Date().toISOString();
  state.roots[rootKey] = rootState;
  return operations;
}

async function once(options) {
  const state = loadState();
  const scans = await rootsToScan(options.root);
  const operations = [];
  for (const scan of scans) {
    operations.push(...(await inspectRoot(scan.root, scan.issues, state, options)));
  }
  if (!options.dryRun) writeJson(statePath, state);
  const summary = { dryRun: options.dryRun, statePath, scanned: scans.length, operations };
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`scanned=${summary.scanned} dryRun=${summary.dryRun}`);
    for (const operation of operations) {
      console.log(`${operation.type}: ${operation.root || ""} ${operation.synthesis || operation.reason || ""}`.trim());
    }
  }
  return summary;
}

function parseArgs(args) {
  const options = { dryRun: false, json: false, root: "", interval: Number(monitor.interval_seconds || 60) };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--root") options.root = args[++index] || "";
    else if (arg === "--interval") options.interval = Number(args[++index] || options.interval);
    else if (arg === "--help" || arg === "-h") usage(0);
  }
  return options;
}

async function watch(options) {
  const interval = Math.max(10, Number(options.interval || 60));
  for (;;) {
    try {
      await once(options);
    } catch (error) {
      console.error(error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

function printLaunchdResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${result.action}: ${result.label}`);
  console.log(`plist=${result.plistPath}`);
  if (result.loaded != null) console.log(`loaded=${result.loaded}`);
  if (result.pid != null) console.log(`pid=${result.pid || "-"}`);
}

function installLaunchd(options) {
  const spec = launchdSpec();
  const plist = renderLaunchdPlist(spec);
  const result = {
    action: "install",
    dryRun: options.dryRun,
    label: spec.label,
    plistPath: spec.plistPath,
    programArguments: spec.programArguments,
    workingDirectory: spec.workingDirectory,
    stdout: spec.stdout,
    stderr: spec.stderr,
  };
  if (options.dryRun) {
    result.plist = plist;
    printLaunchdResult(result, options);
    return result;
  }

  fs.mkdirSync(path.dirname(spec.plistPath), { recursive: true });
  fs.mkdirSync(spec.logDir, { recursive: true });
  fs.writeFileSync(spec.plistPath, plist, "utf8");

  launchctl(["bootout", guiDomain(), spec.plistPath]);
  const bootstrap = launchctl(["bootstrap", guiDomain(), spec.plistPath]);
  if (bootstrap.status !== 0) {
    throw new Error((bootstrap.stderr || bootstrap.stdout || "").trim() || `launchctl bootstrap exited ${bootstrap.status}`);
  }
  launchctl(["enable", `${guiDomain()}/${spec.label}`]);
  const kickstart = launchctl(["kickstart", "-k", `${guiDomain()}/${spec.label}`]);
  if (kickstart.status !== 0) {
    throw new Error((kickstart.stderr || kickstart.stdout || "").trim() || `launchctl kickstart exited ${kickstart.status}`);
  }
  const status = statusLaunchd({ silent: true });
  result.loaded = status.loaded;
  result.pid = status.pid;
  result.statusOutput = status.output;
  printLaunchdResult(result, options);
  return result;
}

function statusLaunchd(options) {
  const spec = launchdSpec();
  const list = launchctl(["list", spec.label]);
  const output = [list.stdout, list.stderr].filter(Boolean).join("\n").trim();
  const pidMatch = output.match(/"PID"\s*=\s*(\d+);/) || output.match(/PID\s*=\s*(\d+)/);
  const result = {
    action: "status",
    label: spec.label,
    plistPath: spec.plistPath,
    loaded: list.status === 0,
    pid: pidMatch ? Number(pidMatch[1]) : 0,
    output,
  };
  if (!options.silent) printLaunchdResult(result, options);
  return result;
}

function uninstallLaunchd(options) {
  const spec = launchdSpec();
  const result = {
    action: "uninstall",
    dryRun: options.dryRun,
    label: spec.label,
    plistPath: spec.plistPath,
  };
  if (options.dryRun) {
    printLaunchdResult(result, options);
    return result;
  }
  launchctl(["bootout", guiDomain(), spec.plistPath]);
  fs.rmSync(spec.plistPath, { force: true });
  result.loaded = false;
  printLaunchdResult(result, options);
  return result;
}

const [command = "once", ...tail] = process.argv.slice(2);
if (command === "--help" || command === "-h") usage(0);
const options = parseArgs(tail);

if (command === "once" || command === "scan") {
  once(options)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
} else if (command === "watch") {
  watch(options).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else if (command === "install") {
  try {
    installLaunchd(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (command === "status") {
  statusLaunchd(options);
} else if (command === "uninstall") {
  try {
    uninstallLaunchd(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  usage(1);
}
