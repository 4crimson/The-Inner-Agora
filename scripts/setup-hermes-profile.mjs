#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_NAME = process.env.INNER_AGORA_HERMES_PROFILE_NAME || "inneragora";
const SOURCE_PROFILE = process.env.INNER_AGORA_HERMES_SOURCE_PROFILE || "aiboard";
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
const PROFILE_DIR = process.env.INNER_AGORA_HERMES_PROFILE_DIR || path.join(HERMES_HOME, "profiles", PROFILE_NAME);
const SOURCE_CONFIG = path.join(HERMES_HOME, "profiles", SOURCE_PROFILE, "config.yaml");
const CONFIG_PATH = path.join(PROFILE_DIR, "config.yaml");
const SOUL_PATH = path.join(PROFILE_DIR, "SOUL.md");
const MEMORY_PATH = path.join(PROFILE_DIR, "MEMORY.md");
const PROFILE_YAML_PATH = path.join(PROFILE_DIR, "profile.yaml");
const PLUGIN_SOURCE = path.join(ROOT, "hermes-plugins", "inner-agora-commands");
const PLUGIN_TARGET = path.join(PROFILE_DIR, "plugins", "inner-agora-commands");
const WRAPPER_PATH = process.env.INNER_AGORA_WRAPPER_PATH || path.join(os.homedir(), ".local", "bin", "inneragora");

function configTemplate() {
  return `model:
  provider: custom
  default: google/gemma-4-26b-a4b-qat
  base_url: http://192.168.1.229:1234/v1
  api_key: no-key-required
  context_length: 131072
  api_mode: chat_completions
providers: {}
fallback_providers: []
toolsets:
  - hermes-cli
max_live_sessions: 16
agent:
  max_turns: 20
  gateway_timeout: 1800
  restart_drain_timeout: 180
  reasoning_effort: none
  task_completion_guidance: true
  parallel_tool_call_guidance: true
  environment_probe: true
  verify_on_stop: auto
  gateway_timeout_warning: 900
  clarify_timeout: 600
  gateway_notify_interval: 180
  gateway_auto_continue_freshness: 3600
terminal:
  backend: local
  modal_mode: auto
  cwd: ${ROOT}
  timeout: 180
  persistent_shell: true
web:
  backend: ''
  search_backend: ddgs
browser:
  inactivity_timeout: 120
  command_timeout: 30
  allow_private_urls: false
checkpoints:
  enabled: false
context_file_max_chars: null
file_read_max_chars: 100000
mcp_discovery_timeout: 1.5
`;
}

function transformConfig(text) {
  const lines = text.split(/\r?\n/);
  let inTerminal = false;
  let replacedCwd = false;
  const next = [];

  for (const line of lines) {
    if (/^\S/.test(line)) inTerminal = line.trim() === "terminal:";
    if (inTerminal && /^\s+cwd:\s*/.test(line)) {
      next.push(`  cwd: ${ROOT}`);
      replacedCwd = true;
    } else {
      next.push(line);
    }
  }

  if (!replacedCwd) {
    next.push("");
    next.push("terminal:");
    next.push("  backend: local");
    next.push(`  cwd: ${ROOT}`);
    next.push("  timeout: 180");
  }

  return ensurePluginConfig(`${next.join("\n").trim()}\n`);
}

function ensurePluginConfig(text) {
  const pluginBlock = [
    "plugins:",
    "  enabled:",
    "    - inner-agora-commands",
    "  disabled: []",
    "",
  ].join("\n");

  if (/^plugins:\n(?:[ \t].*\n)*/m.test(text)) {
    return text.replace(/^plugins:\n(?:[ \t].*\n)*/m, pluginBlock);
  }

  return `${text.trim()}\n${pluginBlock}`;
}

