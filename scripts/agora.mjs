#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listChambers, loadChamber } from "./chamber-loader.mjs";
import { decideNextStep, extractIntentSlots } from "./intent-slots.mjs";
import { loadSkillPrompt, resolveSkillsForRole } from "./skill-loader.mjs";
import { adapterForRequest } from "./model-routing.mjs";
import { composeChamberPolicy, fallbackTransparencyPolicy } from "./policy-loader.mjs";
import {
  activeChamberCompanyConfigFromChamber,
  activeChamberIdFromState,
  resolveMvpPresetPath,
  resolveRoleSourcePath,
} from "./agora/chamber-utils.mjs";
import {
  adapterDisplayLine,
  adapterFromIssue,
  adapterFromState as adapterFromStateData,
  adapterMetadata,
  adapterStatePatch,
} from "./agora/adapter-utils.mjs";
import {
  cleanTitle,
  clip,
  stableJson,
} from "./agora/text-utils.mjs";
import {
  roleAliases,
  roleByToken as findRoleByToken,
  roleFromText as findRoleFromText,
  roleScoreInText,
  searchRoles as searchRoleRoster,
  uniqueRoles,
} from "./agora/role-search.mjs";
import { selectRoles } from "./agora/role-selection.mjs";
import {
  allowedMoveStatuses,
  byIssueNumber,
  childrenOf,
  compactIssueLine,
  displayStatus,
  displayTitle,
  isSynthesisIssue,
  issueByIdMap,
  issueKind,
  latestIssueRef,
  latestSynthesisChild,
  rootFromMap,
  terminalStatuses,
  voiceChildren,
  withoutIssueRef,
} from "./agora/issue-utils.mjs";
import {
  latestSynthesisForRoot,
  resolveRootIssue,
  resolveTopRootIssue,
} from "./agora/issue-query-utils.mjs";
import {
  collectSubtree,
  visibleChildren,
} from "./agora/finalize-utils.mjs";
import {
  availableVoiceLines,
  sessionActionLines,
  voiceChildScore,
} from "./agora/session-output.mjs";
import {
  appendCostLog,
  costDashboard,
  costDashboardLines,
  costPricingPath,
  costSummaryLine,
  parseCostsArgs,
} from "./agora/cost-utils.mjs";
import {
  normalizeTag,
  parsePhilosophersArgs,
  tagList,
  tagSummary,
} from "./agora/roster-utils.mjs";
import { allModePreflight } from "./agora/preflight-utils.mjs";
import {
  selectedAgentAncestryProblems,
  selectedAgentAncestryRecoveryMessage,
} from "./agora/agent-ancestry-utils.mjs";
import {
  hasSynthesisShape,
  normalizedDigestBody,
  printFallbackDigest,
  printSynthesisDigest,
  printVoiceDigest,
  rootQuestion,
  synthesisComment,
} from "./agora/digest-utils.mjs";
import { normalizeMode } from "./agora/mode-utils.mjs";
import {
  naturalCommandPayload as buildNaturalCommandPayload,
  naturalContextFromState,
  parseNaturalArgs,
} from "./agora/natural-utils.mjs";
import {
  memoryExportMarkdown,
  memoryExportPath,
} from "./agora/memory-export-utils.mjs";
import {
  chamberChoiceLines,
  parseWizardChamber,
  parseWizardMode,
  wizardCancelled,
  wizardConfirmed,
  wizardInitialSlots,
} from "./agora/wizard-utils.mjs";
import {
  buildStartExamples,
  startOnboardingLines,
} from "./agora/start-utils.mjs";
import {
  parseAskArgs,
  parseCouncilArgs,
  parseFollowUpArgs,
  parseRoleProposalArgs,
  parseTasksArgs,
  stripFullTokens,
} from "./agora/cli-parse-utils.mjs";
import {
  activeChamberOutputLines,
  costSummaryOutputLines,
  decoratedCostLogEntries,
  issueStatePatch,
  modeOutputLines,
} from "./agora/state-output-utils.mjs";
import {
  allRoleSkillsLines,
  allRoleSkillsPayload,
  resolvedRoleSkillsPayload,
  roleProposalLines,
  roleProposalPayload,
  roleSearchLines,
  singleRoleSkillsLines,
} from "./agora/role-output-utils.mjs";
import { createPaperclipClient, wakeSummary } from "./agora/paperclip-client.mjs";
import {
  buildDialogueDescription,
  buildDialogueWithContextDescription,
  buildFollowUpDescription,
  buildRootDescription,
  buildRoleDescription,
  buildSynthesisDescription,
  isPhilosophyChamber,
} from "./agora/session-builders.mjs";
import {
  readProfile,
  readState,
  statePath as resolvedStatePath,
  writeProfile,
  writeState,
} from "./state-manager.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAMBERS_DIR = process.env.INNER_AGORA_CHAMBERS_DIR
  ? path.resolve(process.env.INNER_AGORA_CHAMBERS_DIR)
  : path.join(ROOT, "chambers");
