export function issueRef(issue) {
  return issue?.identifier || issue?.id || "";
}

export function issueNumber(issue) {
  const direct = Number(issue?.issueNumber);
  if (Number.isFinite(direct)) return direct;
  const match = String(issueRef(issue)).match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export function byIssueNumber(left, right) {
  const delta = issueNumber(left) - issueNumber(right);
  if (delta) return delta;
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
}

export function byRecentIssue(left, right) {
  const leftTime = Date.parse(left?.updatedAt || left?.createdAt || "") || 0;
  const rightTime = Date.parse(right?.updatedAt || right?.createdAt || "") || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return issueNumber(right) - issueNumber(left);
}

export function isSynthesisIssue(issue, pattern = "^Синтез:|^Synthesis:") {
  return new RegExp(pattern || "^Синтез:|^Synthesis:", "i").test(String(issue?.title || ""));
}

export function terminalStatusSet(statuses = []) {
  const configured = Array.isArray(statuses) ? statuses : [];
  const values = configured.length ? configured : ["done", "blocked", "cancelled"];
  return new Set(values.map((item) => String(item).trim().toLowerCase()).filter(Boolean));
}

export function isTerminalIssue(issue, statuses = terminalStatusSet()) {
  return statuses.has(String(issue?.status || "").toLowerCase());
}

export function childrenOf(root, issues) {
  return issues.filter((issue) => issue.parentId === root.id && !issue.hiddenAt).sort(byIssueNumber);
}

export function voiceLabel(child) {
  const titleName = String(child.title || "").split(":", 1)[0].trim();
  if (titleName && !/^синтез$/i.test(titleName)) return titleName.split("/")[0].trim();
  return issueRef(child);
}

export function callbackData(name, arg, prefix = "pc") {
  return `${prefix || "pc"}:${name}:${arg}`;
}

export function buttonRows(buttons, { prefix = "pc", fallbackArg = "help" } = {}) {
  const prepared = buttons
    .map((button) => {
      const text = String(button?.label || button?.text || "").trim();
      const callback = String(button?.callback || button?.name || "").trim();
      const arg = String(button?.arg || fallbackArg || "help").trim() || "help";
      if (!text || !callback) return null;
      return { text: text.slice(0, 32), callback_data: callbackData(callback, arg, prefix) };
    })
    .filter(Boolean);
  const rows = [];
  for (let index = 0; index < prepared.length; index += 2) rows.push(prepared.slice(index, index + 2));
  return { inline_keyboard: rows };
}
