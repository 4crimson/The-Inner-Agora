#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listChambers, loadChamber } from "./chamber-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAMBERS_DIR = process.env.INNER_AGORA_CHAMBERS_DIR
  ? path.resolve(process.env.INNER_AGORA_CHAMBERS_DIR)
  : path.join(ROOT, "chambers");
const DEFAULT_CHAMBER_ID = process.env.INNER_AGORA_DEFAULT_CHAMBER || "philosophy";
const INTENTS = new Set([
  "new_session",
  "status",
  "result",
  "synthesis",
  "task_lookup",
  "role_detail",
  "dialogue_with_role",
  "help",
  "other",
]);
const MODES = new Set(["min", "balanced", "max", "all"]);
const DEFAULT_ISSUE_PREFIX = process.env.INNER_AGORA_ISSUE_PREFIX || "THE";

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/intent-slots.mjs parse-json
  node scripts/intent-slots.mjs normalize --json
  node scripts/intent-slots.mjs prompt "human text"
  node scripts/intent-slots.mjs extract [--routing-mode regex|llm] [--json] "human text"
  node scripts/intent-slots.mjs plan --json
  node scripts/intent-slots.mjs fixture-20 [--routing-mode regex|llm] [--json]
  node scripts/intent-slots.mjs fixture-one --json
