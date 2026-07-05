#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buttonRows as buildButtonRows,
  byIssueNumber,
  byRecentIssue,
  callbackData as formatCallbackData,
  childrenOf,
  isSynthesisIssue,
  isTerminalIssue,
  issueRef,
  terminalStatusSet,
  voiceLabel,
} from "./telegram/payload-utils.mjs";
import {
  latestQaRun as findLatestQaRun,
  qaBugs,
  qaCleanupWord,
  qaCounts,
  qaStatusWord,
  resolveQaArtifactsDir,
} from "./telegram/qa-artifacts.mjs";
import { sendText as sendTelegramText } from "./telegram/sender.mjs";
import { stopCleanup as runStopCleanup } from "./telegram/stop-cleanup.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = process.env.PAPERCLIP_COCKPIT_CONFIG || path.join(ROOT, "paperclip-cockpit.json");
const API_BASE = (process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api").replace(/\/$/, "");

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/paperclip-cockpit-telegram.mjs send-result ISSUE [--chat CHAT] [--dry-run]
  node scripts/paperclip-cockpit-telegram.mjs send-voice ISSUE [--chat CHAT] [--dry-run]
  node scripts/paperclip-cockpit-telegram.mjs send-latest ISSUE [--chat CHAT] [--dry-run]
  node scripts/paperclip-cockpit-telegram.mjs send-progress ISSUE [--chat CHAT] [--dry-run]
  node scripts/paperclip-cockpit-telegram.mjs payload-result ISSUE
  node scripts/paperclip-cockpit-telegram.mjs payload-voice ISSUE
  node scripts/paperclip-cockpit-telegram.mjs payload-latest ISSUE
  node scripts/paperclip-cockpit-telegram.mjs payload-progress ISSUE
  node scripts/paperclip-cockpit-telegram.mjs payload-last-session [ISSUE]
  node scripts/paperclip-cockpit-telegram.mjs payload-final-result [ISSUE]
  node scripts/paperclip-cockpit-telegram.mjs payload-history
  node scripts/paperclip-cockpit-telegram.mjs payload-philosophers [ISSUE]
  node scripts/paperclip-cockpit-telegram.mjs payload-philosopher-search QUERY
  node scripts/paperclip-cockpit-telegram.mjs payload-philosopher-choice PHILOSOPHER
  node scripts/paperclip-cockpit-telegram.mjs payload-deep-proposal TOPIC
  node scripts/paperclip-cockpit-telegram.mjs payload-custom-proposal TOPIC
  node scripts/paperclip-cockpit-telegram.mjs payload-custom-edit-prompt add|remove --philosophers KEYS [--topic TOPIC]
  node scripts/paperclip-cockpit-telegram.mjs payload-custom-edit add|remove --philosophers KEYS --topic TOPIC --query QUERY
  node scripts/paperclip-cockpit-telegram.mjs payload-qa-status
  node scripts/paperclip-cockpit-telegram.mjs payload-qa-report
  node scripts/paperclip-cockpit-telegram.mjs payload-qa-failures
  node scripts/paperclip-cockpit-telegram.mjs payload-qa-cleanup
  node scripts/paperclip-cockpit-telegram.mjs payload-details [ISSUE]
  node scripts/paperclip-cockpit-telegram.mjs payload-stop-confirm ISSUE
  node scripts/paperclip-cockpit-telegram.mjs payload-stop-cleanup ISSUE
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

function isSynthesis(issue) {
  const pattern = telegram.synthesis_title_pattern || "^Синтез:|^Synthesis:";
  return isSynthesisIssue(issue, pattern);
}

function terminalStatuses() {
  const configured = Array.isArray(config.monitor?.terminal_statuses) ? config.monitor.terminal_statuses : [];
  return terminalStatusSet(configured);
}

function isTerminal(issue) {
  return isTerminalIssue(issue, terminalStatuses());
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

function callbackData(name, arg) {
  const prefix = telegram.callback_prefix || "pc";
  return formatCallbackData(name, arg, prefix);
}

function quickActionRows(root) {
  const actions = Array.isArray(buttonConfig.quick_actions) ? buttonConfig.quick_actions : [];
  const buttons = actions
    .map((action) => {
      const label = String(action?.label || action?.text || "").trim();
      const callback = String(action?.callback || action?.name || "").trim();
      if (!label || !callback) return null;
      return { text: label.slice(0, 32), callback_data: callbackData(callback, issueRef(root)) };
    })
    .filter(Boolean);
  const rows = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return rows;
}

function buttonRows(buttons, fallbackArg = "help") {
  return buildButtonRows(buttons, { prefix: telegram.callback_prefix || "pc", fallbackArg });
}

function buildKeyboard(root, issues) {
  const labels = buttonConfig.labels || {};
  const callbacks = buttonConfig.callbacks || {};
  const voiceLimit = Number(buttonConfig.voice_limit || 6);
  const children = childrenOf(root, issues);
  const synthesis = [...children].reverse().find(isSynthesis);
  const voices = children.filter((child) => child.id !== synthesis?.id).slice(0, voiceLimit);
  const rows = [];

  rows.push([
    {
      text: labels.full_result || labels.synthesis || "Synthesis",
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
    {
      text: labels.all_voices || "All voices",
      callback_data: callbackData(callbacks.all_voices || "latest", issueRef(root)),
    },
  ];
  if (buttonConfig.show_export !== false && config.actions?.memory) {
    bottom.push({ text: labels.export || "Export", callback_data: callbackData("export", issueRef(root)) });
  }
  bottom.push({ text: labels.clarify || "Clarify", callback_data: callbackData("clarify", issueRef(root)) });
  if (labels.details) bottom.push({ text: labels.details, callback_data: callbackData("details", issueRef(root)) });
  rows.push(bottom);
  rows.push(...quickActionRows(root));

  return { inline_keyboard: rows };
}

function hasDisagreement(raw) {
  return /(^|\n)\s*(разногласия|главное напряжение|конфликт|disagreements?|main tension)\s*:/iu.test(String(raw || ""));
}

function finalKeyboard(root, issues, raw) {
  const keyboard = buildKeyboard(root, issues);
  if (!hasDisagreement(raw)) return keyboard;
  const rows = Array.isArray(keyboard.inline_keyboard) ? keyboard.inline_keyboard.map((row) => [...row]) : [];
  const label = buttonConfig.labels?.disagreements || "Разногласия";
  const button = { text: label.slice(0, 32), callback_data: callbackData("disagreements", issueRef(root)) };
  const alreadyPresent = rows.some((row) => row.some((item) => item.callback_data === button.callback_data));
  if (!alreadyPresent) rows.splice(1, 0, [button]);
  return { inline_keyboard: rows };
}

function progressText(root, issues) {
  const voices = childrenOf(root, issues).filter((issue) => !isSynthesis(issue));
  const done = voices.filter(isTerminal);
  const waiting = voices.filter((issue) => !isTerminal(issue));
  const lines = [`Совет работает: ${done.length}/${voices.length} философов готовы.`];
  if (done.length) lines.push(`Готовы: ${done.map(voiceLabel).join(", ")}.`);
  if (waiting.length) lines.push(`Ждем: ${waiting.map(voiceLabel).join(", ")}.`);
  if (!waiting.length && voices.length) lines.push("Все философы ответили. Собираю итог.");
  return lines.join("\n");
}

function progressKeyboard(root) {
  const progress = telegram.progress && typeof telegram.progress === "object" ? telegram.progress : {};
  if (!progress.contract_buttons) return null;
  const ref = issueRef(root);
  return buttonRows(
    [
      { label: "Статус", callback: "last_session", arg: "help" },
      { label: "Показать готовые", callback: "philosophers_ready", arg: ref },
      { label: "Философы", callback: "philosophers", arg: ref },
    ],
    ref,
  );
}

function concreteIssueRef(value) {
  const raw = String(value || "").trim();
  if (!raw || ["help", "home", "latest", "none", "null"].includes(raw.toLowerCase())) return "";
  return raw;
}

function companyHints() {
  const hints = [];
  const configured = Array.isArray(config.company_hints) ? config.company_hints : [];
  for (const item of configured) hints.push(String(item || "").trim());
  if (config.company?.name) hints.push(String(config.company.name).trim());
  if (process.env.INNER_AGORA_COMPANY_NAME) hints.push(process.env.INNER_AGORA_COMPANY_NAME.trim());
  return hints.filter(Boolean);
}

async function resolveCompany() {
  const companies = await api("/companies");
  if (!Array.isArray(companies)) throw new Error("Paperclip /companies did not return a list");
  const wantedId = String(process.env.INNER_AGORA_COMPANY_ID || config.company?.companyId || config.company?.id || "").trim();
  const wantedPrefix = String(config.issue?.default_prefix || "").trim();
  const hints = companyHints().map((item) => item.toLowerCase());

  const byId = wantedId ? companies.find((company) => String(company?.id || "") === wantedId) : null;
  if (byId) return byId;

  const byHint = companies.find((company) => hints.includes(String(company?.name || "").trim().toLowerCase()));
  if (byHint) return byHint;

  const byPrefix = wantedPrefix
    ? companies.find((company) => String(company?.issuePrefix || "").trim() === wantedPrefix)
    : null;
  if (byPrefix) return byPrefix;

  if (companies.length === 1) return companies[0];
  throw new Error("Could not resolve Paperclip company for Telegram payload");
}

async function companyIssueSet() {
  const company = await resolveCompany();
  const issues = await api(`/companies/${company.id}/issues`);
  return { company, issues: Array.isArray(issues) ? issues : [] };
}

function rootIssues(issues) {
  return issues.filter((issue) => !issue.parentId && !issue.hiddenAt).sort(byRecentIssue);
}

async function latestRootTree(issueRefArg = "") {
  const ref = concreteIssueRef(issueRefArg);
  if (ref) return issueTree(ref);
  const { company, issues } = await companyIssueSet();
  const root = rootIssues(issues)[0] || null;
  return { company, issue: root, root, issues };
}

function sessionTopic(root) {
  const title = String(root?.title || "").trim();
  const withoutPrefix = title
    .replace(/^Agora\s+[^:]+:\s*/i, "")
    .replace(/^The Inner Agora\s*:\s*/i, "")
    .trim();
  return withoutPrefix || title || "без темы";
}

function sessionParts(root, issues) {
  const synthesis = [...childrenOf(root, issues)].reverse().find(isSynthesis);
  const voices = childrenOf(root, issues).filter((issue) => issue.id !== synthesis?.id);
  const done = voices.filter(isTerminal);
  const waiting = voices.filter((issue) => !isTerminal(issue));
  return { synthesis, voices, done, waiting };
}

function sessionStatusLine(root, issues) {
  const { voices, waiting } = sessionParts(root, issues);
  if (voices.length) {
    if (!waiting.length) return "все философы готовы";
    return `ждем ${waiting.length} из ${voices.length} философов`;
  }
  const status = String(root?.status || "").toLowerCase();
  if (status === "done") return "итог готов";
  if (status === "cancelled") return "остановлено";
  if (status === "blocked") return "не получилось";
  if (status === "in_progress") return "в работе";
  return status || "неизвестно";
}

function statusWord(root, issues = []) {
  const status = String(root?.status || "").toLowerCase();
  const { synthesis } = root ? sessionParts(root, issues) : { synthesis: null };
  if (synthesis || status === "done") return "итог готов";
  if (status === "cancelled") return "остановлено";
  if (status === "blocked") return "не получилось";
  if (status === "in_progress" || status === "todo") return "в работе";
  return status || "в работе";
}

function lastSessionKeyboard(root) {
  const ref = issueRef(root);
  const callbacks = buttonConfig.callbacks || {};
  const buttons = [
    { label: "Открыть сессию", callback: "latest", arg: ref },
    { label: "Философы", callback: callbacks.all_voices || "latest", arg: ref },
    { label: "Итог", callback: "result", arg: ref },
    { label: "Продолжить", callback: "clarify", arg: ref },
  ];
  if (!isTerminal(root)) buttons.push({ label: "Остановить", callback: "stop_confirm", arg: ref });
  buttons.push({ label: "Назад", callback: "back_home", arg: "help" });
  return buttonRows(buttons, ref);
}

function emptyLastSessionKeyboard() {
  return buttonRows([
    { label: "Новый вопрос", callback: "new_question" },
    { label: "Примеры фраз", callback: "examples" },
    { label: "История", callback: "history" },
    { label: "Назад", callback: "back_home" },
  ]);
}

function finalResultKeyboard() {
  return buttonRows([
    { label: "Новый вопрос", callback: "new_question" },
    { label: "Последняя сессия", callback: "last_session" },
    { label: "История", callback: "history" },
    { label: "Назад", callback: "back_home" },
  ]);
}

function historyKeyboard({ offset = 0, limit = 5, hasMore = false, filter = "", roots = [] } = {}) {
  const rows = [];
  const openButtons = roots
    .map((root, index) => {
      const ref = issueRef(root);
      if (!ref) return null;
      return { text: `${index + 1} ${ref}`.slice(0, 32), callback_data: callbackData("session", ref) };
    })
    .filter(Boolean);
  for (let index = 0; index < openButtons.length; index += 2) rows.push(openButtons.slice(index, index + 2));

  const buttons = [];
  if (hasMore) {
    const nextOffset = String(offset + limit);
    buttons.push({ label: "Показать еще", callback: "history_more", arg: filter ? `${filter}:${nextOffset}` : nextOffset });
  }
  buttons.push(
    { label: "В работе", callback: "history_active" },
    { label: "С итогом", callback: "history_done" },
    { label: "Остановленные", callback: "history_stopped" },
    { label: "Назад", callback: "back_home" },
  );
  return { inline_keyboard: [...rows, ...buttonRows(buttons).inline_keyboard] };
}

function lastSessionText(root, issues) {
  if (!root) {
    return "Сессий пока нет.\nМожно начать новый вопрос или посмотреть примеры.";
  }
  const { synthesis } = sessionParts(root, issues);
  return [
    `Последняя сессия: ${issueRef(root)}`,
    "",
    `Статус: ${sessionStatusLine(root, issues)}`,
    `Тема: ${sessionTopic(root)}`,
    `Коротко: ${synthesis ? "итог готов" : "итог еще не готов"}`,
  ].join("\n");
}

function historyStatusMatches(root, issues, filter) {
  if (!filter) return true;
  const status = String(root?.status || "").toLowerCase();
  if (filter === "active") return status === "todo" || status === "in_progress";
  if (filter === "done") return status === "done" || Boolean(sessionParts(root, issues).synthesis);
  if (filter === "stopped") return status === "cancelled";
  return true;
}

function parseHistoryOptions(args = []) {
  const options = { filter: "", offset: 0 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "");
    if (arg === "--filter") options.filter = String(args[++index] || "").trim();
    else if (arg === "--offset") options.offset = Number(args[++index] || 0) || 0;
    else if (arg === "--page") {
      const raw = String(args[++index] || "");
      const [filter, offset] = raw.includes(":") ? raw.split(":", 2) : ["", raw];
      options.filter = filter || options.filter;
      options.offset = Number(offset || 0) || 0;
    }
  }
  return options;
}

function historyText(issues, options = {}) {
  const limit = Number(telegram.history?.defaultLimit || 5);
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const filter = String(options.filter || "").trim();
  const matchingRoots = rootIssues(issues).filter((root) => historyStatusMatches(root, issues, filter));
  const roots = matchingRoots.slice(offset, offset + limit);
  if (!roots.length) return "История пока пустая.";
  const lines = ["История сессий", ""];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    lines.push(`${index + 1}. ${issueRef(root)} — ${sessionTopic(root)}`);
    lines.push(statusWord(root, issues));
    lines.push("");
  }
  return lines.join("\n").trim();
}

function historyPayload(issues, args = []) {
  const options = parseHistoryOptions(args);
  const limit = Number(telegram.history?.defaultLimit || 5);
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const filter = String(options.filter || "").trim();
  const matchingRoots = rootIssues(issues).filter((root) => historyStatusMatches(root, issues, filter));
  const roots = matchingRoots.slice(offset, offset + limit);
  return telegramPayload(
    historyText(issues, options),
    historyKeyboard({ offset, limit, hasMore: offset + limit < matchingRoots.length, filter, roots }),
  );
}

function philosopherStatus(issue) {
  const status = String(issue?.status || "").toLowerCase();
  if (status === "done") return "готов";
  if (status === "blocked" || status === "cancelled") return "не ответил";
  return "ждет ответ";
}

function philosophersText(root, issues, { readyOnly = false } = {}) {
  if (!root) return "Философы появятся после запуска сессии.";
  const { voices } = sessionParts(root, issues);
  const selected = readyOnly ? voices.filter((issue) => philosopherStatus(issue) === "готов") : voices;
  const lines = ["Философы этой сессии", ""];
  if (!selected.length) {
    lines.push(readyOnly ? "Готовых ответов пока нет." : "В этой сессии пока нет отдельных философских задач.");
    return lines.join("\n");
  }
  for (const voice of selected) lines.push(`${voiceLabel(voice)} — ${philosopherStatus(voice)}`);
  return lines.join("\n");
}

function philosophersKeyboard(root) {
  const ref = root ? issueRef(root) : "help";
  return buttonRows(
    [
      { label: "Готовые", callback: "philosophers_ready", arg: ref },
      { label: "Все", callback: "philosophers", arg: ref },
      { label: "Спросить философа", callback: "ask_one_prompt", arg: ref },
      { label: "Назад", callback: "last_session", arg: "help" },
    ],
    ref,
  );
}

function issueMetadata(issue) {
  const metadata = issue?.metadata && typeof issue.metadata === "object" ? issue.metadata : {};
  return {
    route: metadata.route || metadata.adapter || issue?.adapter || "",
    model: metadata.model || issue?.model || "",
  };
}

function detailsText(root, issues) {
  if (!root) return "Деталей пока нет: сессии еще не запускались.";
  const { route, model } = issueMetadata(root);
  const { voices, synthesis } = sessionParts(root, issues);
  const webBase = (process.env.PAPERCLIP_WEB_BASE || API_BASE.replace(/\/api$/, "")).replace(/\/$/, "");
  const lines = [
    `Детали сессии ${issueRef(root)}`,
    "",
    `Открыть в Paperclip: ${webBase}/issues/${root.id}`,
    "",
    "Технические детали",
    `issue id: ${issueRef(root)}`,
    `status: ${root.status || "unknown"}`,
    `философы: ${voices.length}`,
    `итог: ${synthesis ? issueRef(synthesis) : "еще нет"}`,
  ];
  if (route || model) lines.push(`route/model: ${route || "-"} / ${model || "-"}`);
  if (root.createdAt) lines.push(`created: ${root.createdAt}`);
  if (root.updatedAt) lines.push(`updated: ${root.updatedAt}`);
  return lines.join("\n");
}

function detailsKeyboard(root) {
  const ref = root ? issueRef(root) : "help";
  return buttonRows(
    [
      { label: "Открыть в Paperclip", callback: "open_paperclip", arg: ref },
      { label: "Экспорт", callback: "export", arg: ref },
      { label: "Назад", callback: "last_session", arg: "help" },
    ],
    ref,
  );
}

function stopConfirmText(root) {
  if (!root) return "Сессию для остановки не нашел.";
  return [
    `Остановить совет ${issueRef(root)}?`,
    "",
    "Это уберет сессию из рабочих списков.",
    "Технические детали и следы останутся доступны через детали/логи.",
  ].join("\n");
}

function stopConfirmKeyboard(root) {
  const ref = root ? issueRef(root) : "help";
  return buttonRows(
    [
      { label: "Остановить совет", callback: "stop_cleanup", arg: ref },
      { label: "Назад", callback: "last_session", arg: "help" },
      { label: "Показать детали", callback: "details", arg: ref },
    ],
    ref,
  );
}

function stopCleanupKeyboard(root, { partial = false } = {}) {
  const ref = root ? issueRef(root) : "help";
  if (partial) {
    return buttonRows(
      [
        { label: "Дочистить", callback: "stop_cleanup", arg: ref },
        { label: "Детали", callback: "details", arg: ref },
      ],
      ref,
    );
  }
  return buttonRows(
    [
      { label: "История", callback: "history", arg: "help" },
      { label: "Новый вопрос", callback: "new_question", arg: "help" },
      { label: "Детали", callback: "details", arg: ref },
    ],
    ref,
  );
}

async function stopCleanupPayload(root, issues) {
  if (!root) return telegramPayload("Сессию для остановки не нашел.", finalResultKeyboard());
  const { failures } = await runStopCleanup(root, issues, { api, isTerminal });
  const text = failures.length
    ? "Остановил совет, но убрал не все.\nМожно дочистить."
    : "Остановил совет и убрал его из рабочих сессий.";
  return telegramPayload(text, stopCleanupKeyboard(root, { partial: Boolean(failures.length) }));
}

function decodePossiblyMultilineJsonString(value) {
  const json = `"${String(value || "").replace(/\r?\n/g, "\\n")}"`;
  try {
    return JSON.parse(json);
  } catch {
    return String(value || "")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .trim();
  }
}

function synthesisDiffComment(raw) {
  const text = String(raw || "");
  if (!/review diff|synthesis_final\.json|^\+.*"comment"\s*:/imu.test(text)) return "";
  const added = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  const match =
    added.match(/"comment"\s*:\s*"([\s\S]*?)"\s*,?\s*(?:\n\s*\}|$)/u) ||
    added.match(/"comment"\s*:\s*"([\s\S]*)/u);
  if (!match) return "";
  return decodePossiblyMultilineJsonString(match[1]).trim();
}

function resultSourceText(raw) {
  return synthesisDiffComment(raw) || String(raw || "");
}

function prettyResultLine(line) {
  return String(line || "")
    .replace(/\*\*/g, "")
    .replace(/^\*\s+/, "- ")
    .trimEnd();
}

function cleanedResultLines(raw) {
  const lines = [];
  let skipActionBlock = false;
  for (const line of resultSourceText(raw).split(/\r?\n/)) {
    const trimmed = prettyResultLine(line.trim());
    if (/^Дальше\s*:/iu.test(trimmed)) {
      skipActionBlock = true;
      continue;
    }
    if (skipActionBlock) continue;
    if (/^#\s*Результат\s*:/iu.test(trimmed)) continue;
    if (/^-\s*(status|url|пакет|источник|примечание)\s*:/iu.test(trimmed)) continue;
    if (/^-\s*[^:]+:\s*\/agora\b/iu.test(trimmed)) continue;
    lines.push(trimmed);
  }
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function compactResultText(lines) {
  const compact = [];
  for (const line of lines) {
    if (!line) {
      if (compact.length && compact[compact.length - 1]) compact.push("");
      continue;
    }
    compact.push(line);
  }
  return compact.join("\n").trim();
}

function shortResultText(raw) {
  const lines = cleanedResultLines(raw)
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !/https?:\/\//i.test(line));
  return lines.slice(0, 6).join("\n") || "Итог готов.";
}

function finalItogText(raw) {
  return `Итог готов.\n\nКоротко:\n${shortResultText(raw)}`;
}

function fullItogText(issue, raw) {
  const lines = cleanedResultLines(raw);
  let title = "";
  if (/^(Синтез|Synthesis)\s*:/iu.test(lines[0] || "")) {
    title = String(lines.shift() || "")
      .replace(/^(Синтез|Synthesis)\s*:\s*/iu, "")
      .trim();
    while (lines.length && !lines[0]) lines.shift();
  }
  if (!title && issue?.title) {
    title = String(issue.title || "")
      .replace(/^(Синтез|Synthesis)\s*:\s*/iu, "")
      .trim();
  }
  const body = compactResultText(lines);
  const parts = [`Полный итог: ${issueRef(issue)}`];
  if (title) parts.push("", `Тема: ${title}`);
  parts.push("", body || "Содержательного итога пока нет.");
  return parts.join("\n");
}

function latestReadyItogText(root, raw) {
  return `Последний готовый итог: ${issueRef(root)}\n\nКоротко:\n${shortResultText(raw)}`;
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

function runAgoraJson(args = []) {
  const result = spawnSync("node", [path.join(ROOT, "scripts", "agora.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180 * 1000,
    env: process.env,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status !== 0) throw new Error(output || `agora.mjs ${args.join(" ")} exited ${result.status}`);
  return JSON.parse(result.stdout || "{}");
}

function telegramPayload(text, keyboard, extra = {}) {
  return {
    text: String(text || "").trim() || "OK",
    reply_markup: keyboard || null,
    ...extra,
  };
}

function printPayload(text, keyboard) {
  console.log(JSON.stringify(telegramPayload(text, keyboard), null, 2));
}

function philosopherSearchKeyboard(matches) {
  const buttons = matches.slice(0, 3).map((match) => ({
    label: String(match.name || match.key || "").split("/")[0].trim(),
    callback: "choose_philosopher",
    arg: match.key,
  }));
  buttons.push({ label: "Назад", callback: "ask_one_prompt", arg: "help" });
  return buttonRows(buttons, "help");
}

function philosopherSearchPayload(args = []) {
  const query = args.join(" ").trim();
  if (!query) {
    return telegramPayload(
      "Напиши имя философа или близкое описание.\nЯ покажу до трех подходящих вариантов.",
      buttonRows([{ label: "Назад", callback: "ask_one_prompt", arg: "help" }]),
    );
  }
  const result = runAgoraJson(["philosopher-search", "--json", query]);
  const matches = result.selected ? [result.selected] : Array.isArray(result.matches) ? result.matches.slice(0, 3) : [];
  if (!matches.length) {
    return telegramPayload(
      `Не нашел философа по запросу: ${query}.\nПопробуй написать имя иначе.`,
      buttonRows([{ label: "Назад", callback: "ask_one_prompt", arg: "help" }]),
    );
  }

  const lines = result.selected
    ? [`Нашел философа: ${matches[0].name}.`, "", "Выбери его или попробуй другое имя."]
    : ["Я нашел похожих философов:", "", ...matches.map((match) => match.name)];
  return telegramPayload(lines.join("\n"), philosopherSearchKeyboard(matches));
}

function philosopherChoicePayload(args = []) {
  const key = args.join(" ").trim();
  const result = runAgoraJson(["philosopher-search", "--json", key]);
  const match = result.selected || (Array.isArray(result.matches) ? result.matches[0] : null);
  const name = match?.name || key || "Философ";
  return telegramPayload(
    `${name} выбран.\nТеперь напиши тему обычным текстом.`,
    buttonRows([
      { label: "Поиск", callback: "search_philosopher", arg: "help" },
      { label: "Назад", callback: "ask_one_prompt", arg: "help" },
    ]),
  );
}

let roleCache = null;

function allRoles() {
  if (!roleCache) roleCache = readJson(path.join(ROOT, "data", "philosophers.json"));
  return Array.isArray(roleCache) ? roleCache : [];
}

function roleByKey(key) {
  const wanted = String(key || "").trim();
  return allRoles().find((role) => String(role?.key || "").trim() === wanted) || null;
}

function roleName(key) {
  return roleByKey(key)?.name || key;
}

function philosopherCountWord(count) {
  const absolute = Math.abs(Number(count) || 0);
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "философов";
  if (last >= 2 && last <= 4) return "философа";
  if (last === 1) return "философ";
  return "философов";
}

function parseCustomEditArgs(args = []) {
  const options = {
    operation: String(args[0] || "").trim().toLowerCase(),
    philosophers: [],
    topic: "",
    query: "",
  };
  const rest = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = String(args[index] || "");
    if (arg === "--philosophers") {
      options.philosophers = String(args[++index] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg === "--topic") {
      options.topic = String(args[++index] || "").trim();
    } else if (arg === "--query") {
      options.query = String(args[++index] || "").trim();
    } else {
      rest.push(arg);
    }
  }
  if (!options.topic && rest.length) options.topic = rest.join(" ").trim();
  return options;
}

function customLaunchPending(philosophers, topic) {
  const keys = philosophers.map((item) => String(item || "").trim()).filter(Boolean);
  return {
    type: "launch",
    action: "ask",
    args: `--philosophers ${keys.join(",")} ${topic}`.trim(),
    roles: keys.join(","),
    topic,
  };
}

function customEditKeyboard() {
  return buttonRows(
    [
      { label: "Запустить", callback: "launch_custom", arg: "pending" },
      { label: "Добавить", callback: "add_philosopher", arg: "pending" },
      { label: "Убрать", callback: "remove_philosopher", arg: "pending" },
      { label: "Сделать 2-3", callback: "fast_prompt", arg: "pending" },
      { label: "Сделать 5-6", callback: "deep_prompt", arg: "pending" },
      { label: "Назад", callback: "back_home", arg: "help" },
    ],
    "pending",
  );
}

function deepProposalPayload(args = []) {
  const topic = args.join(" ").trim();
  if (!topic) {
    return telegramPayload(
      "Глубокое исследование.\n\nНапиши вопрос одним сообщением.\nПосле темы я предложу 5-6 философов и спрошу, запускать ли.",
      buttonRows([{ label: "Назад", callback: "new_question", arg: "help" }]),
    );
  }
  const keys = ["plato", "socrates", "nietzsche", "foucault", "aristotle", "heidegger"];
  const reasons = [
    ["plato", "рамка смысла"],
    ["socrates", "уточняющие вопросы"],
    ["nietzsche", "воля и конфликт"],
    ["foucault", "власть и контроль"],
    ["aristotle", "практическая мера"],
    ["heidegger", "глубинная рамка"],
  ];
  const lines = [
    "Вопрос:",
    topic,
    "",
    "Предлагаю глубокий состав: 6 философов.",
    "",
  ];
  for (const [key, reason] of reasons) lines.push(`${roleName(key)} — ${reason}`);
  lines.push("", "Можно запустить так или поменять состав.");
  return telegramPayload(lines.join("\n"), deepProposalKeyboard(), {
    pending_question: {
      type: "launch",
      action: "ask",
      args: topic,
      roles: keys.join(","),
      topic,
    },
  });
}

function deepProposalKeyboard() {
  return buttonRows(
    [
      { label: "Запустить", callback: "launch_deep", arg: "pending" },
      { label: "Поменять философов", callback: "choose_philosophers_prompt", arg: "pending" },
      { label: "Сделать быстро", callback: "fast_prompt", arg: "pending" },
      { label: "Назад", callback: "back_home", arg: "help" },
    ],
    "pending",
  );
}

function currentCompositionLines(philosophers) {
  return philosophers.map((key) => roleName(key)).filter(Boolean);
}

function customEditPromptPayload(args = []) {
  const options = parseCustomEditArgs(args);
  if (!["add", "remove"].includes(options.operation) || !options.philosophers.length || !options.topic) {
    return telegramPayload(
      "Сначала выбери тему и состав философов.\nПотом можно добавить или убрать философа.",
      buttonRows([{ label: "Новый вопрос", callback: "new_question", arg: "help" }]),
    );
  }
  const title = options.operation === "remove" ? "Кого убрать?" : "Кого добавить?";
  const lines = [title, "Напиши имя философа обычным текстом.", "", "Текущий состав:", ...currentCompositionLines(options.philosophers)];
  return telegramPayload(lines.join("\n"), buttonRows([{ label: "Отмена", callback: "cancel_pending", arg: "help" }]), {
    pending_question: {
      type: "custom_edit",
      operation: options.operation,
      roles: options.philosophers.join(","),
      topic: options.topic,
    },
  });
}

function findRoleForEdit(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const byKey = roleByKey(raw);
  if (byKey) return byKey;
  const result = runAgoraJson(["philosopher-search", "--json", raw]);
  const match = result.selected || (Array.isArray(result.matches) ? result.matches[0] : null);
  return match?.key ? roleByKey(match.key) || match : null;
}

function customEditPayload(args = []) {
  const options = parseCustomEditArgs(args);
  if (!["add", "remove"].includes(options.operation) || !options.philosophers.length || !options.topic) {
    return customEditPromptPayload(args);
  }
  if (!options.query) return customEditPromptPayload(args);

  const match = findRoleForEdit(options.query);
  if (!match?.key) {
    return telegramPayload(
      `Не нашел философа по запросу: ${options.query}.\nНапиши имя иначе.`,
      buttonRows([{ label: "Отмена", callback: "cancel_pending", arg: "help" }]),
      {
        pending_question: {
          type: "custom_edit",
          operation: options.operation,
          roles: options.philosophers.join(","),
          topic: options.topic,
        },
      },
    );
  }

  let next = [...options.philosophers];
  if (options.operation === "add" && !next.includes(match.key)) next.push(match.key);
  if (options.operation === "remove") next = next.filter((key) => key !== match.key);
  if (!next.length) next = options.philosophers;

  const lines = [`Обновил состав: ${next.length} ${philosopherCountWord(next.length)}`, ""];
  for (const key of next) lines.push(roleName(key));
  lines.push("", "Можно запустить так или изменить состав еще раз.");
  return telegramPayload(lines.join("\n"), customEditKeyboard(), {
    pending_question: customLaunchPending(next, options.topic),
  });
}

function customProposalPayload(args = []) {
  const topic = args.join(" ").trim();
  if (!topic) {
    return telegramPayload(
      "Напиши тему.\nПотом я покажу точный состав и попрошу подтвердить запуск.",
      buttonRows([{ label: "Назад", callback: "new_question", arg: "help" }]),
    );
  }
  const proposal = runAgoraJson(["role-proposal", "--json", "--limit", "4", "--no-architects", topic]);
  const roles = Array.isArray(proposal.roles) ? proposal.roles.slice(0, 4) : [];
  const lines = ["Вопрос:", topic, "", `По этой теме я бы собрал ${roles.length} философов:`, ""];
  for (const role of roles) lines.push(`${role.name} — ${role.reason}`);
  lines.push("", "Можно изменить состав.");
  const keys = roles.map((role) => role.key).filter(Boolean).join(",");
  return telegramPayload(
    lines.join("\n"),
    customEditKeyboard(),
    { pending_question: customLaunchPending(keys.split(",").filter(Boolean), topic) },
  );
}

function qaArtifactsDir() {
  const qa = telegram.qa && typeof telegram.qa === "object" ? telegram.qa : {};
  const rootQa = config.qa && typeof config.qa === "object" ? config.qa : {};
  return resolveQaArtifactsDir({ telegramQa: qa, rootQa, cwd: config.cwd || ROOT });
}

function latestQaRun() {
  return findLatestQaRun(qaArtifactsDir());
}

function qaKeyboard() {
  return buttonRows([
    { label: "Упавшие проверки", callback: "qa_failures", arg: "help" },
    { label: "Последний QA отчет", callback: "qa_report", arg: "help" },
    { label: "Cleanup", callback: "qa_cleanup", arg: "help" },
    { label: "Назад", callback: "status_help", arg: "help" },
  ]);
}

function noQaPayload() {
  return telegramPayload(
    "QA-артефактов пока не нашел.\nLive QA отсюда не запускается.",
    buttonRows([{ label: "Назад", callback: "status_help", arg: "help" }]),
  );
}

function qaStatusPayload() {
  const run = latestQaRun();
  if (!run) return noQaPayload();
  const counts = qaCounts(run.manifest);
  const bugs = qaBugs(run);
  const suite = run.manifest?.suite || run.manifest?.runId || path.basename(run.dir);
  const lines = [
    `Последний QA: ${suite}`,
    `Статус: ${qaStatusWord(counts, bugs)}`,
    `Проверки: ${counts.passed}/${counts.total}`,
    `Баги: ${bugs.length}`,
    `Cleanup: ${qaCleanupWord(run.manifest)}`,
  ];
  return telegramPayload(lines.join("\n"), qaKeyboard());
}

function qaFailuresPayload() {
  const run = latestQaRun();
  if (!run) return noQaPayload();
  const { tests } = qaCounts(run.manifest);
  const bugs = qaBugs(run);
  const failed = tests.filter((test) => /^(fail|failed|error|blocked|timed_out|timeout)$/i.test(String(test?.status || "")));
  const lines = ["Упавшие проверки", ""];
  if (!failed.length && !bugs.length) lines.push("Падений в последнем QA не найдено.");
  for (const test of failed.slice(0, 8)) {
    const name = test.id || test.name || test.title || "unknown";
    const error = test.error || test.message || test.reason || "";
    lines.push(`- ${name}${error ? `: ${error}` : ""}`);
  }
  if (bugs.length) {
    lines.push("", "Баги:");
    for (const bug of bugs.slice(0, 8)) lines.push(`- ${bug.id ? `${bug.id}: ` : ""}${bug.title || bug.message || "bug"}`);
  }
  return telegramPayload(lines.join("\n"), qaKeyboard());
}

function qaReportPayload() {
  const run = latestQaRun();
  if (!run) return noQaPayload();
  const reportPath = path.join(run.dir, "REPORT.md");
  const text = fs.existsSync(reportPath)
    ? fs.readFileSync(reportPath, "utf8")
    : `QA отчет ${run.manifest?.runId || path.basename(run.dir)} без REPORT.md.`;
  const body = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 18)
    .join("\n");
  return telegramPayload(body || "QA отчет пустой.", qaKeyboard());
}

function qaCleanupPayload() {
  const run = latestQaRun();
  if (!run) return noQaPayload();
  const cleanup = run.manifest?.cleanup;
  const lines = [`Cleanup статус: ${qaCleanupWord(run.manifest)}`];
  if (cleanup?.mode) lines.push(`Режим: ${cleanup.mode}`);
  const residuals = Array.isArray(cleanup?.residuals) ? cleanup.residuals : [];
  if (residuals.length) {
    lines.push("", "Остатки:");
    for (const item of residuals.slice(0, 8)) lines.push(`- ${item.id || item.name || item.path || String(item)}`);
  } else {
    lines.push("Остатков в последнем manifest не найдено.");
  }
  return telegramPayload(lines.join("\n"), qaKeyboard());
}

async function sendText(chatId, text, keyboard, dryRun) {
  await sendTelegramText({ chatId, text, keyboard, dryRun, telegramChat, telegramApi });
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

  if (command === "payload-last-session") {
    const { root, issues } = await latestRootTree(issueRefArg);
    printPayload(lastSessionText(root, issues), root ? lastSessionKeyboard(root) : emptyLastSessionKeyboard());
    return;
  }

  if (command === "payload-history") {
    const { issues } = await companyIssueSet();
    const payload = historyPayload(issues, rest);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === "payload-philosophers") {
    const readyOnly = rest.includes("--ready");
    const ref = rest.find((item) => item !== "--ready") || "";
    const { root, issues } = await latestRootTree(ref);
    printPayload(philosophersText(root, issues, { readyOnly }), philosophersKeyboard(root));
    return;
  }

  if (command === "payload-philosopher-search") {
    console.log(JSON.stringify(philosopherSearchPayload(rest), null, 2));
    return;
  }

  if (command === "payload-philosopher-choice") {
    console.log(JSON.stringify(philosopherChoicePayload(rest), null, 2));
    return;
  }

  if (command === "payload-deep-proposal") {
    console.log(JSON.stringify(deepProposalPayload(rest), null, 2));
    return;
  }

  if (command === "payload-custom-proposal") {
    console.log(JSON.stringify(customProposalPayload(rest), null, 2));
    return;
  }

  if (command === "payload-custom-edit-prompt") {
    console.log(JSON.stringify(customEditPromptPayload(rest), null, 2));
    return;
  }

  if (command === "payload-custom-edit") {
    console.log(JSON.stringify(customEditPayload(rest), null, 2));
    return;
  }

  if (command === "payload-qa-status") {
    console.log(JSON.stringify(qaStatusPayload(), null, 2));
    return;
  }

  if (command === "payload-qa-report") {
    console.log(JSON.stringify(qaReportPayload(), null, 2));
    return;
  }

  if (command === "payload-qa-failures") {
    console.log(JSON.stringify(qaFailuresPayload(), null, 2));
    return;
  }

  if (command === "payload-qa-cleanup") {
    console.log(JSON.stringify(qaCleanupPayload(), null, 2));
    return;
  }

  if (command === "payload-details") {
    const { root, issues } = await latestRootTree(issueRefArg);
    printPayload(detailsText(root, issues), detailsKeyboard(root));
    return;
  }

  if (command === "payload-stop-confirm") {
    const { root } = await latestRootTree(issueRefArg);
    printPayload(stopConfirmText(root), stopConfirmKeyboard(root));
    return;
  }

  if (command === "payload-stop-cleanup") {
    const { root, issues } = await latestRootTree(issueRefArg);
    console.log(JSON.stringify(await stopCleanupPayload(root, issues), null, 2));
    return;
  }

  if (command === "payload-final-result") {
    const ref = concreteIssueRef(issueRefArg);
    const tree = ref ? await issueTree(ref) : await latestRootTree("");
    const roots = tree.root ? [tree.root] : rootIssues(tree.issues);
    const root = roots.find((candidate) => sessionParts(candidate, tree.issues).synthesis) || null;
    if (!root) {
      printPayload("Готового итога пока нет.", finalResultKeyboard());
      return;
    }
    const { synthesis } = sessionParts(root, tree.issues);
    const raw = synthesis ? runAction("result", [issueRef(synthesis)]) : "";
    printPayload(latestReadyItogText(root, raw), finalKeyboard(root, tree.issues, raw));
    return;
  }

  if (!issueRefArg) usage(1);

  const { issue, root, issues } = await issueTree(issueRefArg);
  const keyboard = buildKeyboard(root, issues);

  if (command === "keyboard") {
    console.log(JSON.stringify(keyboard, null, 2));
    return;
  }

  if (command === "payload-result") {
    const synthesis = [...childrenOf(root, issues)].reverse().find(isSynthesis);
    const target = synthesis || issue;
    const text = runAction("result", [issueRef(target), "--full"]);
    printPayload(fullItogText(target, text), finalKeyboard(root, issues, text));
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

  if (command === "payload-progress") {
    printPayload(progressText(root, issues), progressKeyboard(root) || keyboard);
    return;
  }

  if (command === "send-result") {
    const synthesis = [...childrenOf(root, issues)].reverse().find(isSynthesis);
    const raw = runAction("result", [issueRef(synthesis || root)]);
    await sendText(options.chatId, finalItogText(raw), finalKeyboard(root, issues, raw), options.dryRun);
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

  if (command === "send-progress") {
    await sendText(options.chatId, progressText(root, issues), progressKeyboard(root) || keyboard, options.dryRun);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
