#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "data", "philosophers.json");
const PROMPTS_DIR = path.join(ROOT, "philosophers", "prompts");
const PROMPT_START = "<!-- INNER_AGORA_PROMPT_START -->";
const PROMPT_END = "<!-- INNER_AGORA_PROMPT_END -->";
const API_BASE = process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api";
const COMPANY_NAME = process.env.INNER_AGORA_COMPANY_NAME || "The Inner Agora";
const PROJECT_NAME = process.env.INNER_AGORA_PROJECT_NAME || "Agora Sessions";
const GOAL_TITLE = process.env.INNER_AGORA_GOAL_TITLE || "Run philosophical research dialogues with The Inner Agora";
const HERMES_COMMAND = process.env.INNER_AGORA_HERMES_COMMAND || "/Users/admin/.local/bin/inneragora";
const HERMES_MODEL = process.env.INNER_AGORA_HERMES_MODEL || "google/gemma-4-26b-a4b-qat";
const CODEX_COMMAND = process.env.CODEX_CLI_PATH || "/Applications/Codex.app/Contents/Resources/codex";
const CODEX_AUTH_SOURCE =
  process.env.INNER_AGORA_CODEX_AUTH_SOURCE || path.join(os.homedir(), ".codex", "auth.json");
const PAPERCLIP_INSTANCE_ROOT =
  process.env.PAPERCLIP_INSTANCE_ROOT || path.join(os.homedir(), ".paperclip", "instances", "default");
const PAPERCLIP_AGENT_WORKSPACE =
  process.env.INNER_AGORA_PAPERCLIP_AGENT_WORKSPACE ||
  path.join(PAPERCLIP_INSTANCE_ROOT, "workspaces", "inner-agora-agent-workspace");
const CODEX_MODEL = process.env.INNER_AGORA_CODEX_MODEL || "gpt-5.4";
const CODEX_REASONING_EFFORT = process.env.INNER_AGORA_CODEX_REASONING_EFFORT || "medium";
const AGENT_ADAPTER = normalizeAgentAdapter(process.env.INNER_AGORA_AGENT_ADAPTER || "codex_local");
const HERMES_TIMEOUT_SEC = Number(process.env.INNER_AGORA_HERMES_TIMEOUT_SEC || 900);

const runtimeConfig = {
  heartbeat: {
    enabled: false,
    intervalSec: 0,
    wakeOnOnDemand: true,
    wakeOnAssignment: true,
    wakeOnAutomation: false,
    maxConcurrentRuns: 1,
  },
};

const codexAdapterConfig = {
  command: CODEX_COMMAND,
  model: CODEX_MODEL,
  modelReasoningEffort: CODEX_REASONING_EFFORT,
  search: false,
  dangerouslyBypassApprovalsAndSandbox: true,
  timeoutSec: HERMES_TIMEOUT_SEC,
  graceSec: 10,
  env: {
    INNER_AGORA_LANGUAGE: { type: "plain", value: "ru" },
    INNER_AGORA_MODE: { type: "plain", value: "philosophical-research" },
  },
};

const hermesAdapterConfig = {
  hermesCommand: HERMES_COMMAND,
  provider: "auto",
  model: HERMES_MODEL,
  toolsets: "terminal,file,web",
  quiet: true,
  checkpoints: true,
  persistSession: true,
  timeoutSec: HERMES_TIMEOUT_SEC,
  graceSec: 10,
  env: {
    INNER_AGORA_LANGUAGE: { type: "plain", value: "ru" },
    INNER_AGORA_MODE: { type: "plain", value: "philosophical-research" },
  },
};

function normalizeAgentAdapter(value) {
  const normalized = String(value || "").trim().toLowerCase().replaceAll("-", "_");
  if (["hermes", "hermes_local", "local"].includes(normalized)) return "hermes_local";
  if (["codex", "codex_local", "codex_cli"].includes(normalized)) return "codex_local";
  throw new Error(`Unsupported INNER_AGORA_AGENT_ADAPTER=${value}. Use hermes_local or codex_local.`);
}

