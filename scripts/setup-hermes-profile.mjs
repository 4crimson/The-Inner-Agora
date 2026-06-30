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
const DEPRECATED_PLUGINS = ["paperclip-commands", "inner-agora-commands"];
const PLUGINS = ["paperclip-cockpit"].map((name) => ({
  name,
  source: path.join(ROOT, "hermes-plugins", name),
  target: path.join(PROFILE_DIR, "plugins", name),
}));
const WRAPPER_PATH = process.env.INNER_AGORA_WRAPPER_PATH || path.join(os.homedir(), ".local", "bin", "inneragora");
const HERMES_MODEL = process.env.INNER_AGORA_HERMES_MODEL || "google/gemma-4-26b-a4b-qat";
const HERMES_BASE_URL = process.env.INNER_AGORA_HERMES_BASE_URL || "http://192.168.1.229:1234/v1";

function configTemplate() {
  return `model:
  provider: custom
  default: ${HERMES_MODEL}
  base_url: ${HERMES_BASE_URL}
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
  disabled_toolsets: [delegation, code_execution, session_search]
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
compression:
  enabled: true
  threshold: 0.5
  target_ratio: 0.2
auxiliary:
  compression:
    provider: auto
    model: ''
    context_length: 131072
session_reset:
  mode: both
  idle_minutes: 30
  at_hour: 4
`;
}

function setNestedYamlValue(text, section, key, value) {
  const lines = text.split(/\r?\n/);
  const sectionLine = `${section}:`;
  let start = lines.findIndex((line) => line.trim() === sectionLine && !/^\s/.test(line));

  if (start === -1) {
    if (lines.at(-1) === "") lines.pop();
    lines.push(sectionLine, `  ${key}: ${value}`, "");
    return lines.join("\n");
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) {
      end = index;
      break;
    }
  }

  for (let index = start + 1; index < end; index += 1) {
    if (new RegExp(`^\\s+${key}:\\s*`).test(lines[index])) {
      lines[index] = `  ${key}: ${value}`;
      return lines.join("\n");
    }
  }

  lines.splice(end, 0, `  ${key}: ${value}`);
  return lines.join("\n");
}

function setDoubleNestedYamlValue(text, section, subsection, key, value) {
  const lines = text.split(/\r?\n/);
  const sectionLine = `${section}:`;
  let sectionStart = lines.findIndex((line) => line.trim() === sectionLine && !/^\s/.test(line));

  if (sectionStart === -1) {
    if (lines.at(-1) === "") lines.pop();
    lines.push(sectionLine, `  ${subsection}:`, `    ${key}: ${value}`, "");
    return lines.join("\n");
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  const subsectionPattern = new RegExp(`^\\s{2}${subsection}:\\s*$`);
  let subsectionStart = -1;
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (subsectionPattern.test(lines[index])) {
      subsectionStart = index;
      break;
    }
  }

  if (subsectionStart === -1) {
    lines.splice(sectionEnd, 0, `  ${subsection}:`, `    ${key}: ${value}`);
    return lines.join("\n");
  }

  let subsectionEnd = sectionEnd;
  for (let index = subsectionStart + 1; index < sectionEnd; index += 1) {
    if (/^\s{2}\S/.test(lines[index])) {
      subsectionEnd = index;
      break;
    }
  }

  for (let index = subsectionStart + 1; index < subsectionEnd; index += 1) {
    if (new RegExp(`^\\s{4}${key}:\\s*`).test(lines[index])) {
      lines[index] = `    ${key}: ${value}`;
      return lines.join("\n");
    }
  }

  lines.splice(subsectionEnd, 0, `    ${key}: ${value}`);
  return lines.join("\n");
}