`);
  process.exit(exitCode);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function chamberRolePath(chamberId) {
  const chamber = loadChamber(CHAMBERS_DIR, chamberId);
  const roleFile = chamber.roles[0];
  return path.isAbsolute(roleFile) ? roleFile : path.join(CHAMBERS_DIR, chamber.id, roleFile);
}

function loadRolesForChamber(chamberId = DEFAULT_CHAMBER_ID) {
  const roles = readJsonFile(chamberRolePath(chamberId), []);
  return Array.isArray(roles) ? roles : [];
}

function looseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roleAliases(role) {
  return [role.key, role.name, role.englishName, ...(Array.isArray(role.aliases) ? role.aliases : [])].filter(Boolean);
}

function roleKeyInText(text, chamberId = DEFAULT_CHAMBER_ID) {
  const haystack = looseText(text);
  if (!haystack) return "";
  for (const role of loadRolesForChamber(chamberId)) {
    for (const alias of roleAliases(role)) {
      const normalized = looseText(alias);
      if (normalized && haystack.includes(normalized)) return role.key;
      if (normalized.length >= 5 && haystack.includes(normalized.slice(0, -1))) return role.key;
    }
  }
  return "";
}

function resolveRoleKey(token, chamberId = DEFAULT_CHAMBER_ID) {
  const wanted = looseText(token);
  if (!wanted) return "";
  for (const role of loadRolesForChamber(chamberId)) {
    for (const alias of roleAliases(role)) {
      const normalized = looseText(alias);
      if (normalized && (wanted === normalized || wanted.includes(normalized) || normalized.includes(wanted))) {
        return role.key;
      }
    }
  }
  return "";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {}

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));

  const rawStart = text.indexOf("{");
  const rawEnd = text.lastIndexOf("}");
  if (rawStart >= 0 && rawEnd > rawStart) return JSON.parse(text.slice(rawStart, rawEnd + 1));
  throw new Error("No JSON object found");
}

export function validateIntentSlots(slots) {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) throw new Error("slots must be an object");
  for (const field of ["intent", "chamber", "mode", "topic", "roles", "taskRef", "missingSlots", "confidence"]) {
    if (!(field in slots)) throw new Error(`missing required field ${field}`);
  }
  if (!INTENTS.has(slots.intent)) throw new Error(`invalid intent ${slots.intent}`);
  if (slots.chamber !== null && !/^[a-z0-9][a-z0-9-]*$/.test(String(slots.chamber))) throw new Error("invalid chamber");
  if (slots.mode !== null && !MODES.has(slots.mode)) throw new Error(`invalid mode ${slots.mode}`);
  if (slots.topic !== null && typeof slots.topic !== "string") throw new Error("topic must be string or null");
  if (!Array.isArray(slots.roles)) throw new Error("roles must be an array");
  if (slots.taskRef !== null && typeof slots.taskRef !== "string") throw new Error("taskRef must be string or null");
  if (!Array.isArray(slots.missingSlots)) throw new Error("missingSlots must be an array");
  if (typeof slots.confidence !== "number" || slots.confidence < 0 || slots.confidence > 1) {
    throw new Error("confidence must be a number from 0 to 1");
  }
  return slots;
}

function recomputeMissingSlots(slots) {
  const missing = new Set(Array.isArray(slots.missingSlots) ? slots.missingSlots.filter(Boolean) : []);
  if (slots.intent === "new_session") {
    if (!slots.chamber) missing.add("chamber");
    if (!String(slots.topic || "").trim()) missing.add("topic");
  }
  if (slots.intent === "role_detail" && !slots.roles.length) missing.add("role");
  if (slots.intent === "dialogue_with_role" && !slots.roles.length) missing.add("role");
  if (slots.intent === "task_lookup" && !slots.taskRef) missing.add("taskRef");
  return [...missing];
}

export function normalizeIntentSlots(slots, options = {}) {
  const next = {
    intent: INTENTS.has(slots?.intent) ? slots.intent : "other",
    chamber: slots?.chamber || null,
    mode: slots?.mode || null,
    topic: typeof slots?.topic === "string" && slots.topic.trim() ? slots.topic.trim() : null,
    roles: Array.isArray(slots?.roles) ? slots.roles : [],
    taskRef: slots?.taskRef ? String(slots.taskRef) : null,
    missingSlots: Array.isArray(slots?.missingSlots) ? slots.missingSlots : [],
    confidence: Number.isFinite(Number(slots?.confidence)) ? Number(slots.confidence) : 0,
  };

  if (next.intent === "new_session" && !next.mode) next.mode = "balanced";
  if (next.intent !== "new_session") next.mode = null;
  if (next.mode && !MODES.has(next.mode)) next.mode = next.intent === "new_session" ? "balanced" : null;

  const chamberId = options.chamberId || next.chamber || DEFAULT_CHAMBER_ID;
  next.roles = unique(next.roles.map((role) => resolveRoleKey(role, chamberId)));
  next.missingSlots = recomputeMissingSlots(next);
  validateIntentSlots(next);
  return next;
}

function modeFromText(text) {
  const loose = looseText(text);
  if (hasAny(loose, ["коротко", "быстро", "кратко", "min"])) return "min";
  if (hasAny(loose, ["глубок", "подробн", "полный", "максимально", "max"])) return "max";
  if (hasAny(loose, ["всех", "все", "all"]) && hasAny(loose, ["голоса", "философы", "директора", "roles"])) return "all";
  return "balanced";
}

function cleanTopic(text) {
  let value = String(text || "");
  for (const fragment of [
    "новый вопрос",
    "новая тема",
    "отдельный вопрос",
    "давай",
    "хочу",
    "можешь",
    "пожалуйста",
    "спросим",
    "спроси",
    "запусти",
    "собери",
    "создай",
    "поставь",
    "задай",
    "исследуем",
    "исследуй",
    "консилиум",
    "совет директоров",
    "совет",
    "агора",
    "агоре",
    "философов",
    "коротко",
    "быстро",
    "кратко",
    "глубоко",
    "подробно",
    "полный",
    "максимально",
  ]) {
    value = value.replace(new RegExp(fragment, "giu"), " ");
  }
  return value
    .replace(/^\s*(про|по теме|о том|о)\s+/iu, "")
    .replace(/\s+/g, " ")
    .replace(/^[,.:;\s]+|[,.:;\s]+$/g, "")
    .trim();
}

function baseSlots(overrides = {}) {
  return {
    intent: "other",
    chamber: null,
    mode: null,
    topic: null,
    roles: [],
    taskRef: null,
    missingSlots: [],
    confidence: 0.5,
    ...overrides,
  };
}

function chamberFromText(text) {
  const loose = looseText(text);
  if (hasAny(loose, ["совет директоров", "директоров", "бизнес", "cto", "ceo", "cfo", "go no go", "go"])) return "board-directors";
  if (hasAny(loose, ["агора", "философ", "платон", "сократ", "сартр", "камю", "нагарджуна", "стоики"])) return "philosophy";
  return null;
}

function hasAny(text, fragments) {
  return fragments.some((fragment) => text.includes(fragment));
}

export function regexFallbackSlots(userText, context = {}) {
  const text = String(userText || "").trim();
  const loose = looseText(text);
  const chamber = chamberFromText(text) || context.activeChamber || DEFAULT_CHAMBER_ID;

  if (hasAny(loose, ["помощь", "help", "команды"])) {
    return normalizeIntentSlots(baseSlots({ intent: "help", chamber: chamberFromText(text), confidence: 0.9 }));
  }

  if (hasAny(loose, ["готов"]) && hasAny(loose, ["синтез", "результат"])) {
    return normalizeIntentSlots(baseSlots({ intent: "status", topic: "synthesis", confidence: 0.88 }));
  }

  if (hasAny(loose, ["что там", "статус", "status"])) {
    return normalizeIntentSlots(baseSlots({ intent: "status", confidence: 0.88 }));
  }

  if (hasAny(loose, ["собери синтез", "сделай синтез", "запусти синтез", "синтезируй", "собери итог", "сделай итог"])) {
    return normalizeIntentSlots(baseSlots({ intent: "synthesis", confidence: 0.86 }));
  }

  if (hasAny(loose, ["выжим", "результат", "итог", "синтез", "summary"])) {
    return normalizeIntentSlots(baseSlots({ intent: "result", confidence: 0.86 }));
  }

  const taskMatch = text.match(/\b([A-Z][A-Z0-9]{1,12}-\d+|\d{1,7})\b/i);
  if (taskMatch && hasAny(loose, ["покажи", "посмотри", "таск", "таску", "задач", "issue", "task"])) {
    return normalizeIntentSlots(baseSlots({ intent: "task_lookup", taskRef: taskMatch[1].toUpperCase(), confidence: 0.9 }));
  }

  const roleChamber = chamberFromText(text) || "philosophy";
  const roleKey = roleKeyInText(text, roleChamber);
  if (hasAny(loose, ["новый вопрос", "новая тема", "отдельный вопрос"])) {
    return normalizeIntentSlots(
      baseSlots({
        intent: "new_session",
        chamber,
        mode: modeFromText(text),
        topic: cleanTopic(text) || text,
        roles: roleKey ? [roleKey] : [],
        confidence: 0.84,
      }),
      { chamberId: chamber },
    );
  }

  if (roleKey && hasAny(loose, ["что бы", "ответил", "ответила", "возражение"])) {
    return normalizeIntentSlots(
      baseSlots({
        intent: "dialogue_with_role",
        chamber: roleChamber,
        topic: text,
        roles: [roleKey],
        confidence: 0.88,
      }),
      { chamberId: roleChamber },
    );
  }

  if (hasAny(loose, ["уточни", "продолжи", "спроси еще", "по этой сессии", "а что если"])) {
    return normalizeIntentSlots(
      baseSlots({
        intent: "new_session",
        chamber,
        mode: modeFromText(text),
        topic: text,
        roles: roleKey ? [roleKey] : [],
        confidence: 0.8,
      }),
      { chamberId: chamber },
    );
  }

  if (context.isFollowUp) {
    return normalizeIntentSlots(
      baseSlots({
        intent: "new_session",
        chamber,
        mode: modeFromText(text),
        topic: text,
        roles: roleKey ? [roleKey] : [],
        confidence: context.implicitFollowUp ? 0.72 : 0.8,
      }),
      { chamberId: chamber },
    );
  }

  if (roleKey && hasAny(loose, ["что сказал", "подробнее", "голос", "позици", "ответ"])) {
    return normalizeIntentSlots(
      baseSlots({ intent: "role_detail", chamber: roleChamber, roles: [roleKey], confidence: 0.88 }),
      { chamberId: roleChamber },
    );
  }

  const asksForSession = hasAny(loose, [
    "новый вопрос",
    "новая тема",
    "спрос",
    "задай",
    "поставь",
    "исслед",
    "собери",
    "создай",
    "консилиум",
    "совет",
    "go no go",
    "go",
  ]);
  if (asksForSession || chamber === "board-directors") {
    return normalizeIntentSlots(
      baseSlots({
        intent: "new_session",
        chamber,
        mode: modeFromText(text),
        topic: cleanTopic(text) || null,
        roles: roleKey ? [roleKey] : [],
        confidence: 0.82,
      }),
      { chamberId: chamber },
    );
  }

  return normalizeIntentSlots(baseSlots({ intent: "other", chamber: chamberFromText(text), confidence: 0.4 }));
}

function chamberPromptLine(chamber) {
  const roles = loadRolesForChamber(chamber.id)
    .slice(0, 16)
    .map((role) => role.name)
    .join(", ");
  return `- ${chamber.id}: ${chamber.name}; roles: ${roles}`;
}

export function buildSlotExtractionPrompt(userText, context = {}) {
  const chambers = listChambers(CHAMBERS_DIR).map(chamberPromptLine).join("\n");
  const active = context.activeChamber || DEFAULT_CHAMBER_ID;
  const lastRoot = context.lastRootIssueRef || "нет";
  return `Ты локальный JSON slot extractor для Hermes/Paperclip.