function selectedAdapterConfig() {
  return AGENT_ADAPTER === "hermes_local" ? hermesAdapterConfig : codexAdapterConfig;
}

function languagePolicy() {
  return [
    "ОБЯЗАТЕЛЬНАЯ ЯЗЫКОВАЯ ПОЛИТИКА:",
    "- По умолчанию отвечай по-русски.",
    "- Английский оставляй только для имен, терминов, команд, названий книг или точных понятий.",
    "- Если пользователь просит другой язык, следуй просьбе.",
    "- Не выдавай длинные англоязычные разделы без явного запроса.",
  ].join("\n");
}

function assistantInstructions() {
  return [
    languagePolicy(),
    "",
    "Ты — Agora Assistant / Синтезатор в проекте The Inner Agora.",
    "",
    "The Inner Agora — это набор философских машин-личностей для исследования, диалога и спора. Это не совет директоров и не набор узких функций. Здесь важна реконструкция мировоззрений, конфликтов, интонаций и способов видеть реальность.",
    "",
    "ТВОЯ РОЛЬ:",
    "- принимать вопрос пользователя и превращать его в ясную сессию;",
    "- выбирать релевантных философов, не вызывая всех без необходимости;",
    "- удерживать спор как спор, не сглаживая конфликт слишком рано;",
    "- отделять реконструкцию философской позиции от современного вывода;",
    "- собирать итоговую карту: согласия, конфликты, скрытые предпосылки, сильнейшие аргументы, нерешенные вопросы;",
    "- не говорить от имени философов, если они получили отдельные child-задачи и еще не ответили.",
    "",
    "АРХИТЕКТОРЫ ПРОСТРАНСТВА:",
    "- Платон держит вертикаль истины, формы и восхождения от мнения к сущности.",
    "- Декарт держит метод, ясность, сомнение и основание субъекта.",
    "- Хайдеггер держит вопрос о бытии, языке, подлинности и техническом мышлении.",
    "",
    "ФОРМАТ СИНТЕЗА:",
    "1. Какой вопрос реально исследовался.",
    "2. Кто участвовал и почему.",
    "3. Карта позиций по философам.",
    "4. Главные линии конфликта.",
    "5. Скрытые предпосылки вопроса.",
    "6. Что осталось нерешенным.",
    "7. Практический или исследовательский следующий шаг.",
    "",
    "ОГРАНИЧЕНИЯ:",
    "- Не изображай историческую точность там, где дана только реконструкция.",
    "- Не превращай философов в современные бизнес-роли.",
    "- Не скрывай расхождение позиций ради красивого консенсуса.",
    "- Для современных публичных фигур явно говори, что речь идет о реконструкции оптики по публичным идеям, а не о речи самого человека.",
  ].join("\n");
}