const SKILLS_DIR = process.env.INNER_AGORA_SKILLS_DIR
  ? path.resolve(process.env.INNER_AGORA_SKILLS_DIR)
  : path.join(ROOT, "skills");
const DEFAULT_CHAMBER_ID = process.env.INNER_AGORA_DEFAULT_CHAMBER || "philosophy";
const COCKPIT_CONFIG_PATH = process.env.PAPERCLIP_COCKPIT_CONFIG || path.join(ROOT, "paperclip-cockpit.json");
const COCKPIT_CONFIG = readJsonFile(COCKPIT_CONFIG_PATH, {});
const AGORA_CONFIG = COCKPIT_CONFIG.agora && typeof COCKPIT_CONFIG.agora === "object" ? COCKPIT_CONFIG.agora : {};
const API_BASE = process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api";
const ASSISTANT_NAME = "Agora Assistant / Синтезатор";
const DEFAULT_MODE = process.env.INNER_AGORA_DEFAULT_MODE || AGORA_CONFIG.default_mode || "balanced";
const MEMORY_DIR = process.env.INNER_AGORA_MEMORY_DIR || path.join(ROOT, "memory", "sessions");
const paperclip = createPaperclipClient({ apiBase: API_BASE, root: ROOT });
const { api, createIssue, updateIssue, addComment, wakeAgentSafe } = paperclip;

function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function roleSourcePath() {
  return resolveRoleSourcePath({
    chambersDir: CHAMBERS_DIR,
    chamber: activeChamber(),
  });
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
  return resolveMvpPresetPath({
    env: process.env,
    chambersDir: CHAMBERS_DIR,
    chamber: activeChamber(),
  });
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
  node scripts/agora.mjs ask [--min|--balanced|--max|--all] [--confirm-all] [--philosophers list] "question"
  node scripts/agora.mjs ask --dry-run --philosophers socrates,kant "question"
  node scripts/agora.mjs follow-up <root-issue> [--voices list] "question"
  node scripts/agora.mjs dialogue <philosopher> "question"
  node scripts/agora.mjs dialogue-context <root-issue> <philosopher> "question"
  node scripts/agora.mjs synthesize [root-issue-id-or-key] [--fresh]
  node scripts/agora.mjs export-memory <issue-id-or-key>
  node scripts/agora.mjs philosophers [--tags|--tag TAG]
  node scripts/agora.mjs philosopher-search [--json] "name or alias"
  node scripts/agora.mjs role-proposal [--json] [--limit N] [--mode MODE] [--no-architects] "topic"
  node scripts/agora.mjs chamber [list|current|use <id>]
  node scripts/agora.mjs policy [skill-id]
  node scripts/agora.mjs skills [role-key] [--json]
  node scripts/agora.mjs start [--json]
  node scripts/agora.mjs wizard
  node scripts/agora.mjs wizard-answer "answer"
  node scripts/agora.mjs understand [--routing-mode regex|llm] [--json] "human text"
  node scripts/agora.mjs natural [--routing-mode regex|llm] [--dry-run] [--json] "human text"
  node scripts/agora.mjs mode [get|set <min|balanced|max|local>|--raw]
  node scripts/agora.mjs costs [--json] [--limit N] [--since ISO|--hours N] [--pricing env|default|off|FILE]
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

function rememberIssue(issue, patch = {}) {
  if (!issue) return;
  writeState(issueStatePatch(issue, patch));
}

function rememberCostLog(extracted, context = {}, command = "") {
  const state = readState();
  const entries = decoratedCostLogEntries(extracted, context, state, command);
  if (!entries.length) return;
  writeState({ session: appendCostLog(state.session, entries) });
}

function printCostSummary(state = readState(), { markdown = false } = {}) {
  const lines = costSummaryOutputLines(state, { markdown });
  for (const line of lines) console.log(line);
  return lines.length > 0;
}

function activeChamberId(state = readState()) {
  const profile = readProfile();
  return activeChamberIdFromState({
    env: process.env,
    state,
    profile,
    defaultChamberId: DEFAULT_CHAMBER_ID,
  });
}

function activeChamber(state = readState()) {
  return loadChamber(CHAMBERS_DIR, activeChamberId(state));
}

function activeChamberCompanyConfig(state = readState()) {
  const chamber = activeChamber(state);
  return activeChamberCompanyConfigFromChamber(chamber, process.env);
}

function printActiveChamber(state = readState()) {
  const chamber = activeChamber(state);
  for (const line of activeChamberOutputLines(chamber)) console.log(line);
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
    writeProfile({ preferredChamberId: chamber.id });
    console.log(`Активная палата: ${chamber.id}`);
    console.log(`Название: ${chamber.name}`);
    if (state.updatedAt) console.log(`updatedAt=${state.updatedAt}`);
    return;
  }

  throw new Error(`Unknown chamber command: ${action}`);
}