function transformConfig(text) {
  let next = `${text.trim()}\n`;
  next = setNestedYamlValue(next, "model", "default", HERMES_MODEL);
  next = setNestedYamlValue(next, "model", "base_url", HERMES_BASE_URL);
  next = setNestedYamlValue(next, "agent", "reasoning_effort", "none");
  next = setNestedYamlValue(next, "agent", "disabled_toolsets", "[delegation, code_execution, session_search]");
  next = setNestedYamlValue(next, "terminal", "cwd", ROOT);
  next = setNestedYamlValue(next, "memory", "nudge_interval", "0");
  next = setNestedYamlValue(next, "memory", "flush_min_turns", "0");
  next = setNestedYamlValue(next, "skills", "creation_nudge_interval", "0");
  next = setNestedYamlValue(next, "compression", "enabled", "true");
  next = setDoubleNestedYamlValue(next, "auxiliary", "compression", "context_length", "131072");
  next = setNestedYamlValue(next, "session_reset", "mode", "both");
  next = setNestedYamlValue(next, "session_reset", "idle_minutes", "30");
  next = setNestedYamlValue(next, "session_reset", "at_hour", "4");
  return ensurePluginConfig(`${next.trim()}\n`);
}

function ensurePluginConfig(text) {
  const pluginBlock = [
    "plugins:",
    "  enabled:",
    ...PLUGINS.map((plugin) => `    - ${plugin.name}`),
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

Identity:
- You are the Hermes/Telegram gateway for The Inner Agora.
- The Inner Agora lives in Paperclip; Paperclip is the system of record for agents, issues, runs, and sessions.
- You are not the whole Agora and not a philosopher. You route requests into Paperclip and report what Paperclip currently contains.
- When the user says "в перклипе", "Paperclip", "в проекте", or "в агоре", assume they mean this local Paperclip company unless context says otherwise.

Natural read-only project requests are allowed. If the user asks to show/check/learn status, tasks, issues, or the philosopher roster, run the matching safe command. Creating Paperclip issues still requires an explicit command or a clearly phrased request.
Unknown command = show \`помощь\`. Never reveal secrets.

Work creation rule:
- If the user says "поставь задачу", "создай задачу", "запусти исследование", "создай сессию", "запусти совет", or similar with a concrete question in the same message, run \`/agora ask QUESTION\`.
- If the user confirms a philosopher list that you just proposed ("мне нравится твой выбор", "давай этим составом", "давай поставим задачу", "потом сведем"), reuse the visible previous list and run \`/agora ask --philosophers key1,key2,... QUESTION\`.
- Do not replace Paperclip task creation with \`execute_code\`, ad-hoc file reads, or a prose-only plan when the user asked to put the work into Paperclip.
- If the user wants synthesis later, create the Agora session first; after child answers are ready, use \`/agora synth ISSUE\`.
- If the previous list or question is ambiguous, ask one short clarification instead of inventing participants.

Truthfulness and durable-work rule:
- Paperclip has companies, agents, issues, runs, and comments. Local markdown files under this workspace are project documents, not "Paperclip files".
- Do not use old Telegram/session history to answer Paperclip state questions. For summaries of tasks, subtasks, results, rosters, or comments, use Paperclip commands such as \`/agora latest\`, \`/agora session ISSUE\`, \`/agora notes ISSUE\`, \`/agora philosophers\`, or \`/agora status\`.
- Never emit raw tool-call markup such as \`<|channel>\`, \`call:terminal{...}\`, or \`<tool_call|>\`. If command routing fails, answer in plain Russian and suggest the exact \`/agora ...\` command.
- Do not say that background agents, researchers, or web research are working unless you created or observed a durable Paperclip issue/run and can name its identifier.
- Do not promise "I will notify when ready" unless a durable Paperclip issue/run/automation exists. Otherwise say what was actually created or ask the user to create a session.
- Do not claim web research is running or complete unless a web tool actually ran successfully. If web/check_web_api_key is unavailable, state that web is unavailable.
- For Agora research, create Paperclip sessions with \`/agora ask\`; do not use local file reads, async subagents, or \`execute_code\` as substitutes for task creation.
- If local philosopher research notes are stubs, call them local draft notes/stubs and create Paperclip tasks for the missing work instead of pretending the research is in progress.

Preferred deterministic slash commands:

\`\`\`text
/agora help
/agora health
/agora agoras
/agora philosophers [--company "The Inner Agora"]
/agora sessions [open|all|todo|in_progress|blocked|done|cancelled] [limit]
/agora session ISSUE
/agora notes ISSUE
/agora capabilities
/agora prepare [local|balanced|max]
/agora status
/agora recheck [ISSUE]
/agora mode [get|set MODE]
/agora latest [ISSUE]
/agora result [ISSUE] [--full]
/agora council QUESTION
/agora ask [--min|--balanced|--max|--all|--philosophers list] QUESTION
/agora min QUESTION
/agora max QUESTION
/agora all QUESTION
/agora dialogue PHILOSOPHER QUESTION
/agora synth ISSUE
/agora finalize ISSUE
/agora memory ISSUE
/agora guard
\`\`\`

\`/agora\` is provided by the universal Paperclip Cockpit plugin through \`paperclip-cockpit.json\`. The generic fallback \`/pc\` is intentionally not registered for this project.

Russian prompt-routed commands:

\`\`\`text
помощь                         show commands, no tools
статус                         /agora status
философы                       /agora philosophers
список философов               /agora philosophers
кто в перклипе                 /agora philosophers
узнай список философов в перклипе  /agora philosophers
задачи                         /agora sessions
задачи все                     /agora sessions all 20
задача: ISSUE                  /agora session ISSUE
выжимка последней таски        /agora latest
последняя таска с подтасками   /agora latest
результаты последней задачи    /agora latest
результат синтеза: ISSUE       /agora result ISSUE
дай результат по синтезу ISSUE /agora result ISSUE
давай результат                /agora result
последняя выжимка              /agora result
какой статус ISSUE             /agora status ISSUE
перепроверь статус ISSUE       /agora recheck ISSUE
в вебе другой статус           /agora recheck
закрой пакет: ISSUE            /agora finalize ISSUE
режим                          /agora mode
режим: MODE                    /agora mode set MODE
совет: QUESTION                /agora council QUESTION
поставь задачу: QUESTION       /agora ask QUESTION
создай сессию: QUESTION        /agora ask QUESTION
запусти исследование: QUESTION /agora ask QUESTION
агора: QUESTION                /agora ask QUESTION
агора-мин: QUESTION            /agora min QUESTION
агора-макс: QUESTION           /agora max QUESTION
агора-все: QUESTION            /agora all QUESTION
диалог: PHILOSOPHER QUESTION   /agora dialogue PHILOSOPHER QUESTION
синтез: ISSUE                  /agora synth ISSUE
память: ISSUE                  /agora memory ISSUE
\`\`\`

\`/agora synth\` is only for a root session. If the target is already a synthesis issue or a child issue, use \`/agora result ISSUE\` or synthesize the root parent instead.
If the user challenges a Paperclip status, do not explain from memory. Run \`/agora recheck ISSUE\` or \`/agora recheck\` and report the fresh Paperclip value.

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
- Hermes is the Telegram gateway into the Paperclip company, not a separate philosopher.
- Paperclip is the system of record for the active philosopher roster.
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

  for (const plugin of PLUGINS) {
    fs.rmSync(plugin.target, { recursive: true, force: true });
    fs.cpSync(plugin.source, plugin.target, { recursive: true });
  }
  for (const name of DEPRECATED_PLUGINS) {
    fs.rmSync(path.join(PROFILE_DIR, "plugins", name), { recursive: true, force: true });
  }

  writeFileIfChanged(WRAPPER_PATH, `#!/bin/sh\nexec hermes -p ${PROFILE_NAME} "$@"\n`, 0o755);
  fs.chmodSync(WRAPPER_PATH, 0o755);

  console.log("Hermes profile prepared");
  console.log(`Profile: ${PROFILE_NAME}`);
  console.log(`Dir: ${PROFILE_DIR}`);
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`SOUL: ${SOUL_PATH}`);
  for (const plugin of PLUGINS) console.log(`Plugin: ${plugin.target}`);
  console.log(`Wrapper: ${WRAPPER_PATH}`);
  console.log("");
  console.log("Telegram/env secrets were not copied automatically.");
  console.log("If you want this profile to receive Telegram messages, configure its gateway credentials separately.");
}

main();
