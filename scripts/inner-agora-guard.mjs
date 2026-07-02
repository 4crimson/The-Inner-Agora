#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hermesProfileConfig } from "./model-routing.mjs";

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
const EXPECTED_HERMES_MODEL = hermesProfileConfig().model;
const WRAPPER_PATH = process.env.INNER_AGORA_WRAPPER_PATH || path.join(os.homedir(), ".local", "bin", "inneragora");
const HERMES_AGENT_DIR = process.env.INNER_AGORA_HERMES_AGENT_DIR || path.join(os.homedir(), ".hermes", "hermes-agent");
const TELEGRAM_ADAPTER_PATH = path.join(HERMES_AGENT_DIR, "plugins", "platforms", "telegram", "adapter.py");
const JSON_OUTPUT = process.argv.includes("--json");
const FIX = process.argv.includes("--fix");

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readEnvFile(file) {
  const values = {};
  for (const line of readText(file).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hermesCommand() {
  return fs.existsSync(WRAPPER_PATH) ? WRAPPER_PATH : "inneragora";
}

function runGatewayCommand(args, timeout = 20000) {
  const result = spawnSync(hermesCommand(), args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || result.error?.message || "").trim(),
  };
}

function runMonitorCommand(args, timeout = 20000) {
  const result = spawnSync(process.execPath, ["scripts/paperclip-cockpit-monitor.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || result.error?.message || "").trim(),
  };
}

function runPythonCheck(source, env = {}, timeout = 20000) {
  const result = spawnSync("python3", ["-c", source], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  let data = {};
  try {
    data = JSON.parse(String(result.stdout || "{}"));
  } catch {
    data = {};
  }
  return {
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || result.error?.message || "").trim(),
    data,
  };
}

function parseGatewayStatus(output) {
  const pidMatch =
    output.match(/Gateway is supervised by launchd \(PID\s+(\d+)\)/) ||
    output.match(/\binneragora\s+[^—]*—\s+PID\s+(\d+)/) ||
    output.match(/\bpid\s*=\s*(\d+)/i);
  return {
    ok: Boolean(pidMatch),
    pid: pidMatch ? Number(pidMatch[1]) : null,
    registered: /Gateway service is registered with launchd|Service definition matches|Launchd plist:/i.test(output),
  };
}

async function checkGateway(summary) {
  const status = runGatewayCommand(["gateway", "status"]);
  const parsed = parseGatewayStatus(`${status.stdout}\n${status.stderr}`);
  summary.gateway = {
    ok: parsed.ok,
    pid: parsed.pid,
    registered: parsed.registered,
    status: status.status,
  };

  if (parsed.ok) return;

  if (FIX) {
    const start = runGatewayCommand(["gateway", "start"]);
    summary.changed = true;
    record(summary, start.status === 0 ? "fix" : "error", "started Hermes gateway", {
      status: start.status,
      stderr: start.stderr,
    });
    await sleep(5000);
    const retry = runGatewayCommand(["gateway", "status"]);
    const retryParsed = parseGatewayStatus(`${retry.stdout}\n${retry.stderr}`);
    summary.gateway = {
      ok: retryParsed.ok,
      pid: retryParsed.pid,
      registered: retryParsed.registered,
      status: retry.status,
    };
    if (!retryParsed.ok) {
      record(summary, "error", "Hermes gateway is still not running after start", {
        status: retry.status,
        stderr: retry.stderr,
      });
    }
    return;
  }

  record(summary, "error", "Hermes gateway is not running", {
    hint: "Run: node scripts/inner-agora-guard.mjs --fix",
  });
}

async function checkMonitor(summary) {
  const cockpitConfig = readJson(COCKPIT_CONFIG_PATH, {});
  const monitorConfig = cockpitConfig.monitor && typeof cockpitConfig.monitor === "object" ? cockpitConfig.monitor : {};
  const enabled = monitorConfig.enabled !== false;
  if (!enabled) {
    summary.monitor = { ok: true, enabled: false };
    return;
  }

  const status = runMonitorCommand(["status", "--json"]);
  let parsed = {};
  try {
    parsed = JSON.parse(status.stdout || "{}");
  } catch {
    parsed = {};
  }
  summary.monitor = {
    ok: status.status === 0 && parsed.loaded === true && Number(parsed.pid || 0) > 0,
    enabled: true,
    loaded: Boolean(parsed.loaded),
    pid: Number(parsed.pid || 0) || null,
    label: parsed.label || monitorConfig.launchd?.label || monitorConfig.launchd_label || "",
    status: status.status,
  };

  if (summary.monitor.ok) return;

  if (FIX) {
    const install = runMonitorCommand(["install", "--json"], 30000);
    summary.changed = true;
    record(summary, install.status === 0 ? "fix" : "error", "installed Paperclip cockpit monitor", {
      status: install.status,
      stderr: install.stderr,
    });
    await sleep(1000);
    const retry = runMonitorCommand(["status", "--json"]);
    let retryParsed = {};
    try {
      retryParsed = JSON.parse(retry.stdout || "{}");
    } catch {
      retryParsed = {};
    }
    summary.monitor = {
      ok: retry.status === 0 && retryParsed.loaded === true && Number(retryParsed.pid || 0) > 0,
      enabled: true,
      loaded: Boolean(retryParsed.loaded),
      pid: Number(retryParsed.pid || 0) || null,
      label: retryParsed.label || summary.monitor.label,
      status: retry.status,
    };
    if (!summary.monitor.ok) {
      record(summary, "error", "Paperclip cockpit monitor is still not running after install", {
        status: retry.status,
        stderr: retry.stderr,
      });
    }
    return;
  }

  record(summary, "error", "Paperclip cockpit monitor is not running", {
    hint: "Run: node scripts/inner-agora-guard.mjs --fix",
    label: summary.monitor.label,
  });
}

async function checkTelegram(summary) {
  const cockpitConfig = readJson(COCKPIT_CONFIG_PATH, {});
  const telegram = cockpitConfig.telegram && typeof cockpitConfig.telegram === "object" ? cockpitConfig.telegram : {};
  const enabled = telegram.enabled === true;
  if (!enabled) {
    summary.telegram = { ok: true, enabled: false };
    return;
  }

  const profileName = telegram.profile || PROFILE_NAME;
  const profileEnv = readEnvFile(path.join(os.homedir(), ".hermes", "profiles", profileName, ".env"));
  const token = process.env.TELEGRAM_BOT_TOKEN || profileEnv.TELEGRAM_BOT_TOKEN || telegram.bot_token || "";
  const homeChatEnv = telegram.home_chat_env || "TELEGRAM_HOME_CHANNEL";
  const homeChat = process.env[homeChatEnv] || profileEnv[homeChatEnv] || telegram.home_chat_id || telegram.chat_id || "";

  summary.telegram = {
    ok: false,
    enabled: true,
    profile: profileName,
    tokenConfigured: Boolean(token),
    homeChatConfigured: Boolean(homeChat),
    callbackPrefix: telegram.callback_prefix || "pc",
  };

  if (!token) {
    record(summary, "error", "Telegram bot token is not configured", { profile: profileName });
    return;
  }
  if (!homeChat) {
    record(summary, "error", "Telegram home chat is not configured", { profile: profileName, env: homeChatEnv });
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json().catch(() => ({}));
    summary.telegram.ok = Boolean(response.ok && data?.ok !== false);
    summary.telegram.botUsername = data?.result?.username || null;
    if (!summary.telegram.ok) {
      record(summary, "error", "Telegram Bot API getMe check failed", { status: response.status });
    }
  } catch (error) {
    summary.telegram.error = error.message;
    record(summary, "error", "Telegram Bot API getMe check failed", { error: error.message });
  }
}

function checkRouterContract(summary) {
  const pluginPath = path.join(PROFILE_DIR, "plugins", "paperclip-cockpit", "__init__.py");
  const source = `
import importlib.util
import json
import os

plugin_path = ${JSON.stringify(pluginPath)}
spec = importlib.util.spec_from_file_location("paperclip_cockpit_guard", plugin_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Event:
    text = "давай спросим агору про отцов и детей"

result = module._pre_gateway_dispatch(Event())
ok = isinstance(result, dict) and result.get("action") == "rewrite" and str(result.get("text") or "").startswith("/agora ask ")
print(json.dumps({
    "ok": ok,
    "action": result.get("action") if isinstance(result, dict) else None,
    "text": result.get("text") if isinstance(result, dict) else None,
}, ensure_ascii=False))
`;
  const check = runPythonCheck(source, {
    PAPERCLIP_COCKPIT_CONFIG: COCKPIT_CONFIG_PATH,
    PAPERCLIP_COCKPIT_NL_REWRITE: "1",
    PAPERCLIP_COCKPIT_NL_WRITES: "0",
    PAPERCLIP_COCKPIT_COMMAND: "",
  });
  summary.router = {
    ok: check.status === 0 && check.data?.ok === true,
    action: check.data?.action || null,
    text: check.data?.text || null,
    status: check.status,
  };
  if (!summary.router.ok) {
    record(summary, "error", "Paperclip cockpit router contract failed", {
      status: check.status,
      stderr: check.stderr,
    });
  }
}

function checkTelegramCallbackContract(summary) {
  const pluginPath = path.join(PROFILE_DIR, "plugins", "paperclip-cockpit", "__init__.py");
  const source = `
import importlib.util
import json
import os

plugin_path = ${JSON.stringify(pluginPath)}
spec = importlib.util.spec_from_file_location("paperclip_cockpit_callback_guard", plugin_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

calls = []
def fake_api(method, payload, *, timeout=20):
    calls.append((method, payload))
    return {"ok": True}

def fake_run_action(name, action, raw_args):
    return f"{name}:{raw_args}"

class Adapter:
    def _is_callback_user_authorized(self, user_id, **kwargs):
        return True

class Query:
    id = "guard-callback"

old_api = module._telegram_api
old_run = module._run_action
module._telegram_api = fake_api
module._run_action = fake_run_action
try:
    result = module._telegram_callback_query(
        adapter=Adapter(),
        query=Query(),
        data="pc:voice:THE-55",
        chat_id="guard-chat",
        user_id="guard-user",
    )
finally:
    module._telegram_api = old_api
    module._run_action = old_run

methods = [method for method, _ in calls]
message = calls[-1][1].get("text", "") if calls else ""
print(json.dumps({
    "ok": result == {"action": "handled"} and methods == ["answerCallbackQuery", "sendMessage"] and message == "telegram_voice:THE-55",
    "result": result,
    "methods": methods,
    "message": message,
}, ensure_ascii=False))
`;
  const check = runPythonCheck(source, {
    PAPERCLIP_COCKPIT_CONFIG: COCKPIT_CONFIG_PATH,
  });
  summary.callback = {
    ok: check.status === 0 && check.data?.ok === true,
    methods: check.data?.methods || [],
    status: check.status,
  };
  if (!summary.callback.ok) {
    record(summary, "error", "Paperclip cockpit Telegram callback contract failed", {
      status: check.status,
      stderr: check.stderr,
    });
  }
}

function checkTelegramAdapterHook(summary) {
  const source = readText(TELEGRAM_ADAPTER_PATH);
  const callbackStart = source.indexOf("async def _handle_callback_query");
  const callbackBody = callbackStart >= 0 ? source.slice(callbackStart, callbackStart + 5000) : "";
  const hookIndex = callbackBody.indexOf("telegram_callback_query");
  const invokeIndex = callbackBody.indexOf("invoke_hook");
  const modelPickerIndex = callbackBody.indexOf("# --- Model picker callbacks ---");
  const returnsHandled = /result\.get\("action"\)\s+in\s+\{"handled",\s*"skip"\}/.test(callbackBody);
  const textStart = source.indexOf("async def _handle_text_message");
  const textBody = textStart >= 0 ? source.slice(textStart, textStart + 2500) : "";
  const textMessages =
    textStart >= 0 &&
    textBody.includes("_build_message_event") &&
    textBody.includes("_clean_bot_trigger_text") &&
    textBody.includes("_enqueue_text_event");

  summary.telegramAdapter = {
    ok:
      Boolean(source) &&
      callbackStart >= 0 &&
      hookIndex >= 0 &&
      invokeIndex >= 0 &&
      modelPickerIndex > hookIndex &&
      returnsHandled &&
      textMessages,
    path: TELEGRAM_ADAPTER_PATH,
    callbackHook: hookIndex >= 0 && invokeIndex >= 0,
    hookBeforeBuiltins: modelPickerIndex > hookIndex,
    returnsHandled,
    textMessages,
  };

  if (!summary.telegramAdapter.ok) {
    record(summary, "error", "Hermes Telegram adapter does not expose the Paperclip callback hook contract", {
      path: TELEGRAM_ADAPTER_PATH,
      callbackHook: summary.telegramAdapter.callbackHook,
      hookBeforeBuiltins: summary.telegramAdapter.hookBeforeBuiltins,
      returnsHandled,
      textMessages,
    });
  }
}

function checkRuntimeState(summary) {
  const cockpitConfig = readJson(COCKPIT_CONFIG_PATH, {});
  const stateFile = cockpitConfig.monitor?.state_file || ".paperclip-cockpit-monitor-state.json";
  const statePath = path.resolve(cockpitConfig.cwd || ROOT, stateFile);
  const state = readJson(statePath, {});
  summary.runtime = {
    monitorStatePath: statePath,
    monitorActivatedAt: state.activatedAt || null,
    monitorTrackedRoots: state.roots && typeof state.roots === "object" ? Object.keys(state.roots).length : 0,
  };
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

async function paperclipApi(pathname) {
  const base = PAPERCLIP_HEALTH_URL.replace(/\/health$/, "");
  const response = await fetch(`${base}${pathname}`, {
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${pathname} failed: ${response.status} ${text}`);
  return data;
}

async function checkPaperclipAgents(summary) {
  const cockpitConfig = readJson(COCKPIT_CONFIG_PATH, {});
  const defaultMode = String(cockpitConfig.agora?.default_mode || "").trim().toLowerCase();
  const expectedAdapter = defaultMode === "local" ? "hermes_local" : "";
  if (!expectedAdapter) {
    summary.agents = { ok: true, checked: false, reason: "no local default mode" };
    return;
  }

  try {
    const companies = await paperclipApi("/companies");
    const company = companies.find((item) => item.name === "The Inner Agora" && item.status !== "archived");
    if (!company) {
      summary.agents = { ok: false, checked: true, error: "The Inner Agora company not found" };
      record(summary, "error", "The Inner Agora company not found for agent adapter check");
      return;
    }

    const agents = await paperclipApi(`/companies/${company.id}/agents`);
    const adapterCounts = {};
    const nonLocalAgents = [];
    const errorAgents = [];
    const wrongModelAgents = [];
    for (const agent of agents) {
      const adapterType = agent.adapterType || "(missing)";
      adapterCounts[adapterType] = (adapterCounts[adapterType] || 0) + 1;
      if (adapterType !== expectedAdapter) nonLocalAgents.push({ name: agent.name, adapterType });
      if (agent.status === "error") errorAgents.push({ name: agent.name, status: agent.status });
      if (agent.adapterConfig?.model && agent.adapterConfig.model !== EXPECTED_HERMES_MODEL) {
        wrongModelAgents.push({ name: agent.name, model: agent.adapterConfig.model });
      }
    }

    summary.agents = {
      ok: nonLocalAgents.length === 0 && errorAgents.length === 0 && wrongModelAgents.length === 0,
      checked: true,
      expectedAdapter,
      expectedModel: EXPECTED_HERMES_MODEL,
      count: agents.length,
      adapterCounts,
      nonLocalAgents,
      errorAgents,
      wrongModelAgents,
    };
    if (nonLocalAgents.length) {
      record(summary, "error", "Paperclip agents are not all configured for local Hermes adapter", {
        expectedAdapter,
        count: nonLocalAgents.length,
      });
    }
    if (errorAgents.length) {
      record(summary, "error", "Paperclip agents have error status", { count: errorAgents.length });
    }
    if (wrongModelAgents.length) {
      record(summary, "error", "Paperclip agents have unexpected local model", {
        expectedModel: EXPECTED_HERMES_MODEL,
        count: wrongModelAgents.length,
      });
    }
  } catch (error) {
    summary.agents = { ok: false, checked: true, error: error.message };
    record(summary, "error", "Paperclip agent adapter check failed", { error: error.message });
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
  if (summary.agents?.checked) {
    console.log(`- Paperclip agents: ${summary.agents.ok ? `ok (${summary.agents.count}, ${summary.agents.expectedAdapter})` : "failed"}`);
  }
  if (summary.gateway) {
    console.log(`- Hermes gateway: ${summary.gateway.ok ? `ok (PID ${summary.gateway.pid})` : "failed"}`);
  }
  if (summary.monitor) {
    console.log(`- Paperclip monitor: ${summary.monitor.ok ? `ok (PID ${summary.monitor.pid})` : "failed"}`);
  }
  if (summary.telegram?.enabled) {
    console.log(`- Telegram Bot API: ${summary.telegram.ok ? `ok (${summary.telegram.botUsername || "bot"})` : "failed"}`);
  }
  if (summary.telegramAdapter) {
    console.log(`- Telegram adapter hook: ${summary.telegramAdapter.ok ? "ok" : "failed"}`);
  }
  if (summary.router) {
    console.log(`- Conversational router: ${summary.router.ok ? "ok" : "failed"}`);
  }
  if (summary.callback) {
    console.log(`- Telegram callbacks: ${summary.callback.ok ? "ok" : "failed"}`);
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
checkRuntimeState(summary);
await checkPaperclip(summary);
await checkPaperclipAgents(summary);
await checkGateway(summary);
await checkMonitor(summary);
await checkTelegram(summary);
checkTelegramAdapterHook(summary);
checkRouterContract(summary);
checkTelegramCallbackContract(summary);

summary.ok = !summary.events.some((event) => event.level === "error") && !summary.events.some((event) => event.level === "warn");
printSummary(summary);
process.exitCode = summary.ok ? 0 : 1;
