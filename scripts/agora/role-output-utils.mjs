export function roleSearchLines(payload = {}) {
  if (payload.selected) return [`${payload.selected.name} (${payload.selected.key})`];
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  if (!matches.length) return ["No matching philosophers found."];
  return matches.map((match) => `${match.name} (${match.key})`);
}

export function roleProposalPayload({ topic = "", mode = "balanced", roles = [] } = {}) {
  return {
    topic,
    mode,
    roles: roles.map((role) => ({
      key: role.key,
      name: role.name,
      englishName: role.englishName,
      reason: role.title || role.centralIntuition || "",
    })),
  };
}

export function roleProposalLines(payload = {}) {
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  return [
    `По этой теме я бы собрал ${roles.length} философов:`,
    "",
    ...roles.map((role) => `${role.name} — ${role.reason}`),
  ];
}

export function publicSkill(skill = {}) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    riskTier: skill.riskTier,
    allowedTools: skill.allowedTools,
  };
}

export function resolvedRoleSkillsPayload({ chamber = {}, role = {}, resolved = {} } = {}) {
  return {
    chamberId: chamber.id,
    roleKey: role.key,
    roleName: role.name,
    skills: (resolved.skills || []).map(publicSkill),
    diagnostics: resolved.diagnostics || [],
  };
}

export function singleRoleSkillsLines(payload = {}) {
  const lines = [`${payload.roleName} (${payload.roleKey})`];
  const skills = Array.isArray(payload.skills) ? payload.skills : [];
  if (skills.length) {
    for (const skill of skills) {
      const tools = skill.allowedTools.length ? ` tools=${skill.allowedTools.join(",")}` : "";
      lines.push(`- ${skill.id} ${skill.riskTier}${tools}`);
    }
  } else {
    lines.push("- no resolved skills");
  }
  for (const item of payload.diagnostics || []) lines.push(`! ${item.level}: ${item.message}`);
  return lines;
}

export function allRoleSkillsPayload({ chamber = {}, roles = [] } = {}) {
  return {
    chamberId: chamber.id,
    chamberName: chamber.name,
    roles,
  };
}

export function allRoleSkillsLines(payload = {}) {
  const lines = [`Skills: ${payload.chamberName}`];
  for (const role of payload.roles || []) {
    const skillIds = role.skills.map((skill) => skill.id).join(", ") || "-";
    lines.push(`- ${role.roleKey}: ${skillIds}`);
  }
  return lines;
}
