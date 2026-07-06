export function tagList(item) {
  return Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
}

export function normalizeTag(value) {
  return String(value || "").trim().toLowerCase();
}

export function tagSummary(roles) {
  const counts = new Map();
  for (const item of roles) {
    for (const tag of tagList(item)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export function tagSummaryLines(roles = []) {
  const summary = tagSummary(roles);
  return [
    "# Теги философов",
    ...summary.map(([tag, count]) => `- ${tag}: ${count}`),
    "",
    `Всего тегов: ${summary.length}`,
    `Философов: ${roles.length}`,
  ];
}

export function rosterStatusLines({ roles = [], agents = [], assistantName = "", tag = "" } = {}) {
  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));
  const expectedNames = new Set(roles.map((item) => item.name));
  const filteredRoles = tag ? roles.filter((item) => tagList(item).map(normalizeTag).includes(tag)) : roles;
  const present = filteredRoles.filter((item) => agentsByName.has(item.name));
  const extra = agents.filter((agent) => agent.name !== assistantName && !expectedNames.has(agent.name));
  const assistant = agentsByName.get(assistantName);
  const lines = [tag ? `# Философы в Paperclip: tag=${tag}` : "# Философы в Paperclip"];

  for (const item of filteredRoles) {
    const agent = agentsByName.get(item.name);
    const statusLabel = agent ? String(agent.status || "unknown").padEnd(8) : "missing ";
    const dataTags = tagList(item);
    const paperclipTags = Array.isArray(agent?.metadata?.tags) ? agent.metadata.tags : [];
    const tagSync = agent && JSON.stringify(dataTags) !== JSON.stringify(paperclipTags) ? " metadata-tags=stale" : "";
    lines.push(`- ${statusLabel} ${item.name} (${item.key}) tags=${dataTags.join(", ")}${tagSync}`);
  }

  lines.push("");
  lines.push(`Итого философов: ${present.length}/${filteredRoles.length}`);
  if (tag) lines.push(`Фильтр tag=${tag}; всего в roster: ${roles.length}`);
  lines.push(`Agora Assistant: ${assistant ? assistant.status || "unknown" : "missing"}`);
  lines.push(`Всего агентов в Paperclip: ${agents.length}`);

  if (extra.length) {
    lines.push("");
    lines.push("Лишние агенты не из активного roster:");
    for (const agent of extra) lines.push(`- ${agent.status || "unknown"} ${agent.name}`);
  }

  return lines;
}

export function parsePhilosophersArgs(args) {
  const options = {
    showTags: false,
    tag: "",
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--tags" || arg === "tags" || arg === "теги") {
      options.showTags = true;
    } else if (arg === "--tag" || arg === "--тег") {
      options.tag = normalizeTag(args[++index]);
      if (!options.tag) throw new Error("Usage: node scripts/agora.mjs philosophers --tag TAG");
    } else if (arg.startsWith("--tag=")) {
      options.tag = normalizeTag(arg.slice("--tag=".length));
      if (!options.tag) throw new Error("Usage: node scripts/agora.mjs philosophers --tag TAG");
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown philosophers option: ${arg}`);
    }
  }

  return options;
}