function defaultMode() {
  const state = readState();
  const profile = readProfile();
  return normalizeMode(process.env.INNER_AGORA_MODE || state.mode || profile.preferredMode || DEFAULT_MODE);
}

function roleRiskTier(role) {
  return role?.riskTier || "reflective";
}

function chamberRiskTier(chamber = activeChamber()) {
  return chamber.riskTier || "reflective";
}

function adapterForMode(mode, options = {}) {
  const chamber = options.chamber || activeChamber();
  return adapterForRequest({
    mode,
    chamberRiskTier: options.chamberRiskTier || chamberRiskTier(chamber),
    roleRiskTiers: options.roleRiskTiers || [],
    roleCount: options.roleCount || 0,
    intent: options.intent || "",
  });
}

function adapterFromState(state = readState()) {
  return adapterFromStateData(state);
}

function printMode(mode, state = readState()) {
  const adapter = adapterForMode(mode);
  for (const line of modeOutputLines({ mode, adapter, statePath: resolvedStatePath(), state })) console.log(line);
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
    writeProfile({ preferredMode: mode });
    if (raw) console.log(mode);
    else {
      console.log(`Режим Агоры сохранен: ${mode}`);
      printMode(mode, state);
    }
    return;
  }

  const mode = normalizeMode(action);
  const state = writeState({ mode });
  writeProfile({ preferredMode: mode });
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

function roleByToken(token) {
  return findRoleByToken(roles, token);
}
/** @deprecated Use roleByToken. */
const philosopherByToken = roleByToken;

/** @deprecated Use roleAliases. */
const philosopherAliases = roleAliases;

function searchRoles(query, limit = 3) {
  return searchRoleRoster(roles, query, limit);
}

function philosopherSearch(args) {
  const json = args.includes("--json");
  const query = args.filter((arg) => arg !== "--json").join(" ").trim();
  const payload = searchRoles(query);
  if (json) {
    process.stdout.write(stableJson(payload));
    return payload;
  }
  for (const line of roleSearchLines(payload)) console.log(line);
  return payload;
}

function roleProposal(args = []) {
  const options = parseRoleProposalArgs(args);
  if (!options.topic) throw new Error('Usage: node scripts/agora.mjs role-proposal [--json] [--limit N] "topic"');
  const selected = selectPhilosophers(options.topic, options.mode, null, { noArchitects: options.noArchitects }).slice(0, options.limit);
  const payload = roleProposalPayload({ topic: options.topic, mode: options.mode, roles: selected });
  if (options.json) {
    process.stdout.write(stableJson(payload));
    return payload;
  }
  for (const line of roleProposalLines(payload)) console.log(line);
  return payload;
}

/** @deprecated Use roleScoreInText. */
const philosopherScoreInText = roleScoreInText;

function roleFromText(text) {
  return findRoleFromText(roles, text);
}
/** @deprecated Use roleFromText. */
const philosopherFromText = roleFromText;

/** @deprecated Use uniqueRoles. */
const uniquePhilosophers = uniqueRoles;

async function minimumCouncil(args) {
  const parsed = parseCouncilArgs(args);
  if (parsed.help) usage(0);
  const { request, dryRun } = parsed;
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
  return selectRoles({
    roles,
    request,
    mode,
    roleList: philosopherList,
    options,
    activeChamberId: activeChamberId(),
    mvpRoleKeys: loadMvpPresetRoleKeys(),
    byKey: roleByKey,
  });
}

