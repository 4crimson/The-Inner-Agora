#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = process.env.PAPERCLIP_COCKPIT_CONFIG || path.join(ROOT, "paperclip-cockpit.json");
const API_BASE = (process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api").replace(/\/$/, "");

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/paperclip-cockpit-telegram.mjs send-result ISSUE [--chat CHAT] [--dry-run]
  node scripts/paperclip-cockpit-telegram.mjs send-voice ISSUE [--chat CHAT] [--dry-run]
  node scripts/paperclip-cockpit-telegram.mjs send-latest ISSUE [--chat CHAT] [--dry-run]
  node scripts/paperclip-cockpit-telegram.mjs payload-result ISSUE
  node scripts/paperclip-cockpit-telegram.mjs payload-voice ISSUE
  node scripts/paperclip-cockpit-telegram.mjs payload-latest ISSUE
  node scripts/paperclip-cockpit-telegram.mjs keyboard ISSUE [--dry-run]
`);
  process.exit(exitCode);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readEnvFile(filePath) {
  const values = {};
  try {
    const text = fs.readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    return values;
  }
  return values;
}

const config = readJson(CONFIG_PATH);
const telegram = config.telegram && typeof config.telegram === "object" ? config.telegram : {};
const buttonConfig = telegram.buttons && typeof telegram.buttons === "object" ? telegram.buttons : {};

function profileEnv() {
  const profile = process.env.HERMES_PROFILE || telegram.profile || "";
  if (!profile) return {};
  return readEnvFile(path.join(os.homedir(), ".hermes", "profiles", profile, ".env"));
}

function envValue(name) {
  return process.env[name] || profileEnv()[name] || "";
}

function telegramToken() {
  return envValue("TELEGRAM_BOT_TOKEN") || telegram.bot_token || "";
}

function telegramChat(explicit = "") {
  const envName = telegram.home_chat_env || "TELEGRAM_HOME_CHANNEL";
  return explicit || envValue(envName) || telegram.home_chat_id || telegram.chat_id || "";
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
  return data;
}

async function telegramApi(method, payload) {
  const token = telegramToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) throw new Error(`Telegram ${method} failed: ${response.status} ${text}`);
  return data;
}

function issueRef(issue) {
  return issue?.identifier || issue?.id || "";
}

function issueNumber(issue) {
  const direct = Number(issue?.issueNumber);
  if (Number.isFinite(direct)) return direct;
  const match = String(issueRef(issue)).match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function byIssueNumber(left, right) {
  const delta = issueNumber(left) - issueNumber(right);
  if (delta) return delta;
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
}

function isSynthesis(issue) {
  const pattern = telegram.synthesis_title_pattern || "^Синтез:|^Synthesis:";
  return new RegExp(pattern, "i").test(String(issue?.title || ""));
}

async function resolveRoot(issue) {
  let current = issue;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = await api(`/issues/${current.parentId}`);
  }
  return current;
}

function childrenOf(root, issues) {
  return issues.filter((issue) => issue.parentId === root.id && !issue.hiddenAt).sort(byIssueNumber);
}

function voiceLabel(child) {
  const titleName = String(child.title || "").split(":", 1)[0].trim();
  if (titleName && !/^синтез$/i.test(titleName)) return titleName.split("/")[0].trim();
  return issueRef(child);
}

function callbackData(name, arg) {
  const prefix = telegram.callback_prefix || "pc";
  return `${prefix}:${name}:${arg}`;
}

function buildKeyboard(root, issues) {
  const labels = buttonConfig.labels || {};
  const voiceLimit = Number(buttonConfig.voice_limit || 6);
  const children = childrenOf(root, issues);
  const synthesis = [...children].reverse().find(isSynthesis);
  const voices = children.filter((child) => child.id !== synthesis?.id).slice(0, voiceLimit);
  const rows = [];

  rows.push([
    {
      text: labels.synthesis || "Synthesis",
      callback_data: callbackData("result", issueRef(synthesis || root)),
    },
  ]);

  for (let index = 0; index < voices.length; index += 2) {
    rows.push(
      voices.slice(index, index + 2).map((child) => ({
        text: voiceLabel(child).slice(0, 32),
        callback_data: callbackData("voice", issueRef(child)),
      })),
    );
  }

  const bottom = [
    { text: labels.all_voices || "All voices", callback_data: callbackData("latest", issueRef(root)) },
  ];
  if (config.actions?.memory) bottom.push({ text: labels.export || "Export", callback_data: callbackData("export", issueRef(root)) });
  bottom.push({ text: labels.clarify || "Clarify", callback_data: callbackData("clarify", issueRef(root)) });
  rows.push(bottom);

  return { inline_keyboard: rows };
}

function actionCommand(name, args = []) {
  const action = config.actions?.[name];
  if (!action) throw new Error(`Action is not configured: ${name}`);
  const command = Array.isArray(action.exec) ? action.exec.map(String) : String(action.exec || "").split(/\s+/).filter(Boolean);
  if (!command.length) throw new Error(`Action has no exec: ${name}`);
  return [...command, ...args];
}

function runAction(name, args = []) {
  const command = actionCommand(name, args);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: config.cwd || ROOT,
    encoding: "utf8",
    timeout: Number(config.actions?.[name]?.timeout || 180) * 1000,
    env: process.env,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status !== 0) throw new Error(output || `${command.join(" ")} exited ${result.status}`);
  return output || "OK";
}

function telegramPayload(text, keyboard) {
  return {
    text: String(text || "").trim() || "OK",
    reply_markup: keyboard || null,
  };
}

function printPayload(text, keyboard) {
  console.log(JSON.stringify(telegramPayload(text, keyboard), null, 2));
}

function chunks(text, limit = 3900) {
  let body = String(text || "").trim() || "OK";
  const out = [];
  while (body.length > limit) {
    let splitAt = body.lastIndexOf("\n\n", limit);
    if (splitAt < 1200) splitAt = body.lastIndexOf("\n", limit);
    if (splitAt < 1200) splitAt = limit;
    out.push(body.slice(0, splitAt).trim());
    body = body.slice(splitAt).trim();
  }
  out.push(body);
  return out;
}

async function sendText(chatId, text, keyboard, dryRun) {
  if (dryRun) {
    console.log(JSON.stringify({ chat_id: chatId || "(default)", text, reply_markup: keyboard }, null, 2));
    return;
  }
  const target = telegramChat(chatId);
  if (!target) throw new Error("Telegram chat id is not configured");
  const parts = chunks(text);
  for (let index = 0; index < parts.length; index += 1) {
    await telegramApi("sendMessage", {
      chat_id: target,
      text: parts[index],
      disable_web_page_preview: true,
      ...(index === 0 && keyboard ? { reply_markup: keyboard } : {}),
    });
  }
}

async function issueTree(issueRefArg) {
  const issue = await api(`/issues/${issueRefArg}`);
  const root = await resolveRoot(issue);
  const issues = await api(`/companies/${root.companyId}/issues`);
  return { issue, root, issues };
}

function parseArgs(args) {
  const options = { dryRun: false, chatId: "" };
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--chat") options.chatId = args[++index] || "";
    else rest.push(arg);
  }
  return { options, rest };
}

async function main() {
  const [command, ...tail] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") usage(0);
  const { options, rest } = parseArgs(tail);
  const issueRefArg = rest[0];
  if (!issueRefArg) usage(1);

  const { issue, root, issues } = await issueTree(issueRefArg);
  const keyboard = buildKeyboard(root, issues);

  if (command === "keyboard") {
    console.log(JSON.stringify(keyboard, null, 2));
    return;
  }

  if (command === "payload-result") {
    const synthesis = [...childrenOf(root, issues)].reverse().find(isSynthesis);
    const text = runAction("result", [issueRef(synthesis || issue)]);
    printPayload(text, keyboard);
    return;
  }

  if (command === "payload-voice") {
    const text = runAction("result", [issueRef(issue)]);
    printPayload(text, keyboard);
    return;
  }

  if (command === "payload-latest") {
    const text = runAction("latest", [issueRef(root)]);
    printPayload(text, keyboard);
    return;
  }

  if (command === "send-result") {
    const synthesis = [...childrenOf(root, issues)].reverse().find(isSynthesis);
    const text = runAction("result", [issueRef(synthesis || root)]);
    await sendText(options.chatId, text, keyboard, options.dryRun);
    return;
  }

  if (command === "send-voice") {
    const text = runAction("result", [issueRef(issue)]);
    await sendText(options.chatId, text, keyboard, options.dryRun);
    return;
  }

  if (command === "send-latest") {
    const text = runAction("latest", [issueRef(root)]);
    await sendText(options.chatId, text, keyboard, options.dryRun);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
