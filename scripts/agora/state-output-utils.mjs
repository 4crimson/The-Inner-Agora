import { costSummaryLine } from "./cost-utils.mjs";

export function issueStatePatch(issue, patch = {}, { now = new Date().toISOString() } = {}) {
  if (!issue) return null;
  return {
    ...patch,
    lastIssueRef: issue.identifier || issue.id,
    lastIssueId: issue.id,
    lastIssueTitle: issue.title || "",
    lastIssueStatus: issue.status || "",
    lastIssueSeenAt: now,
  };
}

export function decoratedCostLogEntries(extracted, context = {}, state = {}, command = "") {
  const entries = Array.isArray(extracted?.costLog) ? extracted.costLog : [];
  return entries.map((entry) => ({
    ...entry,
    command,
    rootIssueRef: context.lastRootIssueRef || state.lastRootIssueRef || "",
    synthesisRef: context.lastSynthesisRef || state.lastSynthesisRef || "",
  }));
}

export function costSummaryOutputLines(state = {}, { markdown = false } = {}) {
  const line = costSummaryLine(state);
  if (!line) return [];
  return [
    markdown ? "## Стоимость и токены" : "Стоимость и токены:",
    `- ${line}`,
    "",
  ];
}

export function activeChamberOutputLines(chamber = {}) {
  return [
    `activeChamberId=${chamber.id}`,
    `activeChamberName=${chamber.name}`,
  ];
}

export function modeOutputLines({ mode = "", adapter = {}, statePath = "", state = {} } = {}) {
  const lines = [
    `mode=${mode}`,
    `adapter=${adapter.name}`,
    `model=${adapter.model}`,
    `reason=${adapter.reason}`,
    `state=${statePath}`,
  ];
  if (state.updatedAt) lines.push(`updatedAt=${state.updatedAt}`);
  return lines;
}
