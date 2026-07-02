#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadChamber } from "./chamber-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAMBERS_DIR = process.env.INNER_AGORA_CHAMBERS_DIR
  ? path.resolve(process.env.INNER_AGORA_CHAMBERS_DIR)
  : path.join(ROOT, "chambers");
const DEFAULT_CHAMBER_ID = process.env.INNER_AGORA_DEFAULT_CHAMBER || "philosophy";
const INTENTS = new Set(["new_session", "status", "result", "task_lookup", "role_detail", "help", "other"]);
const MODES = new Set(["min", "balanced", "max", "all"]);

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/intent-slots.mjs parse-json
  node scripts/intent-slots.mjs normalize --json
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

  if (command === "fixture-one") {
    if (json) process.stdout.write(stableJson(fixtureOne()));
    else console.log(`${fixtureOne().intent}\t${fixtureOne().chamber}\t${fixtureOne().topic}`);
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