Модель не создает Paperclip issue, comment, wakeup и не выполняет команды. Она только возвращает слоты; deterministic code сделает действие.
Верни один компактный JSON без markdown и без рассуждений.

Доступные chambers:
${chambers}

Активная chamber: ${active}
lastRootIssueRef: ${lastRoot}

Правила intent:
- new_session: пользователь просит начать работу, например "спроси агору", "задай агоре", "собери совет", "консилиум", "исследуем", "совет директоров".
- status: пользователь спрашивает "готово ли", "что там", "статус".
- result: пользователь просит содержательный итог, например "дай выжимку", "покажи итог", "результат синтеза".
- task_lookup/help: запросы конкретной задачи или помощи.
- role_detail: пользователь спрашивает, что уже сказал конкретный голос, например "а что сказал Платон?".
- dialogue_with_role только когда lastRootIssueRef не "нет" И пользователь спрашивает, что конкретная роль ответила бы/возразила бы в контексте прошлой сессии, например "что бы Хайдеггер ответил на второе возражение?". Не используй dialogue_with_role для "спроси агору", "собери совет", "задай вопрос" или нового общего исследования.

Мини-примеры:
- "готов ли синтез по последней задаче?" => intent=status
- "дай выжимку по последней таске" => intent=result
- "а что сказал Платон?" => intent=role_detail
- "давай спросим агору про отцов и детей" => intent=new_session

