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
  node scripts/agora.mjs mode [get|set <min|balanced|max|local>|--raw]
  node scripts/agora.mjs status
  node scripts/agora.mjs tasks [--all|--open] [--limit N]
  node scripts/agora.mjs task <issue-id-or-key>
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

  if (!options.noArchitects) add("plato", "descartes", "heidegger");
  add("socrates");

  if (/морал|этик|добродетел|долг|вина|счаст|жизнь|страдан|выбор|ценност/.test(text)) {
    add("aristotle", "kant", "epictetus", "marcus-aurelius", "epicurus", "augustine", "nietzsche");
  }
  if (/быт|существ|реальн|метафиз|бог|единое|душ|субстанц|природ/.test(text)) {
    add("parmenides", "plotinus", "spinoza", "aquinas", "cusanus");
  }
  if (/знан|истин|метод|сомнен|доказ|разум|субъект|позна/.test(text)) {
    add("pyrrho", "kant", "spinoza", "aquinas");
  }
  if (/истор|обще|полит|государ|власт|культур|цивилизац|либерал|модерн|традиц/.test(text)) {
    add("rousseau", "hegel", "nietzsche", "foucault", "dugin");
  }
  if (/язык|текст|знак|медиа|симулякр|постмодерн|дискурс|нарратив|культура/.test(text)) {
    add("barthes", "baudrillard", "deleuze", "foucault");
  }
  if (/желан|тело|станов|различ|машин|ризом|поток/.test(text)) {
    add("deleuze", "nietzsche", "spinoza");
  }

  add("aristotle", "nietzsche", "foucault");

  const limits = {
    min: 3,
    local: 5,
    balanced: 7,
    max: 12,
  };
  return uniquePhilosophers(selected).slice(0, limits[mode] || limits.balanced);
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

async function status() {
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

async function taskDetails(args) {
  const issueRef = args[0];
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs task <issue-id-or-key>");

  const agora = await getAgora();
  const issue = await api(`/issues/${issueRef}`);
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const comments = await api(`/issues/${issue.id}/comments`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const children = allIssues
    .filter((item) => item.parentId === issue.id && !item.hiddenAt)
    .sort((left, right) => Number(left.issueNumber || 0) - Number(right.issueNumber || 0));

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
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const children = allIssues
    .filter((item) => item.parentId === root.id && !item.hiddenAt)
    .sort((left, right) => Number(left.issueNumber || 0) - Number(right.issueNumber || 0));

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

  console.log(`Created synthesis issue: ${synthesis.identifier || synthesis.id}`);
  console.log(wakeSummary(wake));
  console.log(`Open: http://127.0.0.1:3100/issues/${synthesis.id}`);
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
  if (command === "status") return status();
  if (command === "tasks") return tasks(args);
  if (command === "task") return taskDetails(args);
  if (command === "move") return moveIssue(args);
  if (command === "comments") return comments(args);

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
