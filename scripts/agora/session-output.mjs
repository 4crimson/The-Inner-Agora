import { displayTitle } from "./issue-utils.mjs";
import { roleScoreInText } from "./role-search.mjs";

export const DEFAULT_ASSISTANT_NAME = "Agora Assistant / Синтезатор";

export function commandVoiceName(child, agentById, { assistantName = DEFAULT_ASSISTANT_NAME } = {}) {
  const titleName = String(child?.title || "").split(":", 1)[0].trim();
  if (titleName && !/^синтез$/i.test(titleName)) return titleName.split("/")[0].trim();
  const assignee = child?.assigneeAgentId ? agentById.get(child.assigneeAgentId)?.name || "" : "";
  if (assignee && assignee !== assistantName) return assignee.split("/")[0].trim();
  return "";
}

export function sessionActionLines(root, philosopherChildren, synthesis, agentById) {
  const rootRef = root?.identifier || root?.id || "";
  if (!rootRef) return [];
  const voiceNames = philosopherChildren
    .map((child) => commandVoiceName(child, agentById))
    .filter(Boolean)
    .slice(0, 6);
  const lines = [
    "",
    "Дальше:",
    synthesis
      ? `- Синтез: /agora result ${synthesis.identifier || synthesis.id}`
      : `- Собрать синтез: /agora synth ${rootRef}`,
  ];
  for (const name of voiceNames) lines.push(`- ${name}: /agora voice ${name} ${rootRef}`);
  return lines;
}

export function voiceChildScore(child, philosopher, agentById) {
  const assignee = child.assigneeAgentId ? agentById.get(child.assigneeAgentId)?.name || "" : "";
  return roleScoreInText(philosopher, `${child.title || ""} ${assignee}`);
}

export function availableVoiceLines(children, agentById) {
  if (!children.length) return ["- В этой сессии пока нет отдельных философских задач."];
  return children.map((child) => {
    const assignee = child.assigneeAgentId ? agentById.get(child.assigneeAgentId)?.name || "" : "";
    const label = assignee || displayTitle(child);
    return `- ${label}: ${child.identifier || child.id}`;
  });
}
