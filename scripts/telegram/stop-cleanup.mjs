import {
  childrenOf as defaultChildrenOf,
  isTerminalIssue,
  issueRef as defaultIssueRef,
  terminalStatusSet,
} from "./payload-utils.mjs";

export function isActiveRun(run) {
  return !["succeeded", "failed", "cancelled", "timed_out"].includes(String(run?.status || "").toLowerCase());
}

export async function issueLiveRuns(issue, { api, issueRef = defaultIssueRef } = {}) {
  try {
    const runs = await api(`/issues/${issue.id || issueRef(issue)}/live-runs`);
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

export async function cancelHeartbeatRun(run, { api } = {}) {
  return api(`/heartbeat-runs/${run.id}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function cancelAndHideIssue(issue, hiddenAt, { api, issueRef = defaultIssueRef } = {}) {
  return api(`/issues/${issue.id || issueRef(issue)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", hiddenAt }),
  });
}

export async function stopCleanup(
  root,
  issues,
  {
    api,
    hiddenAt = new Date().toISOString(),
    childrenOf = defaultChildrenOf,
    issueRef = defaultIssueRef,
    isTerminal = (issue) => isTerminalIssue(issue, terminalStatusSet()),
  } = {},
) {
  if (!root) return { hiddenAt, targets: [], failures: [] };
  const targets = [root, ...childrenOf(root, issues).filter((issue) => !isTerminal(issue))];
  const failures = [];
  for (const issue of targets) {
    const runs = await issueLiveRuns(issue, { api, issueRef });
    for (const run of runs.filter(isActiveRun)) {
      try {
        await cancelHeartbeatRun(run, { api });
      } catch (error) {
        failures.push({ issue, error });
      }
    }
    try {
      await cancelAndHideIssue(issue, hiddenAt, { api, issueRef });
    } catch (error) {
      failures.push({ issue, error });
    }
  }
  return { hiddenAt, targets, failures };
}
