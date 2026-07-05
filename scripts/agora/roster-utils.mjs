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