function philosopherInstructions(item) {
  const modernNote = item.contemporaryPublicFigure
    ? [
        "",
        "ВАЖНО ПРО СОВРЕМЕННУЮ ПУБЛИЧНУЮ ФИГУРУ:",
        "Ты не заявляешь, что являешься этим человеком или передаешь его настоящую волю. Ты работаешь как реконструкция интеллектуальной оптики по публичным идеям, стилю аргументации и известным темам.",
      ].join("\n")
    : "";

  return [
    languagePolicy(),
    "",
    `Ты — философская машина "${item.name}" в The Inner Agora.`,
    "",
    "Ты не узкая функция и не современный консультант в маске философа. Твоя задача — вести разговор как реконструированное интеллектуальное присутствие: со своей картиной мира, темпераментом, убеждениями, конфликтами и слепыми зонами.",
    "",
    "Не утверждай, что ты настоящий исторический человек. Говори изнутри философской оптики, но если вопрос требует точности, отмечай границу реконструкции.",
    modernNote,
    "",
    "ТВОЯ ЦЕНТРАЛЬНАЯ ИНТУИЦИЯ:",
    item.centralIntuition,
    "",
    "МАНЕРА И ТЕМПЕРАМЕНТ:",
    item.voice,
    "",
    "ТВОЕ НАПРЯЖЕНИЕ И СЛЕПАЯ ЗОНА:",
    item.tension,
    "",
    "КАК ВЕСТИ ДИАЛОГ:",
    "- Сначала пересобери вопрос в собственных понятиях.",
    "- Покажи, что для тебя здесь реально важно.",
    "- Спорь с предпосылками, если вопрос поставлен неверно.",
    "- Не соглашайся из вежливости.",
    "- Не говори за весь совет и не финализируй общий синтез.",
    "",
    "ФОРМАТ ОТВЕТА В ЗАДАЧАХ PAPERCLIP:",
    "1. Как я понимаю поставленный вопрос.",
    "2. Моя позиция.",
    "3. Что в вопросе скрыто или неверно предполагается.",
    "4. С кем из других философов я бы спорил и почему.",
    "5. Что должен забрать Agora Assistant для синтеза.",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractPromptMarkdown(text) {
  const start = text.indexOf(PROMPT_START);
  const end = text.indexOf(PROMPT_END);
  if (start === -1 || end === -1 || end <= start) return text.trim();
  return text.slice(start + PROMPT_START.length, end).trim();
}

async function loadPhilosopherPrompts(philosophers) {
  const prompts = new Map();
  for (const item of philosophers) {
    const promptPath = path.join(PROMPTS_DIR, `${item.key}.md`);
    try {
      const text = await fs.readFile(promptPath, "utf8");
      const prompt = extractPromptMarkdown(text);
      if (prompt) prompts.set(item.key, prompt);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return prompts;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${message}`);
  }

  return data;
}

async function loadPhilosophers() {
  return JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
}

async function ensureCompany() {
  const companies = await api("/companies");
  const existing = companies.find((company) => company.name === COMPANY_NAME);
  if (existing && existing.status !== "archived") {
    console.log(`Using existing company: ${existing.name} (${existing.id})`);
    return existing;
  }

  const company = await api("/companies", {
    method: "POST",
    body: JSON.stringify({
      name: COMPANY_NAME,
      description:
        "Философская Agora в Paperclip + Hermes: набор машин-личностей для исследования, диалога и спора.",
      budgetMonthlyCents: 0,
      attachmentMaxBytes: 10485760,
    }),
  });
  console.log(`Created company: ${company.name} (${company.id})`);
  return company;
}

function roleDefs(philosophers, promptOverrides = new Map()) {
  return [
    {
      key: "agora-assistant",
      name: "Agora Assistant / Синтезатор",
      role: "ceo",
      title: "Модерация, синтез и карта позиций",
      icon: "brain",
      reportsTo: null,
      canCreateAgents: true,
      capabilities:
        "Собирает философские заседания, выбирает участников, удерживает конфликт и создает синтез без сглаживания разногласий.",
      instructions: assistantInstructions(),
    },
    ...philosophers.map((item) => ({
      key: item.key,
      name: item.name,
      role: "researcher",
      title: item.architect ? `Архитектор: ${item.title}` : item.title,
      icon: item.architect ? "crown" : "telescope",
      reportsTo: "agora-assistant",
      canCreateAgents: false,
      capabilities: `${item.era}. ${item.title}. Теги: ${(item.tags || []).join(", ")}.`,
      instructions: promptOverrides.get(item.key) || philosopherInstructions(item),
    })),
  ];
}

async function ensureAgent(companyId, roleDef, createdByKey) {
  const agents = await api(`/companies/${companyId}/agents`);
  const existing = agents.find((agent) => agent.name === roleDef.name);
  if (existing) {
    await syncAgent(existing.id, roleDef);
    await ensureCodexAuthSymlink(existing);
    console.log(`Using existing agent: ${roleDef.name} (${existing.id})`);
    return existing;
  }

  const reportsTo = roleDef.reportsTo ? createdByKey.get(roleDef.reportsTo)?.id : null;
  if (roleDef.reportsTo && !reportsTo) {
    throw new Error(`Missing manager ${roleDef.reportsTo} for ${roleDef.name}`);
  }

  const agent = await api(`/companies/${companyId}/agents`, {
    method: "POST",
    body: JSON.stringify({
      name: roleDef.name,
      role: roleDef.role,
      title: roleDef.title,
      icon: roleDef.icon,
      reportsTo,
      capabilities: roleDef.capabilities,
      adapterType: AGENT_ADAPTER,
      adapterConfig: selectedAdapterConfig(),
      instructionsBundle: {
        entryFile: "AGENTS.md",
        files: {
          "AGENTS.md": roleDef.instructions,
        },
      },
      runtimeConfig,
      budgetMonthlyCents: 0,
      permissions: {
        canCreateAgents: Boolean(roleDef.canCreateAgents),
      },
      metadata: {
        source: "inner-agora-import",
        roleKey: roleDef.key,
      },
    }),
  });

  await ensureCodexAuthSymlink(agent);
  console.log(`Created agent: ${agent.name} (${agent.id})`);
  return agent;
}

async function syncAgent(agentId, roleDef) {
  await api(`/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      adapterType: AGENT_ADAPTER,
      adapterConfig: selectedAdapterConfig(),
      replaceAdapterConfig: true,
    }),
  });

  await api(`/agents/${agentId}/instructions-bundle`, {
    method: "PATCH",
    body: JSON.stringify({
      mode: "managed",
      entryFile: "AGENTS.md",
      clearLegacyPromptTemplate: true,
    }),
  });

  await api(`/agents/${agentId}/instructions-bundle/file`, {
    method: "PUT",
    body: JSON.stringify({
      path: "AGENTS.md",
      content: roleDef.instructions,
      clearLegacyPromptTemplate: true,
    }),
  });
}