Схема:
{"intent":"new_session|status|result|task_lookup|role_detail|dialogue_with_role|help|other","chamber":"philosophy|board-directors|null","mode":"min|balanced|max|all|null","topic":"string|null","roles":["string"],"taskRef":"string|null","missingSlots":["string"],"confidence":0.0}

Текст пользователя: ${userText}`;
}

async function callLocalModel(userText, options = {}) {
  const baseUrl = (options.baseUrl || process.env.INNER_AGORA_LLM_BASE_URL || "http://127.0.0.1:1234/v1").replace(/\/+$/, "");
  const model = options.model || process.env.INNER_AGORA_LLM_MODEL || "gemma-4-26b-a4b-it-mlx";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 700,
      stream: false,
      messages: [
        { role: "system", content: buildSlotExtractionPrompt(userText, options.context || {}) },
        { role: "user", content: String(userText || "") },
      ],
    }),
  });
  if (!response.ok) throw new Error(`local model request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || "";
}

async function extractWithLlm(userText, options = {}) {
  const raw = process.env.INNER_AGORA_FAKE_LLM_RESPONSE || (await callLocalModel(userText, options));
  try {
    return normalizeIntentSlots(parseJsonObject(raw));
  } catch (error) {
    if (process.env.INNER_AGORA_FAKE_LLM_RESPONSE) throw error;
    const repairPrompt = `Верни только исправленный JSON для этого ответа:\n${raw}`;
    const repaired = await callLocalModel(repairPrompt, options);
    return normalizeIntentSlots(parseJsonObject(repaired));
  }
}

