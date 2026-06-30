#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "data", "philosophers.json");
const STATE_PATH = process.env.INNER_AGORA_STATE_PATH || path.join(ROOT, ".inner-agora-state.json");
const API_BASE = process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api";
const COMPANY_NAME = process.env.INNER_AGORA_COMPANY_NAME || "The Inner Agora";
const ASSISTANT_NAME = "Agora Assistant / Синтезатор";
const PROJECT_NAME = process.env.INNER_AGORA_PROJECT_NAME || "Agora Sessions";
const GOAL_TITLE = process.env.INNER_AGORA_GOAL_TITLE || "Run philosophical research dialogues with The Inner Agora";
const DEFAULT_MODE = "balanced";
const DEFAULT_CODEX_MODEL = process.env.INNER_AGORA_CODEX_MODEL || "gpt-5.4";
const DEFAULT_HERMES_MODEL = process.env.INNER_AGORA_HERMES_MODEL || "google/gemma-4-26b-a4b-qat";
const MEMORY_DIR = process.env.INNER_AGORA_MEMORY_DIR || path.join(ROOT, "memory", "sessions");
const MINIMUM_COUNCIL_KEYS = ["plato", "descartes", "heidegger"];

const philosophers = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const philosopherByKey = new Map(philosophers.map((item) => [item.key, item]));

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/agora.mjs prepare [local|balanced|max]
  node scripts/agora.mjs council [--dry-run] "question"
  node scripts/agora.mjs ask [--min|--balanced|--max|--all] [--philosophers list] "question"
  node scripts/agora.mjs ask --dry-run --philosophers socrates,kant "question"
  node scripts/agora.mjs dialogue <philosopher> "question"
  node scripts/agora.mjs synthesize <root-issue-id-or-key> [--fresh]
  node scripts/agora.mjs export-memory <issue-id-or-key>
  node scripts/agora.mjs philosophers [--tags|--tag TAG]
  node scripts/agora.mjs mode [get|set <min|balanced|max|local>|--raw]
  node scripts/agora.mjs status
  node scripts/agora.mjs recheck [issue-id-or-key]
  node scripts/agora.mjs tasks [--all|--open] [--limit N]
  node scripts/agora.mjs latest [issue-id-or-key]
  node scripts/agora.mjs result [issue-id-or-key] [--full]
  node scripts/agora.mjs task <issue-id-or-key>
  node scripts/agora.mjs finalize <issue-id-or-key> [--dry-run]
  node scripts/agora.mjs move <issue-id-or-key> <todo|in_progress|blocked|done|cancelled>
  node scripts/agora.mjs comments <issue-id-or-key>

Modes:
  council   fixed MVP council: Plato, Descartes, Heidegger
  min       3 voices, usually architects or explicitly selected philosophers
  balanced 7 voices by default
  max       12 voices by default
  all       every philosopher in data/philosophers.json
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
  const companies = await api("/companies");
  const company = companies.find((item) => item.name === COMPANY_NAME && item.status !== "archived");
  if (!company) {
    throw new Error(`Company not found: ${COMPANY_NAME}. Run: node scripts/import-inner-agora.mjs`);
  }

  const [agents, projects, goals] = await Promise.all([
    api(`/companies/${company.id}/agents`),
    api(`/companies/${company.id}/projects`),
    api(`/companies/${company.id}/goals`),
  ]);

  const assistant = agents.find((agent) => agent.name === ASSISTANT_NAME);
  const project = projects.find((item) => item.name === PROJECT_NAME);
  const goal = goals.find((item) => item.title === GOAL_TITLE);
  if (!assistant || !project || !goal) {
    throw new Error("The Inner Agora is incomplete. Run: node scripts/import-inner-agora.mjs");
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

function philosopherByToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  return philosophers.find((item) => {
    return (
      item.key === normalized ||
      item.name.toLowerCase() === normalized ||
      item.englishName.toLowerCase() === normalized ||
      (item.aliases || []).some((alias) => alias.toLowerCase() === normalized)
    );
  });
}

