const BLOCKED_AGENT_STATUSES = new Set(["archived", "cancelled", "canceled", "deleted", "error", "terminated"]);

function normalizedStatus(agent) {
  return String(agent?.status || "").trim().toLowerCase();
}

function blockedStatus(agent) {
  const status = normalizedStatus(agent);
  return BLOCKED_AGENT_STATUSES.has(status) ? status : "";
}

function agentLabel(agent, fallback = "unknown") {
  return agent?.name || agent?.id || fallback;
}

export function selectedAgentAncestryProblems(selectedRoles, agents) {
  const agentsByName = agents instanceof Map ? agents : new Map((agents || []).map((agent) => [agent.name, agent]));
  const agentsById = new Map([...agentsByName.values()].filter((agent) => agent?.id).map((agent) => [agent.id, agent]));
  const problems = [];

  for (const role of selectedRoles || []) {
    const agent = agentsByName.get(role.name);
    if (!agent) continue;

    const status = blockedStatus(agent);
    if (status) {
      problems.push({
        type: "selected-status",
        voiceName: role.name,
        agentName: agentLabel(agent, role.name),
        status,
      });
    }

    const seen = new Set(agent.id ? [agent.id] : []);
    let child = agent;
    while (child?.reportsTo) {
      const ancestorId = String(child.reportsTo);
      if (seen.has(ancestorId)) {
        problems.push({
          type: "cycle",
          voiceName: role.name,
          agentName: agentLabel(child, role.name),
          ancestorId,
        });
        break;
      }
      seen.add(ancestorId);

      const ancestor = agentsById.get(ancestorId);
      if (!ancestor) {
        problems.push({
          type: "missing-ancestor",
          voiceName: role.name,
          agentName: agentLabel(child, role.name),
          ancestorId,
        });
        break;
      }

      const ancestorStatus = blockedStatus(ancestor);
      if (ancestorStatus) {
        problems.push({
          type: "ancestor-status",
          voiceName: role.name,
          agentName: agentLabel(child, role.name),
          ancestorName: agentLabel(ancestor, ancestorId),
          ancestorId,
          status: ancestorStatus,
        });
        break;
      }
      child = ancestor;
    }
  }

  return problems;
}

function problemLine(problem) {
  if (problem.type === "selected-status") {
    return `${problem.voiceName}: agent status=${problem.status}`;
  }
  if (problem.type === "ancestor-status") {
    return `${problem.voiceName}: reports through ${problem.status} ancestor ${problem.ancestorName}`;
  }
  if (problem.type === "missing-ancestor") {
    return `${problem.voiceName}: reportsTo points to missing agent ${problem.ancestorId}`;
  }
  if (problem.type === "cycle") {
    return `${problem.voiceName}: reportsTo cycle at ${problem.ancestorId}`;
  }
  return `${problem.voiceName}: invalid Paperclip agent ancestry`;
}

export function selectedAgentAncestryRecoveryMessage(problems) {
  const voices = [...new Set((problems || []).map((problem) => problem.voiceName).filter(Boolean))];
  const details = (problems || []).slice(0, 5).map(problemLine);
  return [
    "Не запускаю Агору: Paperclip-иерархия требует восстановления.",
    voices.length ? `Затронутые голоса: ${voices.join(", ")}.` : "",
    details.length ? `Диагностика: ${details.join("; ")}.` : "",
    "Восстановление: node scripts/agora.mjs prepare local",
  ]
    .filter(Boolean)
    .join("\n");
}
