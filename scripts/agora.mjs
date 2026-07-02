#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listChambers, loadChamber } from "./chamber-loader.mjs";
import { decideNextStep, extractIntentSlots } from "./intent-slots.mjs";
import { loadSkillPrompt, resolveSkillsForRole } from "./skill-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_ROLES_PATH = path.join(ROOT, "data", "philosophers.json");
const PHILOSOPHY_ROLES_PATH = path.join(ROOT, "chambers", "philosophy", "roles.json");
const DEFAULT_MVP_PRESET_PATH = path.join(ROOT, "chambers", "philosophy", "presets", "mvp.json");
const CHAMBERS_DIR = process.env.INNER_AGORA_CHAMBERS_DIR
  ? path.resolve(process.env.INNER_AGORA_CHAMBERS_DIR)
  : path.join(ROOT, "chambers");
const SKILLS_DIR = process.env.INNER_AGORA_SKILLS_DIR
  ? path.resolve(process.env.INNER_AGORA_SKILLS_DIR)
  : path.join(ROOT, "skills");
const DEFAULT_CHAMBER_ID = process.env.INNER_AGORA_DEFAULT_CHAMBER || "philosophy";
const STATE_PATH = process.env.INNER_AGORA_STATE_PATH || path.join(ROOT, ".inner-agora-state.json");
const COCKPIT_CONFIG_PATH = process.env.PAPERCLIP_COCKPIT_CONFIG || path.join(ROOT, "paperclip-cockpit.json");
const COCKPIT_CONFIG = readJsonFile(COCKPIT_CONFIG_PATH, {});
const AGORA_CONFIG = COCKPIT_CONFIG.agora && typeof COCKPIT_CONFIG.agora === "object" ? COCKPIT_CONFIG.agora : {};
const API_BASE = process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api";
const ASSISTANT_NAME = "Agora Assistant / Синтезатор";
const DEFAULT_MODE = process.env.INNER_AGORA_DEFAULT_MODE || AGORA_CONFIG.default_mode || "balanced";
const DEFAULT_CODEX_MODEL = process.env.INNER_AGORA_CODEX_MODEL || AGORA_CONFIG.codex_model || "gpt-5.4";
const DEFAULT_HERMES_MODEL = process.env.INNER_AGORA_HERMES_MODEL || AGORA_CONFIG.hermes_model || "google/gemma-4-26b-a4b-qat";
const MEMORY_DIR = process.env.INNER_AGORA_MEMORY_DIR || path.join(ROOT, "memory", "sessions");
const ISSUE_REF_RE = /\b([A-Z][A-Z0-9]{1,12}-\d+)\b/i;
const DEFAULT_ISSUE_PREFIX = process.env.INNER_AGORA_ISSUE_PREFIX || "THE";

function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeChamberMode(value) {
  const normalized = String(value || "legacy").trim().toLowerCase();
  if (["legacy", "chambers"].includes(normalized)) return normalized;
  throw new Error(`Unsupported CHAMBER_MODE=${value}. Use legacy or chambers.`);
}

const CHAMBER_MODE = normalizeChamberMode(process.env.CHAMBER_MODE || "legacy");

function shouldUseActiveChamberRoles() {
  return CHAMBER_MODE === "chambers" || Boolean(process.env.INNER_AGORA_ACTIVE_CHAMBER) || activeChamberId() !== DEFAULT_CHAMBER_ID;
}

function chamberRelativePath(chamber, relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(CHAMBERS_DIR, chamber.id, relativePath);
}

function roleSourcePath() {
  if (!shouldUseActiveChamberRoles()) return LEGACY_ROLES_PATH;
  const chamber = activeChamber();
  return chamberRelativePath(chamber, chamber.roles[0]);
}

function loadRoles() {
  const filePath = roleSourcePath();
  const roles = readJsonFile(filePath, null);
  if (!Array.isArray(roles)) {
    throw new Error(`Role roster not found or invalid: ${path.relative(ROOT, filePath)}`);
  }
  return roles;
}

function mvpPresetPath() {
  if (process.env.INNER_AGORA_MVP_PRESET_PATH) return path.resolve(process.env.INNER_AGORA_MVP_PRESET_PATH);
  if (!shouldUseActiveChamberRoles()) return DEFAULT_MVP_PRESET_PATH;
  const chamber = activeChamber();
  return chamberRelativePath(chamber, chamber.presets[0]);
}

function loadMvpPresetRoleKeys() {
  const filePath = mvpPresetPath();
  const preset = readJsonFile(filePath, null);
  if (!preset || !Array.isArray(preset.roleKeys) || !preset.roleKeys.length) {
    throw new Error(`MVP preset must define non-empty roleKeys[]: ${path.relative(ROOT, filePath)}`);
  }
  return preset.roleKeys.map((key) => String(key || "").trim()).filter(Boolean);
}

const roles = loadRoles();
const roleByKey = new Map(roles.map((item) => [item.key, item]));
/** @deprecated Use roles. */
const philosophers = roles;
/** @deprecated Use roleByKey. */
const philosopherByKey = roleByKey;

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/agora.mjs prepare [local|balanced|max]
  node scripts/agora.mjs council [--dry-run] "question"
  node scripts/agora.mjs ask [--min|--balanced|--max|--all] [--philosophers list] "question"
  node scripts/agora.mjs ask --dry-run --philosophers socrates,kant "question"
  node scripts/agora.mjs follow-up <root-issue> [--voices list] "question"
  node scripts/agora.mjs dialogue <philosopher> "question"
  node scripts/agora.mjs synthesize [root-issue-id-or-key] [--fresh]
  node scripts/agora.mjs export-memory <issue-id-or-key>
  node scripts/agora.mjs philosophers [--tags|--tag TAG]
  node scripts/agora.mjs chamber [list|current|use <id>]
  node scripts/agora.mjs policy [skill-id]
  node scripts/agora.mjs skills [role-key] [--json]
  node scripts/agora.mjs start [--json]
  node scripts/agora.mjs wizard
  node scripts/agora.mjs wizard-answer "answer"
  node scripts/agora.mjs understand [--routing-mode regex|llm] [--json] "human text"
  node scripts/agora.mjs natural [--routing-mode regex|llm] [--dry-run] [--json] "human text"
  node scripts/agora.mjs mode [get|set <min|balanced|max|local>|--raw]
  node scripts/agora.mjs status
  node scripts/agora.mjs recheck [issue-id-or-key]
  node scripts/agora.mjs tasks [--all|--open] [--limit N]
  node scripts/agora.mjs latest [issue-id-or-key]
  node scripts/agora.mjs result [issue-id-or-key] [--full]
  node scripts/agora.mjs voice <philosopher> [issue-id-or-key] [--full]
  node scripts/agora.mjs task <issue-id-or-key>
  node scripts/agora.mjs finalize <issue-id-or-key> [--dry-run]
  node scripts/agora.mjs move <issue-id-or-key> <todo|in_progress|blocked|done|cancelled>
  node scripts/agora.mjs comments <issue-id-or-key>

Modes:
  council   fixed MVP council: Plato, Descartes, Heidegger
  min       3 voices, usually architects or explicitly selected philosophers
  balanced 7 voices by default
  max       12 voices by default
  all       every role in the current roster
`);
  process.exit(exitCode);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = {
    ...readState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function rememberIssue(issue, patch = {}) {
  if (!issue) return;
  writeState({
    ...patch,
    lastIssueRef: issue.identifier || issue.id,
    lastIssueId: issue.id,
    lastIssueTitle: issue.title || "",
    lastIssueStatus: issue.status || "",
    lastIssueSeenAt: new Date().toISOString(),
  });
}

function activeChamberId(state = readState()) {
  return String(process.env.INNER_AGORA_ACTIVE_CHAMBER || state.activeChamberId || DEFAULT_CHAMBER_ID).trim();
}

function activeChamber(state = readState()) {
  return loadChamber(CHAMBERS_DIR, activeChamberId(state));
}

function activeChamberCompanyConfig(state = readState()) {
  const chamber = activeChamber(state);
  const company = chamber.company || {};
  return {
    chamber,
    companyId: String(process.env.INNER_AGORA_COMPANY_ID || company.companyId || "").trim(),
    companyName: String(process.env.INNER_AGORA_COMPANY_NAME || company.name || "").trim(),
    projectName: String(process.env.INNER_AGORA_PROJECT_NAME || company.projectName || "").trim(),
    goalTitle: String(process.env.INNER_AGORA_GOAL_TITLE || company.goalTitle || "").trim(),
  };
}

function printActiveChamber(state = readState()) {
  const chamber = activeChamber(state);
  console.log(`activeChamberId=${chamber.id}`);
  console.log(`activeChamberName=${chamber.name}`);
  return chamber;
}

function chamberCommand(args = []) {
  const [action = "current", value] = args;

  if (action === "list" || action === "ls") {
    const current = activeChamberId();
    for (const chamber of listChambers(CHAMBERS_DIR)) {
      const marker = chamber.id === current ? "*" : "-";
      console.log(`${marker} ${chamber.id}: ${chamber.name} (${chamber.status})`);
    }
    return;
  }

  if (action === "current" || action === "status" || action === "get") {
    printActiveChamber();
    return;
  }

  if (action === "use" || action === "set") {
    if (!value) throw new Error("Usage: node scripts/agora.mjs chamber use <id>");
    const chamber = loadChamber(CHAMBERS_DIR, value);
    const state = writeState({ activeChamberId: chamber.id });
    console.log(`Активная палата: ${chamber.id}`);
    console.log(`Название: ${chamber.name}`);
    if (state.updatedAt) console.log(`updatedAt=${state.updatedAt}`);
    return;
  }

  throw new Error(`Unknown chamber command: ${action}`);
}

function normalizeMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["min", "minimum", "минимум", "мин"].includes(normalized)) return "min";
  if (["local", "локально", "локальный"].includes(normalized)) return "local";
  if (["balanced", "balance", "умный", "средний"].includes(normalized)) return "balanced";
  if (["max", "maximum", "макс", "максимум"].includes(normalized)) return "max";
  if (["all", "все", "всё"].includes(normalized)) return "all";
  throw new Error(`Unknown mode: ${value}`);
}

function defaultMode() {
  return normalizeMode(process.env.INNER_AGORA_MODE || readState().mode || DEFAULT_MODE);
}

function adapterForMode(mode) {
  if (mode === "local") {
    return {
      name: "hermes_local",
      env: {
        INNER_AGORA_AGENT_ADAPTER: "hermes_local",
        INNER_AGORA_HERMES_MODEL: DEFAULT_HERMES_MODEL,
      },
    };
  }
  return {
    name: "codex_local",
    env: {
      INNER_AGORA_AGENT_ADAPTER: "codex_local",
      INNER_AGORA_CODEX_MODEL: DEFAULT_CODEX_MODEL,
    },
  };
}

function printMode(mode, state = readState()) {
  const adapter = adapterForMode(mode);
  console.log(`mode=${mode}`);
  console.log(`adapter=${adapter.name}`);
  console.log(`state=${STATE_PATH}`);
  if (state.updatedAt) console.log(`updatedAt=${state.updatedAt}`);
}

function modeCommand(args) {
  const raw = args.includes("--raw");
  const filtered = args.filter((arg) => arg !== "--raw");
  const [action, value] = filtered;

  if (!action || action === "get" || action === "status") {
    const mode = defaultMode();
    if (raw) console.log(mode);
    else printMode(mode);
    return;
  }

  if (action === "set") {
    if (!value) throw new Error("Usage: node scripts/agora.mjs mode set <min|local|balanced|max>");
    const mode = normalizeMode(value);
    const state = writeState({ mode });
    if (raw) console.log(mode);
    else {
      console.log(`Режим Агоры сохранен: ${mode}`);
      printMode(mode, state);
    }
    return;
  }

  const mode = normalizeMode(action);
  const state = writeState({ mode });
  if (raw) console.log(mode);
  else {
    console.log(`Режим Агоры сохранен: ${mode}`);
    printMode(mode, state);
  }
}

function prepare(args) {
  const mode = args[0] ? normalizeMode(args[0]) : defaultMode();
  const adapter = adapterForMode(mode);
  const result = spawnSync(process.execPath, ["scripts/import-inner-agora.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: Number(process.env.INNER_AGORA_PREPARE_TIMEOUT_MS || 180000),
    env: {
      ...process.env,
      INNER_AGORA_MODE: mode,
      ...adapter.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Prepare failed for mode=${mode}, adapter=${adapter.name}`,
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : "",
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : "",
        result.error?.message ? `error: ${result.error.message}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  console.log(`Prepared Paperclip agents: mode=${mode}, adapter=${adapter.name}`);
}

async function api(pathname, options = {}) {
  const url = `${API_BASE}${pathname}`;
  const request = () =>
    fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });

  let response;
  try {
    response = await request();
  } catch (error) {
    if (shouldAutoRestartPaperclip()) {
      const recovery = restartPaperclipService();
      await sleep(2500);
      try {
        response = await request();
      } catch (retryError) {
        throw paperclipFetchError(pathname, options, url, retryError, recovery);
      }
    } else {
      throw paperclipFetchError(pathname, options, url, error, null);
    }
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
  }
  return data;
}

function shouldAutoRestartPaperclip() {
  try {
    const parsed = new URL(API_BASE);
    return (
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
      (parsed.port === "3100" || !parsed.port) &&
      process.env.INNER_AGORA_AUTO_RESTART_PAPERCLIP !== "0"
    );
  } catch {
    return false;
  }
}

function restartPaperclipService() {
  const result = spawnSync("zsh", ["-lc", "launchctl kickstart -k gui/$(id -u)/local.paperclipai.default"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error?.message || "",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paperclipFetchError(pathname, options, url, error, recovery) {
  const lines = [
    `${options.method || "GET"} ${pathname} failed before HTTP response: ${error.message}`,
    `Paperclip API URL: ${url}`,
  ];
  if (recovery) {
    lines.push(`Auto-restart attempted: launchctl kickstart local.paperclipai.default exit=${recovery.status ?? "null"}`);
    if (recovery.stderr) lines.push(`Auto-restart stderr: ${recovery.stderr}`);
    if (recovery.error) lines.push(`Auto-restart error: ${recovery.error}`);
  }
  lines.push(
    "Most likely Paperclip is not running or the local port is unavailable.",
    "Check: curl http://127.0.0.1:3100/api/health",
    "Restart: launchctl kickstart -k gui/$(id -u)/local.paperclipai.default",
  );
  return new Error(lines.join("\n"));
}

async function getAgora() {
  const { chamber, companyId, companyName, projectName, goalTitle } = activeChamberCompanyConfig();
  const companies = await api("/companies");
  const company = companies.find((item) => {
    if (item.status === "archived") return false;
    if (companyId && item.id === companyId) return true;
    return item.name === companyName;
  });
  if (!company) {
    throw new Error(`Company not found: ${companyName}. Run: node scripts/import-inner-agora.mjs`);
  }

  const [agents, projects, goals] = await Promise.all([
    api(`/companies/${company.id}/agents`),
    api(`/companies/${company.id}/projects`),
    api(`/companies/${company.id}/goals`),
  ]);

  const assistant = agents.find((agent) => agent.name === ASSISTANT_NAME);
  const project = projects.find((item) => item.name === projectName);
  const goal = goals.find((item) => item.title === goalTitle);
  if (!assistant || !project || !goal) {
    throw new Error(`${chamber.name} is incomplete. Run: node scripts/import-inner-agora.mjs`);
  }

  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));
  return { company, agents, agentsByName, assistant, project, goal };
}

function cleanTitle(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 96) || "Agora request";
}

function clip(text, limit = 7000) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[... clipped ${value.length - limit} chars ...]`;
}

function roleByToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  return roles.find((item) => {
    return (
      item.key === normalized ||
      item.name.toLowerCase() === normalized ||
      item.englishName.toLowerCase() === normalized ||
      (item.aliases || []).some((alias) => alias.toLowerCase() === normalized)
    );
  });
}
/** @deprecated Use roleByToken. */
const philosopherByToken = roleByToken;

function looseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, "");
}

function looseStem(value) {
  const text = looseText(value);
  const suffixes = ["ами", "ями", "ого", "ему", "ому", "ыми", "ими", "ий", "ый", "ая", "ое", "ее", "ой", "ей", "ым", "им", "ом", "ем", "ах", "ях", "у", "ю", "е", "а", "я", "ы", "и"];
  for (const suffix of suffixes) {
    if (text.length - suffix.length >= 4 && text.endsWith(suffix)) return text.slice(0, -suffix.length);
  }
  return text;
}

function roleAliases(item) {
  return [item.key, item.name, item.englishName, ...(item.aliases || [])].filter(Boolean);
}
/** @deprecated Use roleAliases. */
const philosopherAliases = roleAliases;

function roleScoreInText(item, text) {
  const haystack = looseText(text);
  if (!haystack) return 0;
  let score = 0;
  for (const alias of roleAliases(item)) {
    const exact = looseText(alias);
    const stem = looseStem(alias);
    if (exact && haystack.includes(exact)) score = Math.max(score, exact.length + 20);
    if (stem && stem.length >= 4 && haystack.includes(stem)) score = Math.max(score, stem.length + 10);
  }
  return score;
}
/** @deprecated Use roleScoreInText. */
const philosopherScoreInText = roleScoreInText;

function roleFromText(text) {
  const exact = roleByToken(String(text || "").replace(/[^\p{L}\p{N}_ -]+/gu, "").trim());
  if (exact) return exact;
  return roles
    .map((item) => ({ item, score: roleScoreInText(item, text) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key))[0]?.item || null;
}
/** @deprecated Use roleFromText. */
const philosopherFromText = roleFromText;

function uniqueRoles(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}
/** @deprecated Use uniqueRoles. */
const uniquePhilosophers = uniqueRoles;

function parseAskArgs(args) {
  let mode = defaultMode();
  let explicitMode = false;
  let dryRun = false;
  let all = false;
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
      usage(0);
    } else {
      textParts.push(arg);
    }
  }

  const request = textParts.join(" ").trim();
  if (!explicitMode) mode = detectMode(request, mode);
  return { request, mode, dryRun, all, noArchitects, philosopherList };
}

function parseCouncilArgs(args) {
  let dryRun = false;
  const textParts = [];

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      textParts.push(arg);
    }
  }

  return {
    dryRun,
    request: textParts.join(" ").trim(),
  };
}

function detectMode(request, fallback) {
  if (/всех|все философы|full agora|all voices/i.test(request)) return "all";
  if (/максимальн|макс|deep|глубок/i.test(request)) return "max";
  if (/быстро|коротко|мин/i.test(request)) return "min";
  return fallback;
}

function requestedVoiceLimit(request) {
  const text = request.toLowerCase();
  const countContext = /философ|голос|участ|подход|сильн|выбор|voices|thinkers|participants/.test(text);
  if (!countContext) return null;

  const range = text.match(/\b([2-9]|1[0-9])\s*[-–—]\s*([2-9]|1[0-9])\b/);
  if (range) return Math.max(Number(range[1]), Number(range[2]));

  const single = text.match(/\b([2-9]|1[0-9])\s*(?:философ|голос|участ|подход|сильн|voices|thinkers|participants)\b/);
  return single ? Number(single[1]) : null;
}

async function minimumCouncil(args) {
  const { request, dryRun } = parseCouncilArgs(args);
  if (!request) throw new Error('Usage: node scripts/agora.mjs council [--dry-run] "your question"');
  const roleKeys = loadMvpPresetRoleKeys();

  const forwarded = [
    "--min",
    "--philosophers",
    roleKeys.join(","),
    ...(dryRun ? ["--dry-run"] : []),
    request,
  ];
  return ask(forwarded);
}

function selectPhilosophers(request, mode, philosopherList, options = {}) {
  if (philosopherList) {
    const selected = philosopherList
      .split(",")
      .map((token) => roleByToken(token))
      .filter(Boolean);
    if (!selected.length) throw new Error(`No known philosophers in --philosophers ${philosopherList}`);
    return uniqueRoles(selected);
  }

  if (mode === "all" || options.all) return roles;

  if (activeChamberId() !== "philosophy") {
    return selectChamberRoles(request, mode);
  }

  const text = request.toLowerCase();
  const selected = [];
  const add = (...keys) => {
    for (const key of keys) selected.push(roleByKey.get(key));
  };

  if (/врем|темпорал|длит|dur[eé]e|duration|uji|аничч|anicca|момент|мгновен|вечност|циклич|прошл|будущ|настоящ/.test(text)) {
    add("buddha", "dogen", "laozi", "bergson", "heidegger", "augustine", "nagarjuna");
  }

  if (!options.noArchitects) add("plato", "descartes", "heidegger");
  add("socrates");

  if (/морал|этик|добродетел|долг|вина|счаст|жизнь|страдан|выбор|ценност/.test(text)) {
    add(
      "buddha",
      "confucius",
      "schopenhauer",
      "kierkegaard",
      "levinas",
      "tolstoy",
      "aristotle",
      "diogenes",
      "kant",
      "epictetus",
      "marcus-aurelius",
      "epicurus",
      "augustine",
      "nietzsche",
    );
  }
  if (/свобод|условн|обыча|стыд|роскош|аскез|циник|киник|провокац|простот/.test(text)) {
    add("sartre", "beauvoir", "camus", "berdyaev", "diogenes", "epictetus", "epicurus", "nietzsche", "rousseau");
  }
  if (/быт|существ|реальн|метафиз|бог|единое|душ|субстанц|природ/.test(text)) {
    add(
      "laozi",
      "nagarjuna",
      "shankara",
      "avicenna",
      "ibn-arabi",
      "leibniz",
      "dogen",
      "parmenides",
      "plotinus",
      "spinoza",
      "aquinas",
      "cusanus",
    );
  }
  if (/знан|истин|метод|сомнен|доказ|разум|субъект|позна/.test(text)) {
    add("hume", "montaigne", "pascal", "husserl", "wittgenstein", "al-ghazali", "averroes", "maimonides", "pyrrho", "kant", "spinoza", "aquinas");
  }
  if (/истор|обще|полит|государ|власт|культур|цивилизац|либерал|модерн|традиц/.test(text)) {
    add(
      "machiavelli",
      "hobbes",
      "marx",
      "arendt",
      "fanon",
      "said",
      "freire",
      "ibn-khaldun",
      "diogenes",
      "rousseau",
      "hegel",
      "nietzsche",
      "foucault",
      "dugin",
    );
  }
  if (/язык|текст|знак|медиа|симулякр|постмодерн|дискурс|нарратив|культура/.test(text)) {
    add("wittgenstein", "derrida", "bakhtin", "said", "barthes", "baudrillard", "deleuze", "foucault");
  }
  if (/желан|тело|станов|различ|машин|ризом|поток/.test(text)) {
    add("bergson", "merleau-ponty", "zhuangzi", "deleuze", "nietzsche", "spinoza");
  }

  add("aristotle", "diogenes", "nietzsche", "foucault");

  const limits = {
    min: 3,
    local: 5,
    balanced: 7,
    max: 12,
  };
  const modeLimit = limits[mode] || limits.balanced;
  const requestedLimit = requestedVoiceLimit(request);
  const limit = requestedLimit ? Math.min(modeLimit, requestedLimit) : modeLimit;
  return uniqueRoles(selected).slice(0, limit);
}

