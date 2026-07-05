import { oneLine } from "./text-utils.mjs";

const ISSUE_REF_RE = /\b([A-Z][A-Z0-9]{1,12}-\d+)\b/i;
const DEFAULT_ISSUE_PREFIX = process.env.INNER_AGORA_ISSUE_PREFIX || "THE";

export const terminalStatuses = new Set(["done", "blocked", "cancelled"]);
export const allowedMoveStatuses = new Set(["todo", "in_progress", "blocked", "done", "cancelled"]);

export function compactIssueLine(issue, agentById = new Map()) {
  const id = issue.identifier || issue.id;
  const assignee = issue.assigneeAgentId ? agentById.get(issue.assigneeAgentId)?.name || "assigned" : "-";
  const parent = issue.parentId ? " child" : " root";
  return `- ${String(issue.status || "unknown").padEnd(11)} ${id.padEnd(7)}${parent} assignee=${assignee} ${issue.title}`;
}

export function issueNumber(issue) {
  const direct = Number(issue?.issueNumber);
  if (Number.isFinite(direct)) return direct;
  const match = String(issue?.identifier || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function byIssueNumber(left, right) {
  const delta = issueNumber(left) - issueNumber(right);
  if (delta) return delta;
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
}

export function bareIssueRef(raw) {
  if (!DEFAULT_ISSUE_PREFIX) return "";
  const match = String(raw || "").match(/\b(\d{1,7})\b/);
  return match ? `${DEFAULT_ISSUE_PREFIX.toUpperCase()}-${match[1]}` : "";
}

export function latestIssueRef(args) {
  const raw = args.join(" ");
  const match = raw.match(ISSUE_REF_RE);
  return match ? match[1].toUpperCase() : bareIssueRef(raw);
}

export function withoutIssueRef(raw) {
  let text = String(raw || "").replace(ISSUE_REF_RE, " ");
  if (DEFAULT_ISSUE_PREFIX) text = text.replace(/\b\d{1,7}\b/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function childrenOf(issue, allIssues) {
  return allIssues.filter((item) => item.parentId === issue.id && !item.hiddenAt).sort(byIssueNumber);
}

export function isSynthesisIssue(issue, assistantId = "") {
  if (!issue) return false;
  const title = String(issue.title || "");
  if (/^Синтез:/i.test(title)) return true;
  return Boolean(assistantId && issue.assigneeAgentId === assistantId && /\b(синтез|synthesis|summary|итог)\b/i.test(title));
}

export function latestSynthesisChild(issue, allIssues, agora) {
  return [...childrenOf(issue, allIssues)]
    .reverse()
    .find((child) => isSynthesisIssue(child, agora.assistant.id));
}

export function displayStatus(status) {
  const labels = {
    todo: "ожидает",
    in_progress: "в работе",
    blocked: "заблокировано",
    done: "готово",
    cancelled: "отменено",
    queued: "в очереди",
  };
  return labels[status] ? `${labels[status]} (${status})` : status || "unknown";
}

export function displayTitle(issue) {
  let title = String(issue?.title || "").trim();
  title = title.replace(/^(Синтез:\s*){2,}/i, "Синтез: ");
  return oneLine(title, 220);
}

export function issueKind(issue, assistantId = "") {
  if (isSynthesisIssue(issue, assistantId)) return "синтез";
  if (issue?.parentId) return "подзадача";
  return "пакет";
}

export function issueByIdMap(issues) {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

export function rootFromMap(issue, byId) {
  let current = issue;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId) || current;
    if (seen.has(current.id)) break;
  }
  return current;
}

export function voiceChildren(root, allIssues, agora) {
  return childrenOf(root, allIssues).filter((child) => !isSynthesisIssue(child, agora.assistant.id));
}