function plainEnvValue(envEntry) {
  if (typeof envEntry === "string") return envEntry;
  if (envEntry && typeof envEntry === "object" && envEntry.type === "plain") return envEntry.value;
  return "";
}

function codexHomeForAgent(agent) {
  const configured = plainEnvValue(agent.adapterConfig?.env?.CODEX_HOME).trim();
  if (configured) return configured;
  return path.join(PAPERCLIP_INSTANCE_ROOT, "companies", agent.companyId, "agents", agent.id, "codex-home");
}

async function ensureCodexAuthSymlink(agent) {
  if (AGENT_ADAPTER !== "codex_local") return;

  const source = path.resolve(CODEX_AUTH_SOURCE);
  const codexHome = path.resolve(codexHomeForAgent(agent));
  if (codexHome === path.dirname(source)) return;
  if (!codexHome.includes(`${path.sep}.paperclip${path.sep}`) || !codexHome.endsWith(`${path.sep}codex-home`)) {
    throw new Error(`Refusing to manage auth symlink outside Paperclip codex-home: ${codexHome}`);
  }

  await fs.access(source);
  await fs.mkdir(codexHome, { recursive: true });

  const target = path.join(codexHome, "auth.json");
  const current = await fs.lstat(target).catch(() => null);
  if (current?.isSymbolicLink()) {
    const linked = await fs.readlink(target).catch(() => "");
    if (path.resolve(path.dirname(target), linked) === source) return;
  }

  await fs.rm(target, { force: true });
  await fs.symlink(source, target);
  console.log(`Linked Codex auth for ${agent.name}: ${target} -> ${source}`);
}

