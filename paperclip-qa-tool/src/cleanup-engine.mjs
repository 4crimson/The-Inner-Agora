import { PaperclipApiError } from "./paperclip-client.mjs";

const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

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

export async function cleanupPaperclipIssues({ client, manifest, mode = "hard", now = new Date(), dryRun = false }) {
  const actions = [];
  const residuals = [];
  if (mode === "none") return { actions, residuals };

  for (const issue of paperclipCleanupOrder(manifest.paperclip?.issues || [])) {
    if (!issue?.id) continue;
    if (mode === "hard") {
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
  return { actions, residuals };
}