function needsDeterministicFallback(slots, userText = "", context = {}) {
  if (slots.confidence < 0.7) return true;
  if (slots.intent === "task_lookup" && !slots.taskRef) return true;
  if (slots.intent === "role_detail" && !slots.roles.length) return true;
  if (slots.intent === "dialogue_with_role") {
    const cueText = looseText(userText);
    if (!context.lastRootIssueRef) return true;
    if (!slots.roles.length) return true;
    if (!hasAny(cueText, ["что бы", "ответил", "ответила", "возражение"])) return true;
  }
  if (slots.intent === "new_session" && !slots.topic) return true;
  return false;
}

export async function extractIntentSlots(userText, options = {}) {
  const routingMode = options.routingMode || process.env.ROUTING_MODE || "regex";
  if (routingMode === "llm") {
    try {
      const slots = await extractWithLlm(userText, options);
      if (needsDeterministicFallback(slots, userText, options.context || {})) {
        return { source: "regex", fallbackReason: "llm_low_confidence_or_missing_critical_slot", slots: regexFallbackSlots(userText, options.context || {}) };
      }
      return { source: "llm", slots };
    } catch (error) {
      return { source: "regex", fallbackReason: error?.message || String(error), slots: regexFallbackSlots(userText, options.context || {}) };
    }
  }
  return { source: "regex", slots: regexFallbackSlots(userText, options.context || {}) };
}

export function questionFor(slotName, slots = {}) {
  if (slotName === "topic") {
    const target = slots.chamber === "board-directors" ? "совет директоров" : "Агору";
    return `Какой вопрос поставить в ${target}?`;
  }
  if (slotName === "chamber") return "В какую палату поставить вопрос: philosophy или board-directors?";
  if (slotName === "role") return "По какому голосу показать ответ?";
  if (slotName === "taskRef") return "Какой номер задачи или сессии показать?";
  return "Что уточнить перед запуском?";
}

function commandText(command) {
  return command.join(" ");
}

export function decideNextStep(slots, context = {}) {
  const normalized = normalizeIntentSlots(slots, { chamberId: slots?.chamber || context.activeChamber || DEFAULT_CHAMBER_ID });
  const criticalMissing = normalized.missingSlots.filter((slot) => ["topic", "chamber", "role", "taskRef"].includes(slot));
  if (criticalMissing.length) {
    return {
      action: "clarify",
      missingSlots: criticalMissing,
      question: questionFor(criticalMissing[0], normalized),
    };
  }

  if (normalized.intent === "new_session" && context.isFollowUp && context.lastRootIssueRef) {
    const command = ["/agora", "follow-up", String(context.lastRootIssueRef)];
    if (normalized.roles.length) command.push("--voices", normalized.roles.join(","));
    command.push(normalized.topic);
    const ack = context.implicitFollowUp
      ? `Продолжаю в контексте ${context.lastRootIssueRef}. Если это новый вопрос, напиши: новый вопрос: ...`
      : `Продолжаю в контексте ${context.lastRootIssueRef}.`;
    return {
      action: "command",
      command,
      text: commandText(command),
      ack,
    };
  }

  if (normalized.intent === "new_session") {
    const command = ["/agora", "ask"];
    if (normalized.mode && normalized.mode !== "balanced") command.push("--mode", normalized.mode);
    if (normalized.roles.length) command.push("--voices", normalized.roles.join(","));
    command.push(normalized.topic);
    return {
      action: "command",
      command,
      text: commandText(command),
      ack: `Понял: запускаю ${normalized.chamber || DEFAULT_CHAMBER_ID} в режиме ${normalized.mode || "balanced"}.`,
    };
  }

  if (normalized.intent === "role_detail") {
    const command = ["/agora", "voice", normalized.roles[0]];
    return { action: "command", command, text: commandText(command), ack: "Покажу отдельный голос." };
  }

  if (normalized.intent === "dialogue_with_role") {
    if (!context.lastRootIssueRef) {
      return {
        action: "clarify",
        missingSlots: ["taskRef"],
        question: "По какой сессии спросить этот голос?",
      };
    }
    const command = ["/agora", "dialogue-context", String(context.lastRootIssueRef), normalized.roles[0], normalized.topic];
    return {
      action: "command",
      command,
      text: commandText(command),
      ack: `Спрошу ${normalized.roles[0]} в контексте ${context.lastRootIssueRef}.`,
    };
  }

  if (normalized.intent === "result") {
    const command = ["/agora", "latest"];
    return { action: "command", command, text: commandText(command), ack: "Проверю последнюю сессию." };
  }

  if (normalized.intent === "status") {
    const synthesisStatus = looseText(normalized.topic).includes("synthesis") || looseText(normalized.topic).includes("синтез");
    const command = synthesisStatus ? ["/agora", "result"] : ["/agora", "latest"];
    return {
      action: "command",
      command,
      text: commandText(command),
      ack: synthesisStatus ? "Проверю готовность синтеза." : "Проверю последнюю сессию.",
    };
  }

  if (normalized.intent === "synthesis") {
    const command = ["/agora", "synth"];
    return { action: "command", command, text: commandText(command), ack: "Запущу синтез." };
  }

  if (normalized.intent === "task_lookup") {
    const taskRef = /^\d+$/.test(normalized.taskRef || "") ? `${DEFAULT_ISSUE_PREFIX}-${normalized.taskRef}` : normalized.taskRef;
    const command = ["/agora", "session", taskRef];
    return { action: "command", command, text: commandText(command), ack: "Покажу задачу." };
  }

  if (normalized.intent === "help") {
    const command = ["/agora", "help"];
    return { action: "command", command, text: commandText(command), ack: "Покажу помощь." };
  }

  return {
    action: "clarify",
    missingSlots: ["topic"],
    question: "Что хочешь сделать в Агоре?",
  };
}