async function ensureGoal(companyId, assistantId) {
  const goals = await api(`/companies/${companyId}/goals`);
  const existing = goals.find((goal) => goal.title === GOAL_TITLE);
  if (existing) {
    console.log(`Using existing goal: ${existing.title} (${existing.id})`);
    return existing;
  }

  const goal = await api(`/companies/${companyId}/goals`, {
    method: "POST",
    body: JSON.stringify({
      title: GOAL_TITLE,
      description:
        "Создать рабочую систему философских диалогов: вопросы, сессии, позиции философов, конфликты, синтез и память.",
      level: "company",
      status: "active",
      ownerAgentId: assistantId,
    }),
  });
  console.log(`Created goal: ${goal.title} (${goal.id})`);
  return goal;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureAgentWorkspace() {
  await fs.mkdir(PAPERCLIP_AGENT_WORKSPACE, { recursive: true });

  const readmePath = path.join(PAPERCLIP_AGENT_WORKSPACE, "README.txt");
  if (!(await exists(readmePath))) {
    await fs.writeFile(
      readmePath,
      [
        "Paperclip The Inner Agora execution workspace.",
        `Orchestration scripts live in ${ROOT}.`,
        "Agents should use the task text and Paperclip API rather than changing files here.",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  if (!(await exists(path.join(PAPERCLIP_AGENT_WORKSPACE, ".git")))) {
    const result = spawnSync("git", ["init", PAPERCLIP_AGENT_WORKSPACE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new Error(`Failed to initialize Paperclip agent git workspace: ${result.stderr || result.stdout}`);
    }
  }

  return PAPERCLIP_AGENT_WORKSPACE;
}

async function ensureProjectWorkspace(project) {
  const workspacePath = await ensureAgentWorkspace();
  const workspaces = await api(`/projects/${project.id}/workspaces`);
  const primary = workspaces.find((workspace) => workspace.isPrimary) || workspaces[0];
  if (!primary) return project;

  if (primary.cwd === workspacePath && primary.name === "Inner Agora Agent Workspace") {
    return project;
  }

  await api(`/projects/${project.id}/workspaces/${primary.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Inner Agora Agent Workspace",
      sourceType: "local_path",
      cwd: workspacePath,
      visibility: primary.visibility || "default",
      isPrimary: true,
    }),
  });
  console.log(`Updated project workspace for Paperclip agents: ${workspacePath}`);
  return project;
}

async function ensureProject(companyId, goalId, assistantId) {
  const projects = await api(`/companies/${companyId}/projects`);
  const existing = projects.find((project) => project.name === PROJECT_NAME);
  if (existing) {
    console.log(`Using existing project: ${existing.name} (${existing.id})`);
    return ensureProjectWorkspace(existing);
  }

  const workspacePath = await ensureAgentWorkspace();
  const project = await api(`/companies/${companyId}/projects`, {
    method: "POST",
    body: JSON.stringify({
      name: PROJECT_NAME,
      description: "Рабочее пространство для философских сессий, диалогов, синтезов и исследовательской памяти.",
      status: "in_progress",
      goalIds: [goalId],
      leadAgentId: assistantId,
      color: "#7C3AED",
      icon: "brain",
      workspace: {
        name: "Inner Agora Agent Workspace",
        sourceType: "local_path",
        cwd: workspacePath,
        visibility: "default",
        isPrimary: true,
      },
    }),
  });
  console.log(`Created project: ${project.name} (${project.id})`);
  return project;
}

async function main() {
  await api("/health");

  const philosophers = await loadPhilosophers();
  const promptOverrides = await loadPhilosopherPrompts(philosophers);
  const company = await ensureCompany();
  const createdByKey = new Map();

  for (const roleDef of roleDefs(philosophers, promptOverrides)) {
    const agent = await ensureAgent(company.id, roleDef, createdByKey);
    createdByKey.set(roleDef.key, agent);
  }

  const assistant = createdByKey.get("agora-assistant");
  const goal = await ensureGoal(company.id, assistant.id);
  const project = await ensureProject(company.id, goal.id, assistant.id);
  const org = await api(`/companies/${company.id}/org`);

  console.log("");
  console.log("The Inner Agora import complete");
  console.log(`Company: ${company.id}`);
  console.log(`Project: ${project.id}`);
  console.log(`Goal: ${goal.id}`);
  console.log(`Org agents: ${org.nodes?.length ?? "unknown"}`);
  console.log(`Open UI: http://127.0.0.1:3100/companies/${company.id}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
