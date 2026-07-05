import { detectMode, normalizeMode } from "./mode-utils.mjs";

export function parseRoleProposalArgs(args = []) {
  const options = { json: false, limit: 4, mode: "balanced", noArchitects: false };
  const textParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--limit") {
      options.limit = Math.max(1, Number(args[++index] || 4) || 4);
    } else if (arg === "--mode") {
      options.mode = normalizeMode(args[++index] || "balanced");
    } else if (arg === "--no-architects") {
      options.noArchitects = true;
    } else {
      textParts.push(arg);
    }
  }
  return { ...options, topic: textParts.join(" ").trim() };
}

export function parseAskArgs(args = [], { defaultMode = "balanced" } = {}) {
  let mode = defaultMode;
  let explicitMode = false;
  let dryRun = false;
  let all = false;
  let confirmAll = false;
  let noArchitects = false;
  let philosopherList = null;
  const textParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      const value = args[index + 1];
      if (!value) throw new Error("--mode requires one of: min, local, balanced, max, all");
      mode = normalizeMode(value);
      explicitMode = true;
      index += 1;
    } else if (arg === "--min") {
      mode = "min";
      explicitMode = true;
    } else if (arg === "--balanced") {
      mode = "balanced";
      explicitMode = true;
    } else if (arg === "--max") {
      mode = "max";
      explicitMode = true;
    } else if (arg === "--local") {
      mode = "local";
      explicitMode = true;
    } else if (arg === "--all") {
      all = true;
      mode = "all";
      explicitMode = true;
    } else if (arg === "--confirm-all") {
      confirmAll = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--no-architects") {
      noArchitects = true;
    } else if (arg === "--philosophers" || arg === "--voices") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires comma-separated philosopher keys or names`);
      philosopherList = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else {
      textParts.push(arg);
    }
  }

  const request = textParts.join(" ").trim();
  if (!explicitMode) mode = detectMode(request, mode);
  return { request, mode, dryRun, all, confirmAll, noArchitects, philosopherList };
}

export function parseCouncilArgs(args = []) {
  let dryRun = false;
  const textParts = [];

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else {
      textParts.push(arg);
    }
  }

  return {
    dryRun,
    request: textParts.join(" ").trim(),
  };
}

export function parseFollowUpArgs(args = []) {
  const rootRef = args[0];
  if (!rootRef) throw new Error('Usage: node scripts/agora.mjs follow-up <root-issue> [--voices list] "question"');
  let roleList = "";
  const textParts = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--voices" || arg === "--philosophers") {
      roleList = args[++index] || "";
      if (!roleList) throw new Error(`${arg} requires comma-separated role keys or names`);
    } else {
      textParts.push(arg);
    }
  }
  const request = textParts.join(" ").trim();
  if (!request) throw new Error('Usage: node scripts/agora.mjs follow-up <root-issue> [--voices list] "question"');
  return { rootRef, roleList, request };
}

export function parseTasksArgs(args = []) {
  let scope = "open";
  let limit = 20;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--all") scope = "all";
    else if (arg === "--open") scope = "open";
    else if (arg === "--limit") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--limit requires a positive number");
      limit = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown tasks argument: ${arg}`);
    }
  }
  return { scope, limit };
}

export function stripFullTokens(args = []) {
  const fullWords = new Set(["--full", "full", "подробно", "полностью"]);
  return {
    full: args.some((arg) => fullWords.has(String(arg).toLowerCase())),
    args: args.filter((arg) => !fullWords.has(String(arg).toLowerCase())),
  };
}