function fixtureOne() {
  return normalizeIntentSlots({
    intent: "new_session",
    chamber: "philosophy",
    mode: "balanced",
    topic: "свобода ребенка и власть родителей",
    roles: ["Платон"],
    taskRef: null,
    missingSlots: [],
    confidence: 0.95,
  });
}

const FIXTURE_20 = [
  { id: 1, text: "давай спросим агору про отцов и детей", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 2, text: "мне интересно что сказали философы про родителей и детей, запусти совет", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 3, text: "поставь задачу: как разные философы понимали конфликт отцов и детей", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 4, text: "давай исследуем почему дети спорят с родителями у философов", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 5, text: "собери консилиум по теме вина перед родителями", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 6, text: "давай спросим агору, как стоики смотрели бы на тревогу родителей перед будущим детей", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 7, text: "хочу спросить агору про вину перед родителями и взросление", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 8, text: "собери совет: можно ли любить ребенка, не превращая его в проект", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 9, text: "задай агоре вопрос о свободе ребенка и власти родителей", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 10, text: "сделай совет философов о том, когда дети ничего не должны родителям", expected: { intent: "new_session", chamber: "philosophy" } },
  { id: 11, text: "что там по последней сессии?", expected: { intent: "status" } },
  { id: 12, text: "готов ли синтез по последней задаче?", expected: { intent: "status" } },
  { id: 13, text: "дай выжимку по последней таске", expected: { intent: "result" } },
  { id: 14, text: "покажи 55 таску", expected: { intent: "task_lookup", taskRef: "55" } },
  { id: 15, text: "хочу подробнее по Нагарджуне из последней сессии", expected: { intent: "role_detail", roles: ["nagarjuna"] } },
  { id: 16, text: "а что сказал Платон?", expected: { intent: "role_detail", roles: ["plato"] } },
  { id: 17, text: "агора помощь", expected: { intent: "help" } },
  { id: 18, text: "коротко спроси агору: что такое свобода у Сартра и Камю", expected: { intent: "new_session", chamber: "philosophy", mode: "min" } },
  { id: 19, text: "совет директоров, нужен go/no-go по найму CTO", expected: { intent: "new_session", chamber: "board-directors" } },
  { id: 20, text: "хочу глубокий разбор у совета директоров: стоит ли покупать конкурента", expected: { intent: "new_session", chamber: "board-directors", mode: "max" } },
];

