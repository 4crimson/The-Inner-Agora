#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CURRENT_STATE_SCHEMA_VERSION = 1;

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function rootDir(options = {}) {
  return path.resolve(options.root || process.env.INNER_AGORA_ROOT || SCRIPT_ROOT);
}

function readJsonFile(filePath, fallback = {}) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : fallback;
  } catch {
    return fallback;
  }
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function sanitizeChatId(value = "") {
  const sanitized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return sanitized || "default";
}

function normalizeStateMode(value, chatId) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "per-chat" || raw === "per_chat") return "per-chat";
  if (raw === "single-file" || raw === "single_file" || raw === "legacy") return "single-file";
  return chatId ? "per-chat" : "single-file";
}

export function stateContext(options = {}) {
  const root = rootDir(options);
  const explicitStatePath = options.statePath || process.env.INNER_AGORA_STATE_PATH || "";
  const rawChatId = options.chatId ?? process.env.INNER_AGORA_CHAT_ID ?? "";
  const chatId = sanitizeChatId(rawChatId);
  const mode = explicitStatePath
    ? "single-file"
    : normalizeStateMode(options.stateMode || process.env.STATE_MODE, String(rawChatId || ""));
  const stateDir = path.resolve(options.stateDir || process.env.INNER_AGORA_STATE_DIR || path.join(root, "state"));
  const legacyStatePath = path.resolve(
    options.legacyStatePath || process.env.INNER_AGORA_LEGACY_STATE_PATH || path.join(root, ".inner-agora-state.json"),
  );
  const selectedStatePath = explicitStatePath
    ? path.resolve(explicitStatePath)
    : mode === "per-chat"
      ? path.join(stateDir, `${chatId}.json`)
      : legacyStatePath;
  return {
    root,
    mode,
    chatId,
    stateDir,
    statePath: selectedStatePath,
    legacyStatePath,
    explicitStatePath: Boolean(explicitStatePath),
  };
}

export function statePath(options = {}) {
  return stateContext(options).statePath;
}

export function migrateState(raw = {}, chatId = "default") {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  payload.schemaVersion = CURRENT_STATE_SCHEMA_VERSION;
  payload.chatId = sanitizeChatId(payload.chatId || chatId);
  return payload;
}

export function migrateLegacyState(options = {}) {
  const context = stateContext({ ...options, stateMode: options.stateMode || "per-chat" });
  if (context.explicitStatePath) {
    return { ...context, migrated: false };
  }
  if (fs.existsSync(context.statePath)) {
    return { ...context, migrated: false };
  }
  if (!fs.existsSync(context.legacyStatePath)) {
    return { ...context, migrated: false };
  }
  const legacy = readJsonFile(context.legacyStatePath, {});
  const migrated = migrateState(legacy, context.chatId);
  ensureParent(context.statePath);
  fs.writeFileSync(context.statePath, stableJson(migrated));
  return { ...context, migrated: true };
}

export function readState(options = {}) {
  const context = stateContext(options);
  if (context.mode === "per-chat") migrateLegacyState(options);
  const raw = readJsonFile(context.statePath, null);
  if (!raw) return migrateState({}, context.chatId);
  const migrated = migrateState(raw, context.chatId);
  if (raw.schemaVersion !== CURRENT_STATE_SCHEMA_VERSION || raw.chatId !== migrated.chatId) {
    ensureParent(context.statePath);
    fs.writeFileSync(context.statePath, stableJson(migrated));
  }
  return migrated;
}

export function writeState(patch, options = {}) {
  const context = stateContext(options);
  const next = migrateState(
    {
      ...readState(options),
      ...(patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}),
      updatedAt: new Date().toISOString(),
    },
    context.chatId,
  );
  ensureParent(context.statePath);
  fs.writeFileSync(context.statePath, stableJson(next));
  return next;
}

export function profilePath(options = {}) {
  const context = stateContext(options);
  const profileDir = path.resolve(options.profileDir || process.env.INNER_AGORA_PROFILE_DIR || path.join(context.root, "memory", "profiles"));
  return path.join(profileDir, `${context.chatId}.json`);
}

export function readProfile(options = {}) {
  return migrateState(readJsonFile(profilePath(options), {}), stateContext(options).chatId);
}

export function writeProfile(patch, options = {}) {
  const filePath = profilePath(options);
  const next = migrateState(
    {
      ...readProfile(options),
      ...(patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}),
      updatedAt: new Date().toISOString(),
    },
    stateContext(options).chatId,
  );
  ensureParent(filePath);
  fs.writeFileSync(filePath, stableJson(next));
  return next;
}

function parseArgs(args = []) {
  const options = { json: false };
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--chat") options.chatId = args[++index] || "";
    else rest.push(arg);
  }
  return { command: rest[0] || "path", options };
}

function printValue(value, json) {
  if (json) process.stdout.write(stableJson(value));
  else console.log(JSON.stringify(value));
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "path") return printValue(stateContext(options), options.json);
  if (command === "read") return printValue(readState(options), options.json);
  if (command === "profile") return printValue(readProfile(options), options.json);
  throw new Error("Usage: node scripts/state-manager.mjs <path|read|profile> [--chat CHAT] [--json]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
  }
}