function soulText() {
  return `The Inner Agora Hermes. Russian by default. Telegram is strict command mode.

Workspace: \`${ROOT}\`
Always run shell commands from that workspace.

No command prefix = no tools, no Paperclip issue. Reply briefly and suggest a command.
Unknown command = show \`помощь\`. Never reveal secrets.

Preferred deterministic slash commands:

\`\`\`text
/agora-prepare [local|balanced|max]
/agora-status
/agora-tasks [open|all] [limit]
/agora-task ISSUE
/agora-move ISSUE STATUS
/agora-council QUESTION
/agora-ask [--min|--balanced|--max|--all|--philosophers list] QUESTION
/agora-dialogue PHILOSOPHER QUESTION
/agora-synth ISSUE
/agora-memory ISSUE
/agora-guard
\`\`\`

Russian prompt-routed commands:

\`\`\`text
помощь                         show commands, no tools
статус                         node scripts/agora.mjs status
задачи                         node scripts/agora.mjs tasks --open --limit 20
задачи все                     node scripts/agora.mjs tasks --all --limit 20
задача: ISSUE                  node scripts/agora.mjs task ISSUE
двинь: ISSUE STATUS            node scripts/agora.mjs move ISSUE STATUS
режим                          node scripts/agora.mjs mode
режим: MODE                    node scripts/agora.mjs mode set MODE
совет: QUESTION                node scripts/agora.mjs council "QUESTION"
агора: QUESTION                node scripts/agora.mjs prepare && node scripts/agora.mjs ask "QUESTION"
агора-мин: QUESTION            node scripts/agora.mjs ask --min "QUESTION"
агора-макс: QUESTION           node scripts/agora.mjs ask --max "QUESTION"
агора-все: QUESTION            node scripts/agora.mjs ask --all "QUESTION"
диалог: PHILOSOPHER QUESTION   node scripts/agora.mjs dialogue PHILOSOPHER "QUESTION"
синтез: ISSUE                  node scripts/agora.mjs synthesize ISSUE
память: ISSUE                  node scripts/agora.mjs export-memory ISSUE
\`\`\`

Allowed move statuses: \`todo\`, \`in_progress\`, \`blocked\`, \`done\`, \`cancelled\`.
Allowed modes: \`min\`, \`local\`, \`balanced\`, \`max\`, \`all\`.

For \`помощь\`, show the command list above.

If Paperclip fetch fails, check:
\`curl -sS http://127.0.0.1:3100/api/health\`
If down, restart once:
\`launchctl kickstart -k gui/$(id -u)/local.paperclipai.default\`
`;
}

function memoryText() {
  return `# The Inner Agora Memory

Project: ${ROOT}
Paperclip company: The Inner Agora

Current principle: build from simple to complex.

- Philosophers are personality-machines, not narrow business roles.
- Plato, Descartes, and Heidegger form the architect layer.
- Agora Assistant moderates and synthesizes; it is not itself a philosopher.
- Keep disagreement visible.
- Prompts are intentionally simple for now.
`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfChanged(filePath, body, mode) {
  const next = body.endsWith("\n") ? body : `${body}\n`;
  let current = null;
  try {
    current = fs.readFileSync(filePath, "utf8");
  } catch {
    current = null;
  }
  if (current !== next) fs.writeFileSync(filePath, next, mode ? { mode } : undefined);
}

function main() {
  ensureDir(PROFILE_DIR);
  ensureDir(path.join(PROFILE_DIR, "plugins"));
  ensureDir(path.dirname(WRAPPER_PATH));

  const sourceConfig = fs.existsSync(SOURCE_CONFIG) ? fs.readFileSync(SOURCE_CONFIG, "utf8") : configTemplate();
  writeFileIfChanged(CONFIG_PATH, transformConfig(sourceConfig));
  writeFileIfChanged(SOUL_PATH, soulText());
  writeFileIfChanged(MEMORY_PATH, memoryText());
  writeFileIfChanged(
    PROFILE_YAML_PATH,
    [`name: ${PROFILE_NAME}`, "display_name: The Inner Agora", `root: ${PROFILE_DIR}`, ""].join("\n"),
  );

  fs.rmSync(PLUGIN_TARGET, { recursive: true, force: true });
  fs.cpSync(PLUGIN_SOURCE, PLUGIN_TARGET, { recursive: true });

  writeFileIfChanged(WRAPPER_PATH, `#!/bin/sh\nexec hermes -p ${PROFILE_NAME} "$@"\n`, 0o755);
  fs.chmodSync(WRAPPER_PATH, 0o755);

  console.log("Hermes profile prepared");
  console.log(`Profile: ${PROFILE_NAME}`);
  console.log(`Dir: ${PROFILE_DIR}`);
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`SOUL: ${SOUL_PATH}`);
  console.log(`Plugin: ${PLUGIN_TARGET}`);
  console.log(`Wrapper: ${WRAPPER_PATH}`);
  console.log("");
  console.log("Telegram/env secrets were not copied automatically.");
  console.log("If you want this profile to receive Telegram messages, configure its gateway credentials separately.");
}

main();