function scoreFixture(testCase, slots) {
  const issues = [];
  const expected = testCase.expected;
  if (slots.intent !== expected.intent) issues.push(`intent:${slots.intent}`);
  if (expected.chamber && slots.chamber !== expected.chamber) issues.push(`chamber:${slots.chamber}`);
  if (expected.mode && slots.mode !== expected.mode) issues.push(`mode:${slots.mode}`);
  if (expected.taskRef && String(slots.taskRef || "") !== expected.taskRef) issues.push(`taskRef:${slots.taskRef}`);
  if (expected.roles) {
    for (const role of expected.roles) {
      if (!slots.roles.includes(role)) issues.push(`missing_role:${role}`);
    }
  }
  if (expected.intent === "new_session" && !String(slots.topic || "").trim()) issues.push("topic_empty");
  return { ok: issues.length === 0, issues };
}

async function runFixture20(options = {}) {
  const routingMode = options.routingMode || process.env.ROUTING_MODE || "regex";
  const results = [];
  for (const testCase of FIXTURE_20) {
    const startedAt = Date.now();
    const extracted = await extractIntentSlots(testCase.text, { routingMode });
    const score = scoreFixture(testCase, extracted.slots);
    results.push({
      id: testCase.id,
      text: testCase.text,
      source: extracted.source,
      latencyMs: Date.now() - startedAt,
      slots: extracted.slots,
      semanticOk: score.ok,
      issues: score.issues,
    });
  }
  const semanticCorrect = results.filter((result) => result.semanticOk).length;
  const latencies = results.map((result) => result.latencyMs);
  const avgLatencyMs = Math.round(latencies.reduce((total, value) => total + value, 0) / Math.max(1, latencies.length));
  return {
    routingMode,
    total: results.length,
    semanticCorrect,
    semanticCorrectRate: semanticCorrect / Math.max(1, results.length),
    avgLatencyMs,
    results,
  };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const json = args.includes("--json");
  if (!command || command === "--help" || command === "-h") usage(command ? 0 : 1);

  if (command === "parse-json") {
    process.stdout.write(stableJson(parseJsonObject(readStdin())));
    return;
  }

  if (command === "normalize") {
    process.stdout.write(stableJson(normalizeIntentSlots(parseJsonObject(readStdin()))));
    return;
  }

  if (command === "prompt") {
    console.log(buildSlotExtractionPrompt(args.filter((arg) => arg !== "--json").join(" ")));
    return;
  }

  if (command === "extract") {
    let routingMode = process.env.ROUTING_MODE || "regex";
    const textParts = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--json") {
        continue;
      } else if (arg === "--routing-mode") {
        routingMode = args[++index] || routingMode;
      } else {
        textParts.push(arg);
      }
    }
    extractIntentSlots(textParts.join(" "), { routingMode })
      .then((result) => {
        if (json) process.stdout.write(stableJson(result));
        else console.log(`${result.source}\t${result.slots.intent}\t${result.slots.topic || ""}`);
      })
      .catch((error) => {
        console.error(error?.message || String(error));
        process.exitCode = 1;
      });
    return;
  }

  if (command === "plan") {
    let context = {};
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--context") context = parseJsonObject(args[++index] || "{}");
    }
    const plan = decideNextStep(parseJsonObject(readStdin()), context);
    if (json) process.stdout.write(stableJson(plan));
    else console.log(plan.text || plan.question || plan.action);
    return;
  }

  if (command === "fixture-one") {
    if (json) process.stdout.write(stableJson(fixtureOne()));
    else console.log(`${fixtureOne().intent}\t${fixtureOne().chamber}\t${fixtureOne().topic}`);
    return;
  }

  if (command === "fixture-20") {
    let routingMode = process.env.ROUTING_MODE || "regex";
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--routing-mode") routingMode = args[++index] || routingMode;
    }
    runFixture20({ routingMode })
      .then((result) => {
        if (json) process.stdout.write(stableJson(result));
        else console.log(`${result.routingMode}: ${result.semanticCorrect}/${result.total} avg=${result.avgLatencyMs}ms`);
      })
      .catch((error) => {
        console.error(error?.message || String(error));
        process.exitCode = 1;
      });
    return;
  }

  usage(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
  }
}