function transparencyPolicy(chamberOrPolicyId = activeChamber()) {
  if (typeof chamberOrPolicyId !== "string") {
    return composeChamberPolicy(chamberOrPolicyId, { skillsDir: SKILLS_DIR });
  }
  const policyId = chamberOrPolicyId || activeChamber().transparencyPolicy;
  try {
    return loadSkillPrompt(SKILLS_DIR, policyId);
  } catch (error) {
    return fallbackTransparencyPolicy(policyId, error);
  }
}

function policyCommand(args = []) {
  const policyId = args[0] || "";
  console.log(policyId ? transparencyPolicy(policyId) : transparencyPolicy(activeChamber()));
}

function resolvedRoleSkills(role, chamber = activeChamber()) {
  const resolved = resolveSkillsForRole(role, chamber, { skillsDir: SKILLS_DIR });
  return resolvedRoleSkillsPayload({ chamber, role, resolved });
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
    for (const line of singleRoleSkillsLines(payload)) console.log(line);
    return;
  }

  const payload = allRoleSkillsPayload({
    chamber,
    roles: roles.map((role) => resolvedRoleSkills(role, chamber)),
  });
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (const line of allRoleSkillsLines(payload)) console.log(line);
}

async function ask(args) {
  const parsed = parseAskArgs(args, { defaultMode: defaultMode() });
  if (parsed.help) usage(0);
  const { request, mode, dryRun, all, confirmAll, noArchitects, philosopherList } = parsed;
  if (!request) throw new Error('Usage: node scripts/agora.mjs ask "your question"');

  const chamber = activeChamber();
  const selected = selectPhilosophers(request, mode, philosopherList, { all, noArchitects });
  const preflight = allModePreflight({ mode, all, selected, request, dryRun, confirmAll });
  if (!preflight.ok) throw new Error(preflight.message);

  const adapter = adapterForMode(mode, {
    chamber,
    roleCount: selected.length,
    roleRiskTiers: selected.map(roleRiskTier),
    intent: "council",
  });

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
  const ancestryProblems = selectedAgentAncestryProblems(selected, agora.agentsByName);
  if (ancestryProblems.length) {
    throw new Error(selectedAgentAncestryRecoveryMessage(ancestryProblems));
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
    metadata: {
      innerAgora: {
        adapter: adapterMetadata(adapter),
      },
    },
  });

  const childIssues = [];
  for (const philosopher of selected) {
    const agent = agora.agentsByName.get(philosopher.name);
    const child = await createIssue(agora.company.id, {
      title: `${philosopher.name}: ${cleanTitle(request)}`,
      description: buildRoleDescription({
        rootIssue,
        request,
        mode,
        philosopher,
        chamber,
        transparencyText: transparencyPolicy(chamber),
      }),
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
      "Маршрут модели:",
      `- ${adapterDisplayLine(adapter)}`,
      "",
      "Автоматизация:",
      "- Paperclip cockpit monitor запустит синтез, когда философские задачи будут в финальных статусах.",
      "- Telegram получит итог с кнопками после завершения синтеза.",
      `- Ручное восстановление при необходимости: \`node scripts/agora.mjs synthesize ${rootIssue.identifier || rootIssue.id}\``,
    ].join("\n"),
  );

  rememberIssue(rootIssue, {
    lastRootIssueRef: rootIssue.identifier || rootIssue.id,
    lastRootIssueId: rootIssue.id,
    ...adapterStatePatch(adapter),
  });
  writeProfile({
    preferredMode: mode,
    preferredChamberId: chamber.id,
    recentRoles: selected.map((role) => role.key).filter(Boolean).slice(0, 12),
  });

  console.log(`# Поставил вопрос в Агору: ${rootIssue.identifier || rootIssue.id}`);
  console.log(`Выбрал ${childIssues.length} голосов: ${childIssues.map(({ philosopher }) => philosopher.name).join(", ")}.`);
  console.log(`Маршрут: ${adapter.name} model=${adapter.model} reason=${adapter.reason}`);
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

async function followUp(args) {
  const { rootRef, roleList, request } = parseFollowUpArgs(args);
  const rootIssue = await api(`/issues/${rootRef}`);
  const selected = followUpRoles(request, roleList);
  const chamber = activeChamber();
  const agora = await getAgora();
  const missingAgents = selected.filter((item) => !agora.agentsByName.get(item.name));
  if (missingAgents.length) throw new Error(`Missing Paperclip agents: ${missingAgents.map((item) => item.name).join(", ")}`);

  const childIssues = [];
  for (const philosopher of selected) {
    const agent = agora.agentsByName.get(philosopher.name);
    const child = await createIssue(agora.company.id, {
      title: `${philosopher.name}: follow-up ${cleanTitle(request)}`,
      description: buildFollowUpDescription({
        rootIssue,
        request,
        philosopher,
        chamber,
        transparencyText: transparencyPolicy(chamber),
      }),
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

  const chamber = activeChamber();
  const agora = await getAgora();
  const agent = agora.agentsByName.get(philosopher.name);
  if (!agent) throw new Error(`Missing Paperclip agent: ${philosopher.name}`);

  const issue = await createIssue(agora.company.id, {
    title: `Диалог ${philosopher.name}: ${cleanTitle(request)}`,
    description: buildDialogueDescription({
      request,
      philosopher,
      chamber,
      transparencyText: transparencyPolicy(chamber),
    }),
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

async function dialogueWithContext(args) {
  const [rootRef, philosopherToken, ...requestParts] = args;
  const request = requestParts.join(" ").trim();
  if (!rootRef || !philosopherToken || !request) {
    throw new Error('Usage: node scripts/agora.mjs dialogue-context <root-issue> <philosopher> "question"');
  }

  const philosopher = roleByToken(philosopherToken);
  if (!philosopher) throw new Error(`Unknown philosopher: ${philosopherToken}`);

  const chamber = activeChamber();
  const rootIssue = await api(`/issues/${rootRef}`);
  const agora = await getAgora();
  const agent = agora.agentsByName.get(philosopher.name);
  if (!agent) throw new Error(`Missing Paperclip agent: ${philosopher.name}`);
  const { synthesisIssue, synthesisText } = await latestSynthesisForRoot(rootIssue, agora, api);

  const issue = await createIssue(agora.company.id, {
    title: `Диалог ${philosopher.name}: ${cleanTitle(request)}`,
    description: buildDialogueWithContextDescription({
      rootIssue,
      synthesisIssue,
      synthesisText,
      request,
      philosopher,
      chamber,
      transparencyText: transparencyPolicy(chamber),
    }),
    status: "todo",
    workMode: "standard",
    priority: "high",
    projectId: agora.project.id,
    goalId: agora.goal.id,
    parentId: rootIssue.id,
    assigneeAgentId: agent.id,
    requestDepth: 1,
  });
  const wake = await wakeAgentSafe(agent.id, issue.id, `The Inner Agora context dialogue: ${philosopher.name}`);

  await addComment(
    rootIssue.id,
    [
      `Создан контекстный диалог: ${issue.identifier || issue.id}.`,
      `Роль: ${philosopher.name}.`,
      synthesisIssue ? `Контекст синтеза: ${synthesisIssue.identifier || synthesisIssue.id}.` : "Контекст синтеза: не найден.",
      wakeSummary(wake),
    ].join("\n"),
  );

  rememberIssue(issue, { lastRootIssueRef: rootIssue.identifier || rootIssue.id, lastRootIssueId: rootIssue.id });
  console.log(`Создан контекстный диалог: ${issue.identifier || issue.id}`);
  console.log(wakeSummary(wake));
  console.log(`Open: http://127.0.0.1:3100/issues/${issue.id}`);
}

function printSessionActions(root, philosopherChildren, synthesis, agentById) {
  for (const line of sessionActionLines(root, philosopherChildren, synthesis, agentById)) console.log(line);
}

async function status(args = []) {
  const issueRef = latestIssueRef(args);
  if (issueRef) return taskDetails([issueRef]);
  const state = readState();
  const lastAdapter = adapterFromState(state);

  printActiveChamber();
  console.log("");
  if (lastAdapter) {
    console.log("Последний маршрут модели:");
    console.log(`- ${adapterDisplayLine(lastAdapter)}`);
    console.log("");
  }
  printCostSummary(state);

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

async function listPhilosophers(args = []) {
  const options = parsePhilosophersArgs(args);
  if (options.help) {
    console.log("Usage: node scripts/agora.mjs philosophers [--tags|--tag TAG]");
    process.exit(0);
  }

  if (options.showTags) {
    console.log("# Теги философов");
    const summary = tagSummary(roles);
    for (const [tag, count] of summary) console.log(`- ${tag}: ${count}`);
    console.log("");
    console.log(`Всего тегов: ${summary.length}`);
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
  const parsed = parseTasksArgs(args);
  if (parsed.help) usage(0);
  const { scope, limit } = parsed;
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

function costs(args = []) {
  const options = parseCostsArgs(args);
  if (options.help) {
    console.log("Usage: node scripts/agora.mjs costs [--json] [--limit N] [--since ISO|--hours N] [--pricing env|default|off|FILE]");
    process.exit(0);
  }
  const state = readState();
  const pricingPath = costPricingPath(options.pricingPath, { root: ROOT, cwd: process.cwd(), env: process.env });
  const pricing = pricingPath ? readJsonFile(pricingPath, {}) : null;
  const dashboardOptions = { ...options, pricing };
  const dashboard = costDashboard(state, dashboardOptions);
  if (options.json) {
    process.stdout.write(stableJson(dashboard));
    return dashboard;
  }
  for (const line of costDashboardLines(state, dashboardOptions)) console.log(line);
  return dashboard;
}

async function latest(args) {
  const agora = await getAgora();
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const root = await resolveRootIssue(args, allIssues, api);
  const children = childrenOf(root, allIssues);
  const synthesis = latestSynthesisChild(root, allIssues, agora);
  const philosopherChildren = children.filter((issue) => issue.id !== synthesis?.id);
  const rootAdapter = adapterFromIssue(root);
  rememberIssue(synthesis || root, {
    lastRootIssueRef: root.identifier || root.id,
    lastRootIssueId: root.id,
    lastSynthesisRef: synthesis?.identifier || "",
    lastSynthesisId: synthesis?.id || "",
    ...(rootAdapter ? adapterStatePatch(rootAdapter) : {}),
  });

  console.log(`# Последняя Paperclip-сессия: ${root.identifier || root.id}`);
  console.log(root.title);
  console.log(`- status: ${root.status}`);
  console.log(`- created: ${root.createdAt || "-"}`);
  console.log(`- updated: ${root.updatedAt || "-"}`);
  console.log(`- url: http://127.0.0.1:3100/issues/${root.id}`);
  if (rootAdapter) {
    console.log("");
    console.log("## Маршрут модели");
    console.log(`- ${adapterDisplayLine(rootAdapter)}`);
  }
  const costState = readState();
  if (costSummaryLine(costState)) {
    console.log("");
    printCostSummary(costState, { markdown: true });
  }
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
  const root = explicitRef ? await resolveRootIssue([explicitRef], allIssues, api) : await resolveRootIssue([], allIssues, api);
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
      root = await resolveTopRootIssue(issue, api);
    }
  } else {
    root = await resolveRootIssue([], allIssues, api);
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
  const root = issueRef ? await api(`/issues/${issueRef}`) : await resolveRootIssue([], allIssues, api);
  rememberIssue(root, { lastRootIssueRef: root.identifier || root.id, lastRootIssueId: root.id });
  if (isSynthesisIssue(root, agora.assistant.id)) {
    const parent = root.parentId ? await resolveTopRootIssue(root, api) : null;
    console.log(`${root.identifier || root.id} уже является задачей синтеза.`);
    console.log(`Результат: node scripts/agora.mjs result ${root.identifier || root.id}`);
    if (parent && parent.id !== root.id) {
      console.log(`Новый синтез всего пакета: node scripts/agora.mjs synthesize ${parent.identifier || parent.id}`);
    }
    return;
  }

  if (root.parentId) {
    const parent = await resolveTopRootIssue(root, api);
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

  const synthesis = await createIssue(agora.company.id, {
    title: `Синтез: ${root.title}`,
    description: buildSynthesisDescription({ root, childBlocks }),
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

async function finalize(args) {
  const dryRun = args.includes("--dry-run");
  const issueRef = latestIssueRef(args);
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs finalize <issue-id-or-key> [--dry-run]");

  const agora = await getAgora();
  const start = await api(`/issues/${issueRef}`);
  const root = await resolveTopRootIssue(start, api);
  rememberIssue(root, { lastRootIssueRef: root.identifier || root.id, lastRootIssueId: root.id });
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const agentById = new Map(agora.agents.map((agent) => [agent.id, agent]));
  const { items, byParent } = collectSubtree(root, allIssues);
  const issueById = new Map([[root.id, root], ...items.map(({ issue }) => [issue.id, issue])]);
  const changed = [];

  for (const { issue } of [...items].sort((left, right) => right.depth - left.depth || byIssueNumber(right.issue, left.issue))) {
    const kids = visibleChildren(issue, byParent);
    if (!kids.length || terminalStatuses.has(issue.status)) continue;
    if (!kids.every((child) => terminalStatuses.has(issueById.get(child.id)?.status || child.status))) continue;

    if (!dryRun) {
      await addComment(issue.id, "Пакет автоматически закрыт через Inner Agora bridge: все дочерние задачи в финальных статусах.");
      await updateIssue(issue.id, { status: "done" });
      issue.status = "done";
    }
    changed.push(issue);
  }

  const rootChildren = visibleChildren(root, byParent);
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

async function exportMemory(args) {
  const issueRef = args[0];
  if (!issueRef) throw new Error("Usage: node scripts/agora.mjs export-memory <issue-id-or-key>");

  const issue = await api(`/issues/${issueRef}`);
  rememberIssue(issue);
  const commentsList = await api(`/issues/${issue.id}/comments`);
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const filePath = memoryExportPath(MEMORY_DIR, issue);
  const body = memoryExportMarkdown(issue, commentsList);
  fs.writeFileSync(filePath, body, "utf8");
  console.log(`Exported: ${filePath}`);
}

function printStartOnboarding(payload) {
  for (const line of startOnboardingLines(payload)) console.log(line);
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

function writeWizard(wizard) {
  return writeState({ wizard });
}

function printChamberQuestion() {
  console.log("В какую палату поставить вопрос?");
  for (const line of chamberChoiceLines(listChambers(CHAMBERS_DIR))) console.log(line);
}

function printModeQuestion() {
  console.log("Какую глубину разбора выбрать?");
  console.log("1. коротко");
  console.log("2. обычно");
  console.log("3. глубоко");
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
    const chamber = parseWizardChamber(answer, listChambers(CHAMBERS_DIR), DEFAULT_CHAMBER_ID);
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

function naturalContext(text) {
  return naturalContextFromState(text, readState(), { env: process.env });
}

async function understand(args = []) {
  const options = parseNaturalArgs(args);
  const context = naturalContext(options.text);
  const extracted = await extractIntentSlots(options.text, { routingMode: options.routingMode, context });
  rememberCostLog(extracted, context, "understand");
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
  if (plannedCommand === "dialogue-context") return dialogueWithContext(plannedArgs);
  if (plannedCommand === "latest") return latest(plannedArgs);
  if (plannedCommand === "voice") return voice(plannedArgs);
  if (plannedCommand === "task") return taskDetails(plannedArgs);
  if (plannedCommand === "help") return usage(0);
  throw new Error(`Unsupported natural command: ${command.join(" ")}`);
}

function naturalCommandPayload(command, options, extra = {}) {
  const payload = buildNaturalCommandPayload(command, extra);
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
  rememberCostLog(extracted, context, "natural");
  const plan = decideNextStep(extracted.slots, context);

  if (options.dryRun || options.json) {
    if (plan.action === "clarify" && Array.isArray(plan.missingSlots) && plan.missingSlots.includes("topic")) {
      return naturalCommandPayload(["/agora", "wizard"], options, { source: extracted.source, slots: extracted.slots, plan });
    }
    const payload =
      plan.action === "command"
        ? { action: "rewrite", text: plan.text, source: extracted.source, slots: extracted.slots, plan }
        : {
            action: "message",
            text: plan.text || plan.question,
            reply_markup: plan.reply_markup,
            source: extracted.source,
            slots: extracted.slots,
            plan,
          };
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
  if (command === "dialogue-context" || command === "dialogue_context") return dialogueWithContext(args);
  if (command === "synthesize" || command === "synth") return synthesize(args);
  if (command === "export-memory") return exportMemory(args);
  if (command === "philosophers" || command === "agents") return listPhilosophers(args);
  if (command === "philosopher-search" || command === "role-search") return philosopherSearch(args);
  if (command === "role-proposal" || command === "philosopher-proposal") return roleProposal(args);
  if (command === "status") return status(args);
  if (command === "costs" || command === "cost" || command === "tokens") return costs(args);
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