function uniquePhilosophers(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

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

  const forwarded = [
    "--min",
    "--philosophers",
    MINIMUM_COUNCIL_KEYS.join(","),
    ...(dryRun ? ["--dry-run"] : []),
    request,
  ];
  return ask(forwarded);
}

function selectPhilosophers(request, mode, philosopherList, options = {}) {
  if (philosopherList) {
    const selected = philosopherList
      .split(",")
      .map((token) => philosopherByToken(token))
      .filter(Boolean);
    if (!selected.length) throw new Error(`No known philosophers in --philosophers ${philosopherList}`);
    return uniquePhilosophers(selected);
  }

  if (mode === "all" || options.all) return philosophers;

  const text = request.toLowerCase();
  const selected = [];
  const add = (...keys) => {
    for (const key of keys) selected.push(philosopherByKey.get(key));
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
  return uniquePhilosophers(selected).slice(0, limit);
}

function modePolicy(mode) {
  if (mode === "all") return "Режим all: участвуют все философские машины из текущего состава.";
  if (mode === "max") return "Режим max: широкий совет, но не обязательно весь пантеон; цель — сильный конфликт перспектив.";
  if (mode === "balanced") return "Режим balanced: 5-7 релевантных голосов, достаточно глубоко без расползания.";
  if (mode === "local") return "Режим local: короткий совет без внешней проверки; полезен для быстрых локальных запусков.";
  return "Режим min: 3 голоса, быстрый первый разбор.";
}

function transparencyPolicy() {
  return [
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

function philosopherLine(item) {
  const architect = item.architect ? " architect" : "";
  return `- ${item.name}${architect}: ${item.title}`;
}

function buildRootDescription({ request, mode, selected }) {
  return [
    "Запрос пользователя для The Inner Agora.",
    "",
    modePolicy(mode),
    "",
    "Выбранные философские машины:",
    selected.map(philosopherLine).join("\n"),
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

function buildPhilosopherDescription({ rootIssue, request, mode, philosopher }) {
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

  const selected = selectPhilosophers(request, mode, philosopherList, { all, noArchitects });

  if (dryRun) {
    console.log("# Dry-run: The Inner Agora council");
    console.log(`mode=${mode}`);
    console.log(`voices=${selected.map((item) => item.name).join(", ")}`);
    console.log("");
    console.log(buildRootDescription({ request, mode, selected }));
    return;
  }

  const agora = await getAgora();
  const missingAgents = selected.filter((item) => !agora.agentsByName.get(item.name));
  if (missingAgents.length) {
    throw new Error(`Missing Paperclip agents: ${missingAgents.map((item) => item.name).join(", ")}`);
  }

  const rootIssue = await createIssue(agora.company.id, {
    title: `Agora ${mode}: ${cleanTitle(request)}`,
    description: buildRootDescription({ request, mode, selected }),
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
      description: buildPhilosopherDescription({ rootIssue, request, mode, philosopher }),
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
      "Когда ответы будут готовы:",
      `\`node scripts/agora.mjs synthesize ${rootIssue.identifier || rootIssue.id}\``,
    ].join("\n"),
  );

  console.log(`Created Agora root: ${rootIssue.identifier || rootIssue.id}`);
  console.log(`Open: http://127.0.0.1:3100/issues/${rootIssue.id}`);
  console.log("Voice issues:");
  for (const { philosopher, issue, wake } of childIssues) {
    console.log(`- ${philosopher.name}: ${issue.identifier || issue.id} (${wakeSummary(wake)})`);
  }
  console.log(`Next: node scripts/agora.mjs synthesize ${rootIssue.identifier || rootIssue.id}`);
}

async function dialogue(args) {
  const philosopherToken = args[0];
  const request = args.slice(1).join(" ").trim();
  if (!philosopherToken || !request) {
    throw new Error('Usage: node scripts/agora.mjs dialogue <philosopher> "question"');
  }

  const philosopher = philosopherByToken(philosopherToken);
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

function latestIssueRef(args) {
  const raw = args.join(" ");
  const match = raw.match(/\b[A-Z][A-Z0-9]{1,12}-\d+\b/i);
  return match ? match[0].toUpperCase() : "";
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
  if (/^Синтез:/i.test(String(issue.title || ""))) return true;
  return Boolean(assistantId && issue.assigneeAgentId === assistantId);
}

function latestSynthesisChild(issue, allIssues, agora) {
  return [...childrenOf(issue, allIssues)]
    .reverse()
    .find((child) => isSynthesisIssue(child, agora.assistant.id));
}

function hasSynthesisShape(text) {
  return /Какой вопрос реально исследовался|Карта позиций|Главные линии конфликта|Черновая матрица/i.test(
    String(text || ""),
  );
}

function oneLine(text, limit = 420) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 15)).trim()} ... [clipped]`;
}

function rootQuestion(issue) {
  const body = String(issue.description || "");
  const match = body.match(/Исходный вопрос:\s*\n([\s\S]*?)(?:\n\n|$)/);
  return oneLine(match ? match[1] : issue.title, 900);
}

function sectionBody(text, number) {
  const pattern = new RegExp(`(?:^|\\n)${number}\\.\\s+[^\\n]*\\n\\n([\\s\\S]*?)(?=\\n\\d+\\.\\s+|\\nПометки:|$)`);
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : "";
}

function bulletLines(text, limit = 5) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, limit)
    .map((line) => oneLine(line, 520));
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
      const body = String(comment.body || "");
      let score = body.length;
      if (/Какой вопрос реально исследовался|Карта позиций|Главные линии конфликта/i.test(body)) score += 100000;
      if (comment.authorType === "agent" && /Задача .* завершена/i.test(body)) score -= 50000;
      return { comment, score };
    })
    .sort((left, right) => right.score - left.score);
  return scored[0]?.comment || null;
}

function printSynthesisDigest(comment) {
  const body = String(comment?.body || "").trim();
  if (!body) {
    console.log("- Содержательного синтеза пока нет.");
    return;
  }

  const question = paragraphLines(sectionBody(body, 1), 1);
  const positions = bulletLines(sectionBody(body, 3), 6);
  const positionParagraphs = positions.length ? [] : paragraphLines(sectionBody(body, 3), 5);
  const conflicts = bulletLines(sectionBody(body, 4), 5);
  const unresolved = bulletLines(sectionBody(body, 6), 3);
  const next = paragraphLines(sectionBody(body, 7), 1);
  const notes = body.match(/Пометки:\s*([\s\S]*)$/)?.[1] || "";
  const noteLines = bulletLines(notes, 5);

  if (question.length) {
    console.log("Реальный вопрос:");
    for (const line of question) console.log(`- ${line}`);
    console.log("");
  }

  if (positions.length) {
    console.log("Позиции:");
    for (const line of positions) console.log(line);
    console.log("");
  }

  if (positionParagraphs.length) {
    console.log("Позиции:");
    for (const line of positionParagraphs) console.log(`- ${line}`);
    console.log("");
  }

  if (conflicts.length) {
    console.log("Линии конфликта:");
    for (const line of conflicts) console.log(line);
    console.log("");
  }

  if (unresolved.length) {
    console.log("Осталось нерешенным:");
    for (const line of unresolved) console.log(line);
    console.log("");
  }

  if (next.length) {
    console.log("Следующий шаг:");
    for (const line of next) console.log(`- ${line}`);
    console.log("");
  }

  if (noteLines.length) {
    console.log("Пометки:");
    for (const line of noteLines) console.log(line);
  }
}

function printFallbackDigest(comment) {
  const body = String(comment?.body || "").trim();
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
  for (const item of philosophers) {
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
  const { agents } = await getAgora();
  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));
  const expectedNames = new Set(philosophers.map((item) => item.name));
  const filteredPhilosophers = options.tag
    ? philosophers.filter((item) => tagList(item).map(normalizeTag).includes(options.tag))
    : philosophers;
  const present = filteredPhilosophers.filter((item) => agentsByName.has(item.name));
  const extra = agents.filter((agent) => agent.name !== ASSISTANT_NAME && !expectedNames.has(agent.name));
  const assistant = agentsByName.get(ASSISTANT_NAME);

  if (options.showTags) {
    console.log("# Теги философов");
    for (const [tag, count] of tagSummary()) console.log(`- ${tag}: ${count}`);
    console.log("");
    console.log(`Всего тегов: ${tagSummary().length}`);
    console.log(`Философов: ${philosophers.length}`);
    return;
  }

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
  if (options.tag) console.log(`Фильтр tag=${options.tag}; всего в roster: ${philosophers.length}`);
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
    return;
  }

  const commentsList = await api(`/issues/${synthesis.id}/comments`);
  const digestSource = synthesisComment(commentsList);

  console.log("## Выжимка");
  console.log(`Синтез: ${synthesis.identifier || synthesis.id}, status=${synthesis.status}`);
  if (digestSource?.createdAt) console.log(`Источник выжимки: comment ${digestSource.authorType || "unknown"} ${digestSource.createdAt}`);
  console.log("");
  printSynthesisDigest(digestSource);
}

async function result(args) {
  const full = args.includes("--full") || args.includes("full") || args.includes("полностью");
  const filteredArgs = args.filter((arg) => !["--full", "full", "полностью"].includes(arg));
  const agora = await getAgora();
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
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

  printSynthesisDigest(digestSource);
  if (!hasSynthesisShape(String(digestSource?.body || ""))) printFallbackDigest(digestSource);
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

  const updated = await updateIssue(issue.id, { status: nextStatus });
  await addComment(issue.id, `Статус вручную изменен через Inner Agora bridge: ${issue.status} -> ${nextStatus}.`);
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
  const issueRef = args[0];
  const fresh = args.includes("--fresh");
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs synthesize <root-issue-id-or-key> [--fresh]");

  const agora = await getAgora();
  const root = await api(`/issues/${issueRef}`);
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

  const allIssues = await api(`/companies/${agora.company.id}/issues`);
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
      await updateIssue(issue.id, { status: "done" });
      await addComment(issue.id, "Пакет автоматически закрыт через Inner Agora bridge: все дочерние задачи в финальных статусах.");
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
      await updateIssue(root.id, { status: "done" });
      await addComment(root.id, "Пакет закрыт через Inner Agora bridge: все дочерние задачи завершены или находятся в финальном статусе.");
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

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") usage(0);

  if (command === "prepare") return prepare(args);
  if (command === "mode") return modeCommand(args);
  if (command === "council" || command === "minimum-council" || command === "mvp") return minimumCouncil(args);
  if (command === "ask") return ask(args);
  if (command === "dialogue") return dialogue(args);
  if (command === "synthesize" || command === "synth") return synthesize(args);
  if (command === "export-memory") return exportMemory(args);
  if (command === "philosophers" || command === "agents") return listPhilosophers(args);
  if (command === "status") return status(args);
  if (command === "recheck" || command === "verify" || command === "перепроверь" || command === "сверь") return recheck(args);
  if (command === "tasks") return tasks(args);
  if (command === "latest" || command === "last" || command === "brief") return latest(args);
  if (command === "result" || command === "outcome" || command === "итог" || command === "результат") return result(args);
  if (command === "task") return taskDetails(args);
  if (command === "finalize" || command === "close" || command === "закрыть") return finalize(args);
  if (command === "move") return moveIssue(args);
  if (command === "comments") return comments(args);

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