function selectedRoleLimit(request, mode) {
  const limits = {
    min: 3,
    local: 5,
    balanced: 7,
    max: 12,
  };
  const modeLimit = limits[mode] || limits.balanced;
  const requestedLimit = requestedVoiceLimit(request);
  return requestedLimit ? Math.min(modeLimit, requestedLimit) : modeLimit;
}

function genericRoleScore(item, request) {
  const haystack = looseText(
    [
      item.key,
      item.name,
      item.englishName,
      item.title,
      item.centralIntuition,
      ...(item.aliases || []),
      ...(item.tags || []),
    ].join(" "),
  );
  return looseText(request)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function selectChamberRoles(request, mode) {
  const selected = roles
    .map((item) => ({ item, score: roleScoreInText(item, request) + genericRoleScore(item, request) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key))
    .map((entry) => entry.item);

  for (const key of loadMvpPresetRoleKeys()) selected.push(roleByKey.get(key));
  for (const role of roles) selected.push(role);

  return uniqueRoles(selected).slice(0, selectedRoleLimit(request, mode));
}

function isPhilosophyChamber(chamber = activeChamber()) {
  return chamber.id === "philosophy";
}

function modePolicy(mode, chamber = activeChamber()) {
  if (!isPhilosophyChamber(chamber)) {
    if (mode === "all") return "Режим all: участвуют все роли из текущей палаты.";
    if (mode === "max") return "Режим max: широкий совет ролей для выявления конфликтов, рисков и условий решения.";
    if (mode === "balanced") return "Режим balanced: 5-7 релевантных ролей, достаточно глубоко без расползания.";
    if (mode === "local") return "Режим local: короткий совет без внешней проверки; полезен для быстрых локальных запусков.";
    return "Режим min: 3 роли, быстрый первый разбор.";
  }
  if (mode === "all") return "Режим all: участвуют все философские машины из текущего состава.";
  if (mode === "max") return "Режим max: широкий совет, но не обязательно весь пантеон; цель — сильный конфликт перспектив.";
  if (mode === "balanced") return "Режим balanced: 5-7 релевантных голосов, достаточно глубоко без расползания.";
  if (mode === "local") return "Режим local: короткий совет без внешней проверки; полезен для быстрых локальных запусков.";
  return "Режим min: 3 голоса, быстрый первый разбор.";
}

function fallbackTransparencyPolicy(policyId, error) {
  return [
    `Протокол прозрачности (${policyId}, fallback: ${error.message || error}):`,
    "- Основной skill prompt не загрузился; используй базовый протокол ниже.",
    "Протокол прозрачности:",
    "- По возможности помечай ключевые утверждения: [источник], [реконструкция], [имитация], [современный перенос].",
    "- [источник] — когда опираешься на конкретный текст, работу, фрагмент или устойчиво известную позицию; называй источник настолько точно, насколько уверен.",
    "- [реконструкция] — когда выводишь позицию из общей философской оптики, но не даешь прямую цитату.",
    "- [имитация] — когда это стилистическое разыгрывание голоса, темперамента или манеры.",
    "- [современный перенос] — когда применяешь философа к теме, которой исторически не было в его горизонте.",
    "- Не выдумывай точные цитаты, страницы, ссылки и названия. Если не уверен, пиши: нужна проверка источника.",
    "- В конце ответа добавь блок `Пометки:` с пунктами: Источники, Реконструкция, Имитация голоса, Современный перенос, Требует проверки.",
  ].join("\n");
}

function transparencyPolicy(policyId = activeChamber().transparencyPolicy) {
  try {
    return loadSkillPrompt(SKILLS_DIR, policyId);
  } catch (error) {
    return fallbackTransparencyPolicy(policyId, error);
  }
}

function policyCommand(args = []) {
  const policyId = args[0] || activeChamber().transparencyPolicy;
  console.log(transparencyPolicy(policyId));
}

function publicSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    riskTier: skill.riskTier,
    allowedTools: skill.allowedTools,
  };
}

function resolvedRoleSkills(role, chamber = activeChamber()) {
  const resolved = resolveSkillsForRole(role, chamber, { skillsDir: SKILLS_DIR });
  return {
    chamberId: chamber.id,
    roleKey: role.key,
    roleName: role.name,
    skills: resolved.skills.map(publicSkill),
    diagnostics: resolved.diagnostics,
  };
}

function skillsCommand(args = []) {
  const json = args.includes("--json");
  const filteredArgs = args.filter((arg) => arg !== "--json");
  const roleToken = filteredArgs[0] || "";
  const chamber = activeChamber();

  if (roleToken) {
    const role = roleByToken(roleToken);
    if (!role) throw new Error(`Unknown role: ${roleToken}`);
    const payload = resolvedRoleSkills(role, chamber);
    if (json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`${payload.roleName} (${payload.roleKey})`);
    if (payload.skills.length) {
      for (const skill of payload.skills) {
        const tools = skill.allowedTools.length ? ` tools=${skill.allowedTools.join(",")}` : "";
        console.log(`- ${skill.id} ${skill.riskTier}${tools}`);
      }
    } else {
      console.log("- no resolved skills");
    }
    for (const item of payload.diagnostics) console.log(`! ${item.level}: ${item.message}`);
    return;
  }

  const payload = {
    chamberId: chamber.id,
    roles: roles.map((role) => resolvedRoleSkills(role, chamber)),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`Skills: ${chamber.name}`);
  for (const role of payload.roles) {
    const skillIds = role.skills.map((skill) => skill.id).join(", ") || "-";
    console.log(`- ${role.roleKey}: ${skillIds}`);
  }
}

function roleLine(item) {
  const architect = item.architect ? " architect" : "";
  return `- ${item.name}${architect}: ${item.title}`;
}
/** @deprecated Use roleLine. */
const philosopherLine = roleLine;

function buildRootDescription({ request, mode, selected, chamber = activeChamber() }) {
  if (!isPhilosophyChamber(chamber)) {
    const agentLabel = chamber.labels?.agents || "roles";
    const taskLabel = chamber.labels?.task || "task";
    return [
      `Запрос пользователя для ${chamber.name}.`,
      "",
      modePolicy(mode, chamber),
      "",
      `Выбранные участники (${agentLabel}):`,
      selected.map(roleLine).join("\n"),
      "",
      "Исходный вопрос:",
      request,
      "",
      "Как работать с этой задачей:",
      `- Тип корневой задачи: ${taskLabel}.`,
      `- Child-задачи создаются отдельно и назначаются выбранным участникам (${agentLabel}).`,
      "- Участники дают собственные advisory-позиции и не финализируют общий вывод.",
      "- После ответов запусти синтез: `node scripts/agora.mjs synthesize ISSUE_ID_OR_KEY`.",
      "- Итоговый memo должен сохранить расхождения, условия решения, риски и следующий шаг.",
    ].join("\n");
  }

  return [
    "Запрос пользователя для The Inner Agora.",
    "",
    modePolicy(mode, chamber),
    "",
    "Выбранные философские машины:",
    selected.map(roleLine).join("\n"),
    "",
    "Исходный вопрос:",
    request,
    "",
    "Как работать с этой задачей:",
    "- Это корневой протокол сессии.",
    "- Child-задачи создаются отдельно и назначаются философам.",
    "- Философы не должны изображать общий итог; они дают собственную позицию.",
    "- После ответов запусти синтез: `node scripts/agora.mjs synthesize ISSUE_ID_OR_KEY`.",
    "- Итоговый Agora Assistant memo должен сохранить конфликт, а не сгладить его.",
  ].join("\n");
}

function buildRoleDescription({ rootIssue, request, mode, philosopher }) {
  return [
    `Ты выступаешь как философская машина "${philosopher.name}" в The Inner Agora.`,
    "",
    `Корневая сессия: ${rootIssue.identifier || rootIssue.id} — ${rootIssue.title}`,
    modePolicy(mode),
    "",
    "Профиль:",
    `- Эпоха: ${philosopher.era}`,
    `- Оптика: ${philosopher.title}`,
    `- Центральная интуиция: ${philosopher.centralIntuition}`,
    `- Манера: ${philosopher.voice}`,
    `- Напряжение / слепая зона: ${philosopher.tension}`,
    philosopher.contemporaryPublicFigure
      ? "- Ограничение: это реконструкция публичной интеллектуальной оптики, а не речь самого человека."
      : "",
    "",
    "Вопрос:",
    request,
    "",
    transparencyPolicy(),
    "",
    "Формат ответа:",
    "1. Как я пересобираю вопрос в своих понятиях.",
    "2. Моя позиция.",
    "3. Что в вопросе скрыто или неверно предполагается.",
    "4. С кем из выбранных философов я бы спорил и почему.",
    "5. Что Agora Assistant должен забрать в синтез.",
    "6. Пометки: источники, реконструкция, имитация голоса, современный перенос, что требует проверки.",
    "",
    "Ограничения:",
    "- Не говори за весь совет.",
    "- Не финализируй общий вывод.",
    "- Не притворяйся буквальным историческим лицом.",
    "- Не сглаживай собственную позицию ради согласия.",
  ]
    .filter(Boolean)
    .join("\n");
}
/** @deprecated Use buildRoleDescription. */
const buildPhilosopherDescription = buildRoleDescription;

