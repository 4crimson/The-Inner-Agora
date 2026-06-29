#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_NAME = process.env.INNER_AGORA_HERMES_PROFILE_NAME || "inneragora";
const PROFILE_DIR =
  process.env.INNER_AGORA_HERMES_PROFILE_DIR || path.join(os.homedir(), ".hermes", "profiles", PROFILE_NAME);
const CONFIG_PATH = path.join(PROFILE_DIR, "config.yaml");
const SOUL_PATH = path.join(PROFILE_DIR, "SOUL.md");
const MEMORY_PATH = path.join(PROFILE_DIR, "MEMORY.md");
const COCKPIT_CONFIG_PATH = path.join(ROOT, "paperclip-cockpit.json");
const PLUGIN_NAMES = ["paperclip-cockpit"];
const PAPERCLIP_HEALTH_URL = process.env.INNER_AGORA_PAPERCLIP_HEALTH_URL || "http://127.0.0.1:3100/api/health";
const EXPECTED_HERMES_MODEL = process.env.INNER_AGORA_HERMES_MODEL || "google/gemma-4-26b-a4b-qat";
const JSON_OUTPUT = process.argv.includes("--json");
const FIX = process.argv.includes("--fix");

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

function nestedYamlValue(text, section, key) {
  const lines = text.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inSection = line.trim() === `${section}:`;
      continue;
    }
    if (!inSection) continue;
    const match = line.match(new RegExp(`^\\s+${key}:\\s*(.*?)\\s*$`));
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

function record(summary, level, message, details = {}) {
  summary.events.push({ level, message, ...details });
}

function runSetup(summary) {
  const result = spawnSync(process.execPath, ["scripts/setup-hermes-profile.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  summary.changed = true;
  record(summary, result.status === 0 ? "fix" : "error", "ran setup-hermes-profile", {
    status: result.status,
    stderr: String(result.stderr || result.error?.message || "").trim(),
  });
}

async function checkPaperclip(summary) {
  try {
    const response = await fetch(PAPERCLIP_HEALTH_URL, {
      signal: AbortSignal.timeout(5000),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    summary.paperclip = {
      ok: response.ok && data?.ok !== false,
      status: response.status,
      url: PAPERCLIP_HEALTH_URL,
      version: data?.version || null,
    };
    if (!summary.paperclip.ok) record(summary, "error", "Paperclip health check failed", summary.paperclip);
  } catch (error) {
    summary.paperclip = { ok: false, url: PAPERCLIP_HEALTH_URL, error: error.message };
    record(summary, "error", "Paperclip health check failed", summary.paperclip);
  }
}

function checkFiles(summary) {
  const config = readText(CONFIG_PATH);
  const model = nestedYamlValue(config, "model", "default");
  const cwd = nestedYamlValue(config, "terminal", "cwd");
  const reasoning = nestedYamlValue(config, "agent", "reasoning_effort");
  const soulBytes = fileBytes(SOUL_PATH);
  const memoryBytes = fileBytes(MEMORY_PATH);
  const plugins = PLUGIN_NAMES.map((name) => {
    const pluginPath = path.join(PROFILE_DIR, "plugins", name, "plugin.yaml");
    return {
      name,
      path: pluginPath,
      exists: fs.existsSync(pluginPath),
      enabled: new RegExp(`^\\s*-\\s+${name}\\s*$`, "m").test(config),
    };
  });

  summary.config = { model, cwd, reasoning };
  summary.files = {
    soulPath: SOUL_PATH,
    soulBytes,
    memoryPath: MEMORY_PATH,
    memoryBytes,
    cockpitConfigPath: COCKPIT_CONFIG_PATH,
    cockpitConfigBytes: fileBytes(COCKPIT_CONFIG_PATH),
  };
  summary.plugin = {
    ok: plugins.every((plugin) => plugin.exists && plugin.enabled),
    plugins,
  };

  if (!config) record(summary, "error", "Hermes config.yaml is missing", { path: CONFIG_PATH });
  if (cwd !== ROOT) record(summary, "warn", `Hermes terminal.cwd is ${cwd || "(missing)"}, expected ${ROOT}`);
  if (!model) record(summary, "warn", "Hermes model.default is missing");
  if (model && model !== EXPECTED_HERMES_MODEL) {
    record(summary, "warn", `Hermes model.default is ${model}, expected ${EXPECTED_HERMES_MODEL}`);
  }
  if (reasoning && reasoning !== "none") record(summary, "warn", `Hermes reasoning_effort is ${reasoning}, expected none`);
  if (soulBytes === null) record(summary, "error", "Hermes SOUL.md is missing", { path: SOUL_PATH });
  if (memoryBytes === null) record(summary, "warn", "Hermes MEMORY.md is missing", { path: MEMORY_PATH });
  if (summary.files.cockpitConfigBytes === null) {
    record(summary, "error", "paperclip-cockpit.json is missing", { path: COCKPIT_CONFIG_PATH });
  }
  for (const plugin of plugins) {
    if (!plugin.exists) record(summary, "error", `${plugin.name} plugin is missing`, { path: plugin.path });
    if (plugin.exists && !plugin.enabled) record(summary, "error", `${plugin.name} plugin is not enabled`);
  }
}

function printSummary(summary) {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("The Inner Agora guard");
  console.log(`- profile: ${PROFILE_NAME}`);
  console.log(`- model: ${summary.config?.model || "unknown"}`);
  console.log(`- cwd: ${summary.config?.cwd || "missing"}`);
  console.log(`- reasoning_effort: ${summary.config?.reasoning || "missing"}`);
  console.log(`- SOUL.md: ${summary.files?.soulBytes ?? "missing"} bytes`);
  console.log(`- MEMORY.md: ${summary.files?.memoryBytes ?? "missing"} bytes`);
  console.log(`- paperclip-cockpit.json: ${summary.files?.cockpitConfigBytes ?? "missing"} bytes`);
  console.log(`- plugin: ${summary.plugin?.ok ? "ok" : "failed"}`);
  if (summary.paperclip) {
    console.log(`- Paperclip: ${summary.paperclip.ok ? "ok" : "failed"}${summary.paperclip.version ? ` (${summary.paperclip.version})` : ""}`);
  }
  for (const event of summary.events) {
    console.log(`  ${event.level}: ${event.message}`);
  }
}

const summary = {
  ok: true,
  changed: false,
  profileName: PROFILE_NAME,
  profileDir: PROFILE_DIR,
  events: [],
};

if (FIX) runSetup(summary);
checkFiles(summary);
await checkPaperclip(summary);

summary.ok = !summary.events.some((event) => event.level === "error") && !summary.events.some((event) => event.level === "warn");
printSummary(summary);
process.exitCode = summary.ok ? 0 : 1;