function buildDialogueDescription({ request, philosopher }) {
  return [
    `Диалог пользователя с философской машиной "${philosopher.name}" в The Inner Agora.`,
    "",
    "Профиль:",
    `- Эпоха: ${philosopher.era}`,
    `- Оптика: ${philosopher.title}`,
    `- Центральная интуиция: ${philosopher.centralIntuition}`,
    `- Манера: ${philosopher.voice}`,
    `- Напряжение / слепая зона: ${philosopher.tension}`,
    philosopher.contemporaryPublicFigure
      ? "- Ограничение: это реконструкция публичной интеллектуальной оптики, а не речь самого человека."
      : "",
    "",
    "Вопрос / начало диалога:",
    request,
    "",
    transparencyPolicy(),
    "",
    "Веди живой философский диалог. Если вопрос поставлен поверхностно, сопротивляйся и уточняй. Отвечай по-русски, если пользователь не просит иначе. Даже в диалоге заканчивай содержательные ответы коротким блоком `Пометки:`.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function createIssue(companyId, payload) {
  return api(`/companies/${companyId}/issues`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function updateIssue(issueId, patch) {
  return api(`/issues/${issueId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function addComment(issueId, body) {
  return api(`/issues/${issueId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

async function wakeAgent(agentId, issueId, reason, options = {}) {
  const idempotencyKey = options.idempotencyKey || `inner-agora:${issueId}:${agentId}`;
  return api(`/agents/${agentId}/wakeup`, {
    method: "POST",
    body: JSON.stringify({
      source: "assignment",
      triggerDetail: "system",
      reason,
      payload: { issueId, source: "inner-agora" },
      idempotencyKey,
      forceFreshSession: Boolean(options.forceFreshSession),
    }),
  });
}

async function wakeAgentSafe(agentId, issueId, reason, options = {}) {
  try {
    const run = await wakeAgent(agentId, issueId, reason, options);
    return { ok: true, run };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

function wakeSummary(result) {
  if (!result) return "wake=not-requested";
  if (!result.ok) return `wake=failed (${result.error})`;
  const run = result.run || {};
  if (run.id) return `wake=${run.status || "queued"}:${run.id}`;
  return `wake=${run.status || "accepted"}`;
}

async function ask(args) {
  const { request, mode, dryRun, all, noArchitects, philosopherList } = parseAskArgs(args);
  if (!request) throw new Error('Usage: node scripts/agora.mjs ask "your question"');

  const chamber = activeChamber();
  const selected = selectPhilosophers(request, mode, philosopherList, { all, noArchitects });

  if (dryRun) {
    console.log(isPhilosophyChamber(chamber) ? "# Dry-run: The Inner Agora council" : `# Dry-run: ${chamber.name} council`);
    console.log(`mode=${mode}`);
    console.log(`voices=${selected.map((item) => item.name).join(", ")}`);
    console.log("");
    console.log(buildRootDescription({ request, mode, selected, chamber }));
    return;
  }

  const agora = await getAgora();
  const missingAgents = selected.filter((item) => !agora.agentsByName.get(item.name));
  if (missingAgents.length) {
    throw new Error(`Missing Paperclip agents: ${missingAgents.map((item) => item.name).join(", ")}`);
  }

  const rootIssue = await createIssue(agora.company.id, {
    title: `Agora ${mode}: ${cleanTitle(request)}`,
    description: buildRootDescription({ request, mode, selected, chamber }),
    status: "todo",
    workMode: "standard",
    priority: mode === "max" || mode === "all" ? "critical" : "high",
    projectId: agora.project.id,
    goalId: agora.goal.id,
    requestDepth: 0,
  });

  const childIssues = [];
  for (const philosopher of selected) {
    const agent = agora.agentsByName.get(philosopher.name);
    const child = await createIssue(agora.company.id, {
      title: `${philosopher.name}: ${cleanTitle(request)}`,
      description: buildRoleDescription({ rootIssue, request, mode, philosopher }),
      status: "todo",
      workMode: "standard",
      priority: mode === "max" || mode === "all" ? "critical" : "high",
      projectId: agora.project.id,
      goalId: agora.goal.id,
      parentId: rootIssue.id,
      assigneeAgentId: agent.id,
      requestDepth: 1,
    });
    const wake = await wakeAgentSafe(agent.id, child.id, `The Inner Agora voice task: ${philosopher.name}`);
    childIssues.push({ philosopher, issue: child, wake });
  }

  await addComment(
    rootIssue.id,
    [
      `Создана сессия The Inner Agora в режиме ${mode}.`,
      "",
      "Философские задачи:",
      childIssues
        .map(({ philosopher, issue, wake }) => `- ${philosopher.name}: ${issue.identifier || issue.id} (${wakeSummary(wake)})`)
        .join("\n"),
      "",
      "Автоматизация:",
      "- Paperclip cockpit monitor запустит синтез, когда философские задачи будут в финальных статусах.",
      "- Telegram получит итог с кнопками после завершения синтеза.",
      `- Ручное восстановление при необходимости: \`node scripts/agora.mjs synthesize ${rootIssue.identifier || rootIssue.id}\``,
    ].join("\n"),
  );

  console.log(`# Поставил вопрос в Агору: ${rootIssue.identifier || rootIssue.id}`);
  console.log(`Выбрал ${childIssues.length} голосов: ${childIssues.map(({ philosopher }) => philosopher.name).join(", ")}.`);
  console.log("Напишу сюда, когда будет готов синтез.");
  console.log("");
  console.log(`Сессия: ${rootIssue.identifier || rootIssue.id}`);
  console.log(`Открыть: http://127.0.0.1:3100/issues/${rootIssue.id}`);
  console.log("Голоса:");
  for (const { philosopher, issue, wake } of childIssues) {
    console.log(`- ${philosopher.name}: ${issue.identifier || issue.id} (${wakeSummary(wake)})`);
  }
  console.log(`Дальше автоматически: monitor запустит синтез после завершения голосов.`);
}

function parseFollowUpArgs(args) {
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

function followUpRoles(request, roleList) {
  if (roleList) {
    const selected = roleList
      .split(",")
      .map((token) => roleByToken(token))
      .filter(Boolean);
    if (!selected.length) throw new Error(`No known roles in --voices ${roleList}`);
    return uniqueRoles(selected);
  }
  const role = roleFromText(request);
  if (role) return [role];
  return selectPhilosophers(request, "min", "", { noArchitects: false }).slice(0, 1);
}

function buildFollowUpDescription({ rootIssue, request, philosopher }) {
  return [
    `Follow-up к сессии: ${rootIssue.identifier || rootIssue.id}`,
    "",
    `Корневой вопрос: ${rootQuestion(rootIssue)}`,
    "",
    `Уточнение для роли: ${philosopher.name}`,
    "",
    request,
    "",
    "Ответь как продолжение уже начатой сессии. Не создавай новый общий обзор, а уточни именно этот follow-up.",
    "",
    transparencyPolicy(),
  ].join("\n");
}

async function followUp(args) {
  const { rootRef, roleList, request } = parseFollowUpArgs(args);
  const rootIssue = await api(`/issues/${rootRef}`);
  const selected = followUpRoles(request, roleList);
  const agora = await getAgora();
  const missingAgents = selected.filter((item) => !agora.agentsByName.get(item.name));
  if (missingAgents.length) throw new Error(`Missing Paperclip agents: ${missingAgents.map((item) => item.name).join(", ")}`);

  const childIssues = [];
  for (const philosopher of selected) {
    const agent = agora.agentsByName.get(philosopher.name);
    const child = await createIssue(agora.company.id, {
      title: `${philosopher.name}: follow-up ${cleanTitle(request)}`,
      description: buildFollowUpDescription({ rootIssue, request, philosopher }),
      status: "todo",
      workMode: "standard",
      priority: "high",
      projectId: agora.project.id,
      goalId: agora.goal.id,
      parentId: rootIssue.id,
      assigneeAgentId: agent.id,
      requestDepth: 1,
    });
    const wake = await wakeAgentSafe(agent.id, child.id, `The Inner Agora follow-up: ${philosopher.name}`);
    childIssues.push({ philosopher, issue: child, wake });
  }

  await addComment(
    rootIssue.id,
    [
      `Создан follow-up в контексте ${rootIssue.identifier || rootIssue.id}.`,
      "",
      childIssues.map(({ philosopher, issue, wake }) => `- ${philosopher.name}: ${issue.identifier || issue.id} (${wakeSummary(wake)})`).join("\n"),
    ].join("\n"),
  );

  rememberIssue(rootIssue, { lastRootIssueRef: rootIssue.identifier || rootIssue.id, lastRootIssueId: rootIssue.id });
  console.log(`Продолжаю в контексте ${rootIssue.identifier || rootIssue.id}`);
  for (const { philosopher, issue, wake } of childIssues) {
    console.log(`- ${philosopher.name}: ${issue.identifier || issue.id} (${wakeSummary(wake)})`);
  }
}

async function dialogue(args) {
  const philosopherToken = args[0];
  const request = args.slice(1).join(" ").trim();
  if (!philosopherToken || !request) {
    throw new Error('Usage: node scripts/agora.mjs dialogue <philosopher> "question"');
  }

  const philosopher = roleByToken(philosopherToken);
  if (!philosopher) throw new Error(`Unknown philosopher: ${philosopherToken}`);

  const agora = await getAgora();
  const agent = agora.agentsByName.get(philosopher.name);
  if (!agent) throw new Error(`Missing Paperclip agent: ${philosopher.name}`);

  const issue = await createIssue(agora.company.id, {
    title: `Диалог ${philosopher.name}: ${cleanTitle(request)}`,
    description: buildDialogueDescription({ request, philosopher }),
    status: "todo",
    workMode: "standard",
    priority: "high",
    projectId: agora.project.id,
    goalId: agora.goal.id,
    assigneeAgentId: agent.id,
    requestDepth: 0,
  });
  const wake = await wakeAgentSafe(agent.id, issue.id, `The Inner Agora dialogue: ${philosopher.name}`);

  console.log(`Created dialogue: ${issue.identifier || issue.id}`);
  console.log(wakeSummary(wake));
  console.log(`Open: http://127.0.0.1:3100/issues/${issue.id}`);
}

const terminalStatuses = new Set(["done", "blocked", "cancelled"]);
const allowedMoveStatuses = new Set(["todo", "in_progress", "blocked", "done", "cancelled"]);

function parseTasksArgs(args) {
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
      usage(0);
    } else {
      throw new Error(`Unknown tasks argument: ${arg}`);
    }
  }
  return { scope, limit };
}

function compactIssueLine(issue, agentById = new Map()) {
  const id = issue.identifier || issue.id;
  const assignee = issue.assigneeAgentId ? agentById.get(issue.assigneeAgentId)?.name || "assigned" : "-";
  const parent = issue.parentId ? " child" : " root";
  return `- ${String(issue.status || "unknown").padEnd(11)} ${id.padEnd(7)}${parent} assignee=${assignee} ${issue.title}`;
}

function issueNumber(issue) {
  const direct = Number(issue?.issueNumber);
  if (Number.isFinite(direct)) return direct;
  const match = String(issue?.identifier || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function byIssueNumber(left, right) {
  const delta = issueNumber(left) - issueNumber(right);
  if (delta) return delta;
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
}

function bareIssueRef(raw) {
  if (!DEFAULT_ISSUE_PREFIX) return "";
  const match = String(raw || "").match(/\b(\d{1,7})\b/);
  return match ? `${DEFAULT_ISSUE_PREFIX.toUpperCase()}-${match[1]}` : "";
}

function latestIssueRef(args) {
  const raw = args.join(" ");
  const match = raw.match(ISSUE_REF_RE);
  return match ? match[1].toUpperCase() : bareIssueRef(raw);
}

function withoutIssueRef(raw) {
  let text = String(raw || "").replace(ISSUE_REF_RE, " ");
  if (DEFAULT_ISSUE_PREFIX) text = text.replace(/\b\d{1,7}\b/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

async function resolveRootIssue(args, allIssues) {
  const explicitRef = latestIssueRef(args);
  if (explicitRef) {
    const issue = await api(`/issues/${explicitRef}`);
    if (!issue.parentId) return issue;
    return api(`/issues/${issue.parentId}`);
  }

  const roots = allIssues
    .filter((issue) => !issue.hiddenAt && !issue.parentId)
    .sort((left, right) => byIssueNumber(right, left));
  if (!roots.length) throw new Error("No root Agora sessions found in Paperclip.");
  return roots[0];
}

async function resolveTopRootIssue(issue) {
  let current = issue;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = await api(`/issues/${current.parentId}`);
  }
  return current;
}

function childrenOf(issue, allIssues) {
  return allIssues.filter((item) => item.parentId === issue.id && !item.hiddenAt).sort(byIssueNumber);
}

function isSynthesisIssue(issue, assistantId = "") {
  if (!issue) return false;
  const title = String(issue.title || "");
  if (/^Синтез:/i.test(title)) return true;
  return Boolean(assistantId && issue.assigneeAgentId === assistantId && /\b(синтез|synthesis|summary|итог)\b/i.test(title));
}

function latestSynthesisChild(issue, allIssues, agora) {
  return [...childrenOf(issue, allIssues)]
    .reverse()
    .find((child) => isSynthesisIssue(child, agora.assistant.id));
}

function hasSynthesisShape(text) {
  return /Реальный вопрос|Какой вопрос реально исследовался|Участники и их позиции|Карта позиций|Главные линии конфликта|Черновая матрица/i.test(
    normalizedDigestBody(text),
  );
}

function oneLine(text, limit = 420) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 15)).trim()} ... [clipped]`;
}

function extractHereDocBody(text) {
  const value = String(text || "");
  const match = value.match(/cat\s+<<['"]?([A-Za-z0-9_-]+)['"]?\s*\n([\s\S]*?)\n\1(?:\s|\)|$)/);
  if (match) return match[2].trim();
  const start = value.match(/cat\s+<<['"]?[A-Za-z0-9_-]+['"]?\s*\n/);
  return start ? value.slice((start.index || 0) + start[0].length).trim() : "";
}

function meaningfulBody(text) {
  let body = String(text || "").trim();
  const hereDoc = extractHereDocBody(body);
  if (hereDoc) body = hereDoc;
  body = body.split(/⚠️\s*File-mutation verifier:/i)[0].trim();
  body = body.replace(/```(?:bash|sh|zsh|shell)\s*[\s\S]*?```\s*/gi, "").trim();
  return body;
}

function normalizedDigestBody(text) {
  return meaningfulBody(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\*\*(\d+\.\s*[^*\n]+)\*\*\s*$/gm, "$1")
    .replace(/^\*\*(\d+\.\s*[^*\n]+)\*\*\s+(.+)$/gm, "$1\n$2")
    .trim();
}

function rootQuestion(issue) {
  const body = String(issue.description || "");
  const match = body.match(/Исходный вопрос:\s*\n([\s\S]*?)(?:\n\n|$)/);
  return oneLine(match ? match[1] : issue.title, 900);
}

function sectionBody(text, number) {
  const pattern = new RegExp(`(?:^|\\n)${number}\\.\\s+[^\\n]*\\n+([\\s\\S]*?)(?=\\n\\d+\\.\\s+|\\nПометки:|$)`);
  const match = normalizedDigestBody(text).match(pattern);
  return match ? match[1].trim() : "";
}

function bulletLines(text, limit = 5) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .slice(0, limit)
    .map((line) => oneLine(line.replace(/^\*\s+/, "- "), 520));
}

function paragraphLines(text, limit = 2) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((line) => oneLine(line, 620))
    .filter(Boolean)
    .slice(0, limit);
}

function synthesisComment(commentsList) {
  const visible = commentsList.filter((item) => !item.deletedAt && String(item.body || "").trim());
  const scored = visible
    .map((comment) => {
      const rawBody = String(comment.body || "");
      const body = normalizedDigestBody(rawBody);
      let score = body.length;
      if (/Реальный вопрос|Какой вопрос реально исследовался|Участники и их позиции|Карта позиций|Главные линии конфликта/i.test(body)) score += 100000;
      if (comment.authorType === "agent") score += 1000;
      if (/PAPERCLIP_API|curl\s+-|jq\s|X-Paperclip-Run-Id|```bash/i.test(rawBody) && !extractHereDocBody(rawBody)) score -= 50000;
      if (/Задача .* завершена|SYNTHESIS VERIFIED|Final disposition|already marked as done/i.test(body)) score -= 50000;
      if (/Paperclip needs a disposition|Автоматически закрыто через Paperclip cockpit monitor/i.test(body)) score -= 50000;
      return { comment, score };
    })
    .sort((left, right) => right.score - left.score);
  return scored[0]?.comment || null;
}

function printSynthesisDigest(comment) {
  const body = normalizedDigestBody(comment?.body || "");
  if (!body) {
    console.log("- Содержательного синтеза пока нет.");
    return false;
  }

  let printed = false;
  const positionsSection = /(?:^|\n)2\.\s+[^\n]*(участник|позици)/i.test(body) ? 2 : 3;
  const conflictsSection = positionsSection === 2 ? 3 : 4;
  const question = paragraphLines(sectionBody(body, 1), 1);
  const positions = bulletLines(sectionBody(body, positionsSection), 6);
  const positionParagraphs = positions.length ? [] : paragraphLines(sectionBody(body, positionsSection), 5);
  const conflicts = bulletLines(sectionBody(body, conflictsSection), 5);
  const unresolved = bulletLines(sectionBody(body, 6), 3);
  const next = paragraphLines(sectionBody(body, 7), 1);
  const notes = body.match(/Пометки:\s*([\s\S]*)$/)?.[1] || "";
  const noteLines = bulletLines(notes, 5);

  if (question.length) {
    console.log("Реальный вопрос:");
    for (const line of question) console.log(`- ${line}`);
    console.log("");
    printed = true;
  }

  if (positions.length) {
    console.log("Позиции:");
    for (const line of positions) console.log(line);
    console.log("");
    printed = true;
  }

  if (positionParagraphs.length) {
    console.log("Позиции:");
    for (const line of positionParagraphs) console.log(`- ${line}`);
    console.log("");
    printed = true;
  }

  if (conflicts.length) {
    console.log("Линии конфликта:");
    for (const line of conflicts) console.log(line);
    console.log("");
    printed = true;
  }

  if (unresolved.length) {
    console.log("Осталось нерешенным:");
    for (const line of unresolved) console.log(line);
    console.log("");
    printed = true;
  }

  if (next.length) {
    console.log("Следующий шаг:");
    for (const line of next) console.log(`- ${line}`);
    console.log("");
    printed = true;
  }

  if (noteLines.length) {
    console.log("Пометки:");
    for (const line of noteLines) console.log(line);
    printed = true;
  }
  return printed;
}

function printVoiceDigest(comment) {
  const body = normalizedDigestBody(comment?.body || "");
  if (!body) {
    console.log("- Содержательного ответа пока нет.");
    return false;
  }

  const sections = [
    ["Как он понял вопрос", sectionBody(body, 1)],
    ["Позиция", sectionBody(body, 2)],
    ["Что скрыто в вопросе", sectionBody(body, 3)],
  ]
    .map(([title, section]) => [title, paragraphLines(section, 1)])
    .filter(([, lines]) => lines.length);

  if (!sections.length) return false;
  for (const [title, lines] of sections) {
    console.log(`${title}:`);
    for (const line of lines) console.log(`- ${line}`);
    console.log("");
  }
  return true;
}

function printFallbackDigest(comment) {
  const body = normalizedDigestBody(comment?.body || "");
  if (!body) {
    console.log("- Содержательного результата пока нет.");
    return;
  }
  for (const line of paragraphLines(body, 6)) console.log(`- ${line}`);
}

function stripFullTokens(args = []) {
  const fullWords = new Set(["--full", "full", "подробно", "полностью"]);
  return {
    full: args.some((arg) => fullWords.has(String(arg).toLowerCase())),
    args: args.filter((arg) => !fullWords.has(String(arg).toLowerCase())),
  };
}

function commandVoiceName(child, agentById) {
  const titleName = String(child?.title || "").split(":", 1)[0].trim();
  if (titleName && !/^синтез$/i.test(titleName)) return titleName.split("/")[0].trim();
  const assignee = child?.assigneeAgentId ? agentById.get(child.assigneeAgentId)?.name || "" : "";
  if (assignee && assignee !== ASSISTANT_NAME) return assignee.split("/")[0].trim();
  return "";
}

function printSessionActions(root, philosopherChildren, synthesis, agentById) {
  const rootRef = root?.identifier || root?.id || "";
  if (!rootRef) return;
  const voiceNames = philosopherChildren.map((child) => commandVoiceName(child, agentById)).filter(Boolean).slice(0, 6);
  console.log("");
  console.log("Дальше:");
  if (synthesis) console.log(`- Синтез: /agora result ${synthesis.identifier || synthesis.id}`);
  else console.log(`- Собрать синтез: /agora synth ${rootRef}`);
  for (const name of voiceNames) console.log(`- ${name}: /agora voice ${name} ${rootRef}`);
}

function displayStatus(status) {
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

function displayTitle(issue) {
  let title = String(issue?.title || "").trim();
  title = title.replace(/^(Синтез:\s*){2,}/i, "Синтез: ");
  return oneLine(title, 220);
}

function issueKind(issue, assistantId = "") {
  if (isSynthesisIssue(issue, assistantId)) return "синтез";
  if (issue?.parentId) return "подзадача";
  return "пакет";
}

function issueByIdMap(issues) {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

function rootFromMap(issue, byId) {
  let current = issue;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId) || current;
    if (seen.has(current.id)) break;
  }
  return current;
}

async function status(args = []) {
  const issueRef = latestIssueRef(args);
  if (issueRef) return taskDetails([issueRef]);

  printActiveChamber();
  console.log("");

  const { company, agents } = await getAgora();
  const [issues, runs] = await Promise.all([
    api(`/companies/${company.id}/issues`),
    api(`/companies/${company.id}/heartbeat-runs`),
  ]);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const visibleIssues = issues.filter((issue) => !issue.hiddenAt);
  const visibleIssueRefs = new Set(visibleIssues.flatMap((issue) => [issue.id, issue.identifier].filter(Boolean)));

  console.log("The Inner Agora agents:");
  for (const agent of agents) {
    console.log(`- ${String(agent.status).padEnd(8)} ${agent.name}`);
  }
  console.log("");

  console.log("Recent Agora issues:");
  for (const issue of visibleIssues.slice(0, 12)) {
    console.log(compactIssueLine(issue, agentById));
  }

  console.log("\nRecent runs:");
  for (const run of runs
    .filter((run) => {
      const issue = run.contextSnapshot?.taskKey || run.contextSnapshot?.issueId;
      return issue && visibleIssueRefs.has(issue);
    })
    .slice(0, 12)) {
    const issue = run.contextSnapshot?.taskKey || run.contextSnapshot?.issueId || "?";
    const agent = agentById.get(run.agentId);
    const error = run.errorCode ? ` error=${run.errorCode}` : "";
    console.log(
      `- ${run.status.padEnd(10)} run=${run.id} issue=${issue} agent=${agent?.name || run.agentId}${error} updated=${run.updatedAt}`,
    );
  }
}

async function recheck(args = []) {
  const state = readState();
  const issueRef = latestIssueRef(args) || state.lastIssueRef || state.lastSynthesisRef || state.lastRootIssueRef || "";

  if (issueRef) {
    console.log(`Перепроверяю Paperclip API: ${issueRef}`);
    console.log("Источник истины: текущий объект issue в Paperclip, не память Telegram/Hermes.");
    console.log("");
    return taskDetails([issueRef]);
  }

  console.log("Не нашел последнего issue в локальной памяти bridge. Показываю последнюю Paperclip-сессию.");
  console.log("");
  return latest([]);
}

function tagList(item) {
  return Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
}

function normalizeTag(value) {
  return String(value || "").trim().toLowerCase();
}

function tagSummary() {
  const counts = new Map();
  for (const item of roles) {
    for (const tag of tagList(item)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function parsePhilosophersArgs(args) {
  const options = {
    showTags: false,
    tag: "",
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
      console.log("Usage: node scripts/agora.mjs philosophers [--tags|--tag TAG]");
      process.exit(0);
    } else {
      throw new Error(`Unknown philosophers option: ${arg}`);
    }
  }

  return options;
}

async function listPhilosophers(args = []) {
  const options = parsePhilosophersArgs(args);

  if (options.showTags) {
    console.log("# Теги философов");
    for (const [tag, count] of tagSummary()) console.log(`- ${tag}: ${count}`);
    console.log("");
    console.log(`Всего тегов: ${tagSummary().length}`);
    console.log(`Философов: ${roles.length}`);
    return;
  }

  const { agents } = await getAgora();
  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));
  const expectedNames = new Set(roles.map((item) => item.name));
  const filteredPhilosophers = options.tag
    ? roles.filter((item) => tagList(item).map(normalizeTag).includes(options.tag))
    : roles;
  const present = filteredPhilosophers.filter((item) => agentsByName.has(item.name));
  const extra = agents.filter((agent) => agent.name !== ASSISTANT_NAME && !expectedNames.has(agent.name));
  const assistant = agentsByName.get(ASSISTANT_NAME);

  console.log(options.tag ? `# Философы в Paperclip: tag=${options.tag}` : "# Философы в Paperclip");
  for (const item of filteredPhilosophers) {
    const agent = agentsByName.get(item.name);
    const statusLabel = agent ? String(agent.status || "unknown").padEnd(8) : "missing ";
    const dataTags = tagList(item);
    const paperclipTags = Array.isArray(agent?.metadata?.tags) ? agent.metadata.tags : [];
    const tagSync = agent && JSON.stringify(dataTags) !== JSON.stringify(paperclipTags) ? " metadata-tags=stale" : "";
    console.log(`- ${statusLabel} ${item.name} (${item.key}) tags=${dataTags.join(", ")}${tagSync}`);
  }

  console.log("");
  console.log(`Итого философов: ${present.length}/${filteredPhilosophers.length}`);
  if (options.tag) console.log(`Фильтр tag=${options.tag}; всего в roster: ${roles.length}`);
  console.log(`Agora Assistant: ${assistant ? assistant.status || "unknown" : "missing"}`);
  console.log(`Всего агентов в Paperclip: ${agents.length}`);

  if (extra.length) {
    console.log("");
    console.log("Лишние агенты не из активного roster:");
    for (const agent of extra) console.log(`- ${agent.status || "unknown"} ${agent.name}`);
  }
}

async function tasks(args) {
  const { scope, limit } = parseTasksArgs(args);
  const { company, agents } = await getAgora();
  const allIssues = await api(`/companies/${company.id}/issues`);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const visible = allIssues.filter((issue) => !issue.hiddenAt);
  const selected = visible
    .filter((issue) => scope === "all" || !terminalStatuses.has(issue.status))
    .slice(0, limit);

  console.log(`# The Inner Agora tasks (${scope}, limit=${limit})`);
  if (!selected.length) {
    console.log("- Нет задач в выбранном фильтре.");
    return;
  }
  for (const issue of selected) console.log(compactIssueLine(issue, agentById));
}

async function latest(args) {
  const agora = await getAgora();
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const root = await resolveRootIssue(args, allIssues);
  const children = childrenOf(root, allIssues);
  const synthesis = latestSynthesisChild(root, allIssues, agora);
  const philosopherChildren = children.filter((issue) => issue.id !== synthesis?.id);
  rememberIssue(synthesis || root, {
    lastRootIssueRef: root.identifier || root.id,
    lastRootIssueId: root.id,
    lastSynthesisRef: synthesis?.identifier || "",
    lastSynthesisId: synthesis?.id || "",
  });

  console.log(`# Последняя Paperclip-сессия: ${root.identifier || root.id}`);
  console.log(root.title);
  console.log(`- status: ${root.status}`);
  console.log(`- created: ${root.createdAt || "-"}`);
  console.log(`- updated: ${root.updatedAt || "-"}`);
  console.log(`- url: http://127.0.0.1:3100/issues/${root.id}`);
  console.log("");
  console.log("## Вопрос");
  console.log(rootQuestion(root));
  console.log("");
  console.log("## Подтаски");
  if (!children.length) {
    console.log("- Подтасок нет.");
  } else {
    for (const child of children) console.log(compactIssueLine(child, agentById));
  }
  console.log("");

  if (!synthesis) {
    console.log("## Выжимка");
    console.log("- Синтез-задача пока не найдена. Ниже только состояние философских child-задач.");
    for (const child of philosopherChildren) console.log(compactIssueLine(child, agentById));
    printSessionActions(root, philosopherChildren, null, agentById);
    return;
  }

  const commentsList = await api(`/issues/${synthesis.id}/comments`);
  const digestSource = synthesisComment(commentsList);

  console.log("## Выжимка");
  console.log(`Синтез: ${synthesis.identifier || synthesis.id}, status=${synthesis.status}`);
  if (digestSource?.createdAt) console.log(`Источник выжимки: comment ${digestSource.authorType || "unknown"} ${digestSource.createdAt}`);
  console.log("");
  printSynthesisDigest(digestSource);
  printSessionActions(root, philosopherChildren, synthesis, agentById);
}

function voiceChildren(root, allIssues, agora) {
  return childrenOf(root, allIssues).filter((child) => !isSynthesisIssue(child, agora.assistant.id));
}

function voiceChildScore(child, philosopher, agentById) {
  const assignee = child.assigneeAgentId ? agentById.get(child.assigneeAgentId)?.name || "" : "";
  return roleScoreInText(philosopher, `${child.title || ""} ${assignee}`);
}

function availableVoiceLines(children, agentById) {
  if (!children.length) return ["- В этой сессии пока нет отдельных философских задач."];
  return children.map((child) => {
    const assignee = child.assigneeAgentId ? agentById.get(child.assigneeAgentId)?.name || "" : "";
    const label = assignee || displayTitle(child);
    return `- ${label}: ${child.identifier || child.id}`;
  });
}

async function voice(args) {
  const parsed = stripFullTokens(args);
  const filteredArgs = parsed.args;
  const raw = filteredArgs.join(" ");
  const explicitRef = latestIssueRef(filteredArgs);
  const philosopherText = withoutIssueRef(raw);
  const philosopher = roleFromText(philosopherText);

  if (!philosopher && explicitRef) {
    const passthrough = [explicitRef];
    if (parsed.full) passthrough.push("--full");
    return result(passthrough);
  }

  const agora = await getAgora();
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const root = explicitRef ? await resolveRootIssue([explicitRef], allIssues) : await resolveRootIssue([], allIssues);
  const candidates = voiceChildren(root, allIssues, agora);

  if (!philosopher) {
    console.log("Кого показать?");
    console.log(`Сессия: ${root.identifier || root.id}`);
    console.log("");
    for (const line of availableVoiceLines(candidates, agentById)) console.log(line);
    return;
  }

  const child = candidates
    .map((candidate) => ({ candidate, score: voiceChildScore(candidate, philosopher, agentById) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || byIssueNumber(left.candidate, right.candidate))[0]?.candidate;

  if (!child) {
    console.log(`Не нашел отдельную задачу для: ${philosopher.name}`);
    console.log(`Сессия: ${root.identifier || root.id}`);
    console.log("");
    console.log("Доступные голоса:");
    for (const line of availableVoiceLines(candidates, agentById)) console.log(line);
    return;
  }

  console.log(`# Голос: ${philosopher.name}`);
  console.log(`Сессия: ${root.identifier || root.id}`);
  console.log("");
  const resultArgs = [child.identifier || child.id];
  if (parsed.full) resultArgs.push("--full");
  return result(resultArgs);
}

async function result(args) {
  const full = args.includes("--full") || args.includes("full") || args.includes("полностью");
  const filteredArgs = args.filter((arg) => !["--full", "full", "полностью"].includes(arg));
  const agora = await getAgora();
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const explicitRef = latestIssueRef(filteredArgs);

  let target;
  let root = null;
  let sourceNote = "";

  if (explicitRef) {
    const issue = await api(`/issues/${explicitRef}`);
    if (!issue.parentId) {
      root = issue;
      target = latestSynthesisChild(root, allIssues, agora) || root;
      if (target.id !== root.id) sourceNote = `Показан последний синтез пакета ${root.identifier || root.id}.`;
    } else {
      target = issue;
      root = await resolveTopRootIssue(issue);
    }
  } else {
    root = await resolveRootIssue([], allIssues);
    target = latestSynthesisChild(root, allIssues, agora) || root;
    if (target.id !== root.id) sourceNote = `Показан последний синтез пакета ${root.identifier || root.id}.`;
  }

  const nested = latestSynthesisChild(target, allIssues, agora);
  let commentsList = await api(`/issues/${target.id}/comments`);
  let digestSource = synthesisComment(commentsList);

  if (nested) {
    const nestedComments = await api(`/issues/${nested.id}/comments`);
    const nestedSource = synthesisComment(nestedComments);
    const targetBody = String(digestSource?.body || "");
    const nestedBody = String(nestedSource?.body || "");
    if (!hasSynthesisShape(targetBody) && hasSynthesisShape(nestedBody)) {
      target = nested;
      commentsList = nestedComments;
      digestSource = nestedSource;
      sourceNote = `Показан вложенный синтез ${nested.identifier || nested.id}; исходная задача была ${explicitRef || root?.identifier || root?.id}.`;
    }
  }
  rememberIssue(target, {
    lastRootIssueRef: root?.identifier || "",
    lastRootIssueId: root?.id || "",
    lastSynthesisRef: isSynthesisIssue(target, agora.assistant.id) ? target.identifier || target.id : "",
    lastSynthesisId: isSynthesisIssue(target, agora.assistant.id) ? target.id : "",
  });

  console.log(`# Результат: ${target.identifier || target.id}`);
  console.log(target.title);
  console.log(`- status: ${target.status}`);
  if (root && root.id !== target.id) console.log(`- пакет: ${root.identifier || root.id}`);
  console.log(`- url: http://127.0.0.1:3100/issues/${target.id}`);
  if (digestSource?.createdAt) console.log(`- источник: comment ${digestSource.authorType || "unknown"} ${digestSource.createdAt}`);
  if (sourceNote) console.log(`- примечание: ${sourceNote}`);
  console.log("");

  if (full) {
    console.log(String(digestSource?.body || "").trim() || "Содержательного результата пока нет.");
    return;
  }

  const printedDigest = isSynthesisIssue(target, agora.assistant.id) ? printSynthesisDigest(digestSource) : printVoiceDigest(digestSource);
  if (!printedDigest && !hasSynthesisShape(String(digestSource?.body || ""))) printFallbackDigest(digestSource);
  if (root) {
    const synthesis = isSynthesisIssue(target, agora.assistant.id) ? target : latestSynthesisChild(root, allIssues, agora);
    const philosopherChildren = childrenOf(root, allIssues).filter((issue) => issue.id !== synthesis?.id);
    printSessionActions(root, philosopherChildren, synthesis, agentById);
  }
}

async function taskDetails(args) {
  const parsed = stripFullTokens(args);
  const issueRef = parsed.args[0];
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs task <issue-id-or-key>");

  const agora = await getAgora();
  const issue = await api(`/issues/${issueRef}`);
  rememberIssue(issue);
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const byId = issueByIdMap(allIssues);
  const children = childrenOf(issue, allIssues);
  const parent = issue.parentId ? byId.get(issue.parentId) : null;
  const root = rootFromMap(issue, byId);

  if (!parsed.full) {
    const assignee = issue.assigneeAgentId ? agentById.get(issue.assigneeAgentId)?.name || issue.assigneeAgentId : "";
    console.log(`${issue.identifier || issue.id} — ${issueKind(issue, agora.assistant.id)}`);
    console.log(displayTitle(issue));
    console.log(`Статус: ${displayStatus(issue.status)}`);
    if (assignee) console.log(`Исполнитель: ${assignee}`);
    if (parent) console.log(`Родитель: ${parent.identifier || parent.id}`);
    if (root && root.id !== issue.id) console.log(`Пакет: ${root.identifier || root.id}`);
    if (children.length) {
      const done = children.filter((child) => terminalStatuses.has(child.status)).length;
      console.log(`Подзадачи: ${done}/${children.length} в финальном статусе`);
    }
    console.log(`Открыть: http://127.0.0.1:3100/issues/${issue.id}`);
    return;
  }

  const comments = await api(`/issues/${issue.id}/comments`);

  console.log(`# ${issue.identifier || issue.id}: ${issue.title}`);
  console.log(`- status: ${issue.status}`);
  console.log(`- priority: ${issue.priority || "unknown"}`);
  console.log(`- assignee: ${issue.assigneeAgentId ? agentById.get(issue.assigneeAgentId)?.name || issue.assigneeAgentId : "-"}`);
  console.log(`- parent: ${issue.parentId || "-"}`);
  console.log(`- url: http://127.0.0.1:3100/issues/${issue.id}`);
  console.log("");
  console.log("## Children");
  if (!children.length) console.log("- Нет child-задач.");
  for (const child of children) console.log(compactIssueLine(child, agentById));
  console.log("");
  console.log("## Last comments");
  const lastComments = comments.slice(-3);
  if (!lastComments.length) console.log("- Комментариев нет.");
  for (const comment of lastComments) {
    const body = String(comment.body || "").replace(/\s+/g, " ").trim().slice(0, 500);
    console.log(`- ${comment.authorType || "unknown"} ${comment.createdAt || ""}: ${body}`);
  }
}

async function moveIssue(args) {
  const [issueRef, nextStatus] = args;
  if (!issueRef || !nextStatus) {
    throw new Error("Usage: node scripts/agora.mjs move <issue-id-or-key> <todo|in_progress|blocked|done|cancelled>");
  }
  if (!allowedMoveStatuses.has(nextStatus)) {
    throw new Error(`Unsupported status: ${nextStatus}. Allowed: ${[...allowedMoveStatuses].join(", ")}`);
  }

  const issue = await api(`/issues/${issueRef}`);
  rememberIssue(issue);
  if (issue.status === nextStatus) {
    console.log(`${issue.identifier || issue.id} already ${nextStatus}`);
    return;
  }

  await addComment(issue.id, `Статус вручную изменен через Inner Agora bridge: ${issue.status} -> ${nextStatus}.`);
  const updated = await updateIssue(issue.id, { status: nextStatus });
  console.log(`Moved ${updated.identifier || issue.identifier || issue.id}: ${issue.status} -> ${nextStatus}`);
  console.log(`Open: http://127.0.0.1:3100/issues/${issue.id}`);
}

async function comments(args) {
  const issueRef = args[0];
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs comments <issue-id-or-key>");

  const issue = await api(`/issues/${issueRef}`);
  rememberIssue(issue);
  const items = await api(`/issues/${issue.id}/comments`);
  console.log(`# ${issue.identifier || issue.id}: ${issue.title}`);
  console.log(`Status: ${issue.status}`);
  console.log("");
  for (const item of items) {
    console.log(`--- ${item.authorType} ${item.createdAt} ---`);
    console.log(item.body);
    console.log("");
  }
}

async function childBlock(child) {
  const comments = await api(`/issues/${child.id}/comments`);
  return [
    `## ${child.identifier || child.id}: ${child.title}`,
    "",
    `Status: ${child.status}`,
    "",
    "### Task description",
    "",
    clip(child.description || "", 2500),
    "",
    "### Comments",
    "",
    comments.length
      ? comments
          .slice(-5)
          .map((comment) => `#### ${comment.authorType || "unknown"} ${comment.createdAt || ""}\n\n${clip(comment.body, 3500)}`)
          .join("\n\n")
      : "No comments yet.",
  ].join("\n");
}

async function synthesize(args) {
  const fresh = args.includes("--fresh");
  const filteredArgs = args.filter((arg) => arg !== "--fresh");
  const issueRef = latestIssueRef(filteredArgs);

  const agora = await getAgora();
  let allIssues = await api(`/companies/${agora.company.id}/issues`);
  const root = issueRef ? await api(`/issues/${issueRef}`) : await resolveRootIssue([], allIssues);
  rememberIssue(root, { lastRootIssueRef: root.identifier || root.id, lastRootIssueId: root.id });
  if (isSynthesisIssue(root, agora.assistant.id)) {
    const parent = root.parentId ? await resolveTopRootIssue(root) : null;
    console.log(`${root.identifier || root.id} уже является задачей синтеза.`);
    console.log(`Результат: node scripts/agora.mjs result ${root.identifier || root.id}`);
    if (parent && parent.id !== root.id) {
      console.log(`Новый синтез всего пакета: node scripts/agora.mjs synthesize ${parent.identifier || parent.id}`);
    }
    return;
  }

  if (root.parentId) {
    const parent = await resolveTopRootIssue(root);
    console.log(`${root.identifier || root.id} является child-задачей, а synth ожидает корневой пакет.`);
    console.log(`Новый синтез всего пакета: node scripts/agora.mjs synthesize ${parent.identifier || parent.id}`);
    console.log(`Результат этой задачи: node scripts/agora.mjs result ${root.identifier || root.id}`);
    return;
  }

  const existing = latestSynthesisChild(root, allIssues, agora);
  if (existing && !fresh) {
    rememberIssue(existing, {
      lastRootIssueRef: root.identifier || root.id,
      lastRootIssueId: root.id,
      lastSynthesisRef: existing.identifier || existing.id,
      lastSynthesisId: existing.id,
    });
    console.log(`Синтез уже есть: ${existing.identifier || existing.id}`);
    console.log(`status=${existing.status}`);
    console.log(`Результат: node scripts/agora.mjs result ${existing.identifier || existing.id}`);
    console.log(`Open: http://127.0.0.1:3100/issues/${existing.id}`);
    return;
  }

  const children = childrenOf(root, allIssues);

  const childBlocks = await Promise.all(children.map(childBlock));
  const description = [
    "Agora Assistant: собери синтез философской сессии.",
    "",
    "Не изображай голоса, которых нет в материалах. Если child-задачи еще пустые, явно скажи, что синтез предварительный.",
    "",
    "Формат:",
    "1. Реальный вопрос сессии.",
    "2. Участники и их позиции.",
    "3. Главные линии конфликта.",
    "4. Скрытые предпосылки вопроса.",
    "5. Сильнейшие аргументы.",
    "6. Нерешенные вопросы.",
    "7. Следующий исследовательский или практический шаг.",
    "8. Как использованы пометки: источники, реконструкции, имитации, современные переносы, что требует проверки.",
    "",
    "Ограничения:",
    "- Не стирай пометки философов о типе утверждения.",
    "- Не превращай [имитация] или [реконструкция] в якобы подтвержденный источник.",
    "- Если источник требует проверки, сохрани это как исследовательский долг.",
    "",
    "Корневая сессия:",
    `# ${root.identifier || root.id}: ${root.title}`,
    "",
    clip(root.description || "", 4000),
    "",
    "# Материалы философов",
    "",
    childBlocks.length ? childBlocks.join("\n\n---\n\n") : "Child-задач нет.",
  ].join("\n");

  const synthesis = await createIssue(agora.company.id, {
    title: `Синтез: ${root.title}`,
    description: clip(description, 24000),
    status: "todo",
    workMode: "standard",
    priority: "high",
    projectId: agora.project.id,
    goalId: agora.goal.id,
    parentId: root.id,
    assigneeAgentId: agora.assistant.id,
    requestDepth: 1,
  });

  const wake = await wakeAgentSafe(agora.assistant.id, synthesis.id, "The Inner Agora synthesis requested", {
    forceFreshSession: fresh,
    idempotencyKey: `inner-agora:synthesis:${synthesis.id}:${agora.assistant.id}`,
  });

  await addComment(
    root.id,
    [`Создана задача синтеза: ${synthesis.identifier || synthesis.id}.`, wakeSummary(wake)].join("\n"),
  );
  rememberIssue(synthesis, {
    lastRootIssueRef: root.identifier || root.id,
    lastRootIssueId: root.id,
    lastSynthesisRef: synthesis.identifier || synthesis.id,
    lastSynthesisId: synthesis.id,
  });

  console.log(`Created synthesis issue: ${synthesis.identifier || synthesis.id}`);
  console.log(wakeSummary(wake));
  console.log(`Open: http://127.0.0.1:3100/issues/${synthesis.id}`);
}

function collectSubtree(root, allIssues) {
  const byParent = new Map();
  for (const issue of allIssues.filter((item) => !item.hiddenAt)) {
    if (!issue.parentId) continue;
    const items = byParent.get(issue.parentId) || [];
    items.push(issue);
    byParent.set(issue.parentId, items);
  }

  const items = [];
  function visit(issue, depth) {
    for (const child of (byParent.get(issue.id) || []).sort(byIssueNumber)) {
      items.push({ issue: child, depth });
      visit(child, depth + 1);
    }
  }
  visit(root, 1);
  return { items, byParent };
}

async function finalize(args) {
  const dryRun = args.includes("--dry-run");
  const issueRef = latestIssueRef(args);
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs finalize <issue-id-or-key> [--dry-run]");

  const agora = await getAgora();
  const start = await api(`/issues/${issueRef}`);
  const root = await resolveTopRootIssue(start);
  rememberIssue(root, { lastRootIssueRef: root.identifier || root.id, lastRootIssueId: root.id });
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const { items, byParent } = collectSubtree(root, allIssues);
  const issueById = new Map([[root.id, root], ...items.map(({ issue }) => [issue.id, issue])]);
  const changed = [];

  function visibleChildren(issue) {
    return (byParent.get(issue.id) || []).filter((child) => !child.hiddenAt).sort(byIssueNumber);
  }

  for (const { issue } of [...items].sort((left, right) => right.depth - left.depth || byIssueNumber(right.issue, left.issue))) {
    const kids = visibleChildren(issue);
    if (!kids.length || terminalStatuses.has(issue.status)) continue;
    if (!kids.every((child) => terminalStatuses.has(issueById.get(child.id)?.status || child.status))) continue;

    if (!dryRun) {
      await addComment(issue.id, "Пакет автоматически закрыт через Inner Agora bridge: все дочерние задачи в финальных статусах.");
      await updateIssue(issue.id, { status: "done" });
      issue.status = "done";
    }
    changed.push(issue);
  }

  const rootChildren = visibleChildren(root);
  const openRootChildren = rootChildren.filter((child) => !terminalStatuses.has(issueById.get(child.id)?.status || child.status));

  console.log(`# Закрытие пакета: ${root.identifier || root.id}`);
  console.log(root.title);
  console.log(`- dryRun: ${dryRun ? "yes" : "no"}`);
  console.log(`- root status: ${root.status}`);
  console.log(`- children: ${rootChildren.length}`);

  if (openRootChildren.length) {
    console.log("");
    console.log("Не закрываю корневой пакет: есть незавершенные child-задачи.");
    for (const child of openRootChildren) console.log(compactIssueLine(child, agentById));
    if (changed.length) {
      console.log("");
      console.log("Закрытые вложенные пакеты:");
      for (const issue of changed) console.log(`- ${issue.identifier || issue.id}`);
    }
    return;
  }

  if (rootChildren.length && !terminalStatuses.has(root.status)) {
    if (!dryRun) {
      await addComment(root.id, "Пакет закрыт через Inner Agora bridge: все дочерние задачи завершены или находятся в финальном статусе.");
      await updateIssue(root.id, { status: "done" });
      root.status = "done";
    }
    changed.push(root);
  }

  console.log("");
  if (!changed.length) {
    console.log("Изменений нет: пакет уже закрыт или не требует автозакрытия.");
  } else {
    console.log(dryRun ? "Можно закрыть:" : "Закрыто:");
    for (const issue of changed) console.log(`- ${issue.identifier || issue.id}: ${issue.title}`);
  }
  console.log(`Open: http://127.0.0.1:3100/issues/${root.id}`);
}

function slugify(text, fallback = "session") {
  const slug = String(text || "")
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 100)
    .trim()
    .replace(/\s/g, "-");
  return slug || fallback;
}

async function exportMemory(args) {
  const issueRef = args[0];
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs export-memory <issue-id-or-key>");

  const issue = await api(`/issues/${issueRef}`);
  rememberIssue(issue);
  const commentsList = await api(`/issues/${issue.id}/comments`);
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const filePath = path.join(MEMORY_DIR, `${issue.identifier || issue.id}-${slugify(issue.title)}.md`);
  const body = [
    "---",
    `paperclip_id: ${JSON.stringify(issue.id)}`,
    `identifier: ${JSON.stringify(issue.identifier || "")}`,
    `status: ${JSON.stringify(issue.status || "")}`,
    `created: ${JSON.stringify(issue.createdAt || "")}`,
    `updated: ${JSON.stringify(issue.updatedAt || "")}`,
    "source: paperclip",
    "---",
    "",
    `# ${issue.identifier || issue.id}: ${issue.title}`,
    "",
    `Paperclip: http://127.0.0.1:3100/issues/${issue.id}`,
    "",
    "## Description",
    "",
    issue.description || "",
    "",
    "## Comments",
    "",
    commentsList.length
      ? commentsList
          .map((comment) => `### ${comment.authorType || "unknown"} ${comment.createdAt || ""}\n\n${comment.body || ""}`)
          .join("\n\n")
      : "No comments.",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  console.log(`Exported: ${filePath}`);
}

function startExampleForChamber(chamber) {
  if (chamber.id === "board-directors") {
    return {
      chamber: chamber.id,
      text: "совет директоров, нужен go/no-go по найму CTO",
    };
  }
  return {
    chamber: chamber.id,
    text: "давай спросим агору про свободу ребенка и власть родителей",
  };
}

function buildStartExamples(chambers) {
  return chambers.map(startExampleForChamber);
}

function printStartOnboarding(payload) {
  console.log(payload.title);
  console.log("");
  console.log("Пиши обычным языком: я пойму вопрос, выберу палату и создам задачи в Paperclip.");
  console.log(`Понимание текста: ${payload.routingMode === "llm" ? "локальная модель" : "детерминированный fallback"}.`);
  console.log("");
  console.log("Палаты:");
  for (const chamber of payload.chambers) {
    const marker = chamber.id === payload.activeChamberId ? "*" : "-";
    console.log(`${marker} ${chamber.id}: ${chamber.name}`);
  }
  console.log("");
  console.log("Можно начать так:");
  for (const example of payload.examples) console.log(`- ${example.text}`);
}

async function start(args = []) {
  const json = args.includes("--json");
  const state = readState();
  const chambers = listChambers(CHAMBERS_DIR).map((chamber) => ({
    id: chamber.id,
    name: chamber.name,
    status: chamber.status,
  }));
  const payload = {
    title: "The Inner Agora",
    activeChamberId: activeChamberId(state),
    routingMode: process.env.ROUTING_MODE || "regex",
    chambers,
    examples: buildStartExamples(chambers),
  };
  if (json) process.stdout.write(stableJson(payload));
  else printStartOnboarding(payload);
  return payload;
}

function wizardInitialSlots() {
  return {
    intent: "new_session",
    chamber: null,
    mode: "balanced",
    topic: null,
    roles: [],
    taskRef: null,
    missingSlots: ["topic"],
    confidence: 0.8,
  };
}

function writeWizard(wizard) {
  return writeState({ wizard });
}

function chamberChoiceLines() {
  return listChambers(CHAMBERS_DIR).map((chamber, index) => `${index + 1}. ${chamber.id} — ${chamber.name}`);
}

function printChamberQuestion() {
  console.log("В какую палату поставить вопрос?");
  for (const line of chamberChoiceLines()) console.log(line);
}

function printModeQuestion() {
  console.log("Какую глубину разбора выбрать?");
  console.log("1. коротко");
  console.log("2. обычно");
  console.log("3. глубоко");
}

function parseWizardChamber(answer) {
  const value = looseText(answer);
  const chambers = listChambers(CHAMBERS_DIR);
  if (value === "1") return chambers[0]?.id || DEFAULT_CHAMBER_ID;
  if (value === "2") return chambers[1]?.id || chambers[0]?.id || DEFAULT_CHAMBER_ID;
  if (value.includes("board") || value.includes("директор") || value.includes("бизнес")) return "board-directors";
  if (value.includes("philosophy") || value.includes("философ") || value.includes("агора")) return "philosophy";
  return chambers.find((chamber) => value.includes(looseText(chamber.id)) || value.includes(looseText(chamber.name)))?.id || "";
}

function parseWizardMode(answer) {
  const value = looseText(answer);
  if (value === "1" || value.includes("корот") || value.includes("кратк") || value.includes("min")) return "min";
  if (value === "3" || value.includes("глуб") || value.includes("подроб") || value.includes("max")) return "max";
  if (value === "2" || value.includes("обыч") || value.includes("баланс") || value.includes("balanced")) return "balanced";
  return "";
}

function wizardConfirmed(answer) {
  return /^(да|yes|y|go|ок|окей|запускай|start)$/i.test(looseText(answer));
}

function wizardCancelled(answer) {
  return /^(нет|no|n|cancel|отмена|стоп)$/i.test(looseText(answer));
}

function printWizardConfirmation(slots) {
  const plan = decideNextStep(slots, {});
  console.log("Запускать?");
  console.log(plan.text || "/agora ask");
  console.log("Ответь: да / нет");
}

async function wizard(args = []) {
  writeWizard({
    step: "topic",
    slots: wizardInitialSlots(),
    startedAt: new Date().toISOString(),
  });
  console.log("Какой вопрос поставить в Агору?");
}

async function wizardAnswer(args = []) {
  const answer = args.join(" ").trim();
  if (!answer) throw new Error('Usage: node scripts/agora.mjs wizard-answer "answer"');

  const state = readState();
  const current = state.wizard && typeof state.wizard === "object" ? state.wizard : null;
  if (!current?.step) return wizard([]);
  if (wizardCancelled(answer)) {
    writeWizard(null);
    console.log("Ок, wizard отменен.");
    return;
  }

  const slots = { ...wizardInitialSlots(), ...(current.slots || {}) };
  if (current.step === "topic") {
    slots.topic = answer;
    slots.missingSlots = [];
    writeWizard({ ...current, step: "chamber", slots, updatedAt: new Date().toISOString() });
    printChamberQuestion();
    return;
  }

  if (current.step === "chamber") {
    const chamber = parseWizardChamber(answer);
    if (!chamber) {
      printChamberQuestion();
      return;
    }
    slots.chamber = chamber;
    writeWizard({ ...current, step: "mode", slots, updatedAt: new Date().toISOString() });
    printModeQuestion();
    return;
  }

  if (current.step === "mode") {
    const mode = parseWizardMode(answer);
    if (!mode) {
      printModeQuestion();
      return;
    }
    slots.mode = mode;
    writeWizard({ ...current, step: "confirm", slots, updatedAt: new Date().toISOString() });
    printWizardConfirmation(slots);
    return;
  }

  if (current.step === "confirm") {
    if (!wizardConfirmed(answer)) {
      console.log("Ответь: да / нет");
      return;
    }
    writeWizard(null);
    const plan = decideNextStep(slots, {});
    if (plan.action !== "command") throw new Error(plan.question || "Wizard could not build a command");
    return runPlannedCommand(plan.command);
  }

  writeWizard(null);
  return wizard([]);
}

function parseNaturalArgs(args = []) {
  const options = {
    routingMode: process.env.ROUTING_MODE || "regex",
    json: false,
    dryRun: false,
    text: "",
  };
  const textParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--routing-mode") {
      options.routingMode = args[++index] || options.routingMode;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      textParts.push(arg);
    }
  }
  options.text = textParts.join(" ").trim();
  if (!options.text) throw new Error('Usage: node scripts/agora.mjs natural "human text"');
  return options;
}

function naturalFollowUpRequested(text) {
  const value = looseText(text);
  return /уточн|продолж|спроси еще|по этой сессии|а что если/.test(value);
}

function naturalContext(text) {
  const state = readState();
  const lastRootIssueRef = state.lastRootIssueRef || "";
  return {
    lastRootIssueRef,
    isFollowUp: Boolean(lastRootIssueRef && naturalFollowUpRequested(text)),
  };
}

async function understand(args = []) {
  const options = parseNaturalArgs(args);
  const context = naturalContext(options.text);
  const extracted = await extractIntentSlots(options.text, { routingMode: options.routingMode, context });
  const plan = decideNextStep(extracted.slots, context);
  const payload = { ...extracted, plan };
  if (options.json) {
    process.stdout.write(stableJson(payload));
    return payload;
  }
  console.log(`${payload.source}: ${payload.slots.intent}`);
  console.log(plan.text || plan.question || plan.action);
  return payload;
}

async function runPlannedCommand(command) {
  const [, plannedCommand, ...plannedArgs] = command;
  if (plannedCommand === "ask") return ask(plannedArgs);
  if (plannedCommand === "wizard") return wizard(plannedArgs);
  if (plannedCommand === "wizard-answer") return wizardAnswer(plannedArgs);
  if (plannedCommand === "latest") return latest(plannedArgs);
  if (plannedCommand === "voice") return voice(plannedArgs);
  if (plannedCommand === "task") return taskDetails(plannedArgs);
  if (plannedCommand === "help") return usage(0);
  throw new Error(`Unsupported natural command: ${command.join(" ")}`);
}

function naturalCommandPayload(command, options, extra = {}) {
  const text = command.join(" ");
  const payload = {
    action: "rewrite",
    text,
    plan: { action: "command", command, text, ...(extra.plan || {}) },
    ...extra,
  };
  if (options.json) process.stdout.write(stableJson(payload));
  else console.log(payload.text);
  return payload;
}

async function natural(args = []) {
  const options = parseNaturalArgs(args);
  const wizardState = readState().wizard;
  if (wizardState?.step) {
    const command = ["/agora", "wizard-answer", options.text];
    if (options.dryRun || options.json) return naturalCommandPayload(command, options);
    return runPlannedCommand(command);
  }

  const context = naturalContext(options.text);
  const extracted = await extractIntentSlots(options.text, { routingMode: options.routingMode, context });
  const plan = decideNextStep(extracted.slots, context);

  if (options.dryRun || options.json) {
    if (plan.action === "clarify" && Array.isArray(plan.missingSlots) && plan.missingSlots.includes("topic")) {
      return naturalCommandPayload(["/agora", "wizard"], options, { source: extracted.source, slots: extracted.slots, plan });
    }
    const payload =
      plan.action === "command"
        ? { action: "rewrite", text: plan.text, source: extracted.source, slots: extracted.slots, plan }
        : { action: "message", text: plan.question, source: extracted.source, slots: extracted.slots, plan };
    if (options.json) process.stdout.write(stableJson(payload));
    else console.log(payload.text);
    return payload;
  }

  if (plan.action === "clarify") {
    if (Array.isArray(plan.missingSlots) && plan.missingSlots.includes("topic")) return wizard([]);
    console.log(plan.question);
    return plan;
  }
  return runPlannedCommand(plan.command);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") usage(0);

  if (command === "prepare") return prepare(args);
  if (command === "mode") return modeCommand(args);
  if (command === "chamber" || command === "палата") return chamberCommand(args);
  if (command === "policy") return policyCommand(args);
  if (command === "skills") return skillsCommand(args);
  if (command === "start") return start(args);
  if (command === "wizard") return wizard(args);
  if (command === "wizard-answer" || command === "wizard_answer") return wizardAnswer(args);
  if (command === "understand") return understand(args);
  if (command === "natural") return natural(args);
  if (command === "council" || command === "minimum-council" || command === "mvp") return minimumCouncil(args);
  if (command === "ask") return ask(args);
  if (command === "follow-up" || command === "followup") return followUp(args);
  if (command === "dialogue") return dialogue(args);
  if (command === "synthesize" || command === "synth") return synthesize(args);
  if (command === "export-memory") return exportMemory(args);
  if (command === "philosophers" || command === "agents") return listPhilosophers(args);
  if (command === "status") return status(args);
  if (command === "recheck" || command === "verify" || command === "перепроверь" || command === "сверь") return recheck(args);
  if (command === "tasks") return tasks(args);
  if (command === "latest" || command === "last" || command === "brief") return latest(args);
  if (command === "result" || command === "outcome" || command === "итог" || command === "результат") return result(args);
  if (command === "voice" || command === "голос") return voice(args);
  if (command === "task" || command === "session" || command === "issue" || command === "задача" || command === "сессия") return taskDetails(args);
  if (command === "finalize" || command === "close" || command === "закрыть") return finalize(args);
  if (command === "move") return moveIssue(args);
  if (command === "comments" || command === "notes" || command === "заметки" || command === "комментарии") return comments(args);

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
