#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = process.env.PAPERCLIP_COCKPIT_CONFIG || path.join(ROOT, "paperclip-cockpit.json");
const API_BASE = (process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api").replace(/\/$/, "");
const DEFAULT_PHRASE = "давай спросим агору про свободу ребенка и власть родителей";

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/agora-telegram-live-check.mjs snapshot [--json]
  node scripts/agora-telegram-live-check.mjs wait [--phrase TEXT] [--timeout SECONDS] [--interval SECONDS] [--expect-voices N] [--json]

This does not call Telegram getUpdates. It watches Paperclip for the root issue
that should appear after a real human sends the phrase to the bot.
`);
  process.exit(exitCode);
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const config = readJson(CONFIG_PATH);
const monitorConfig = config.monitor && typeof config.monitor === "object" ? config.monitor : {};
const telegramConfig = config.telegram && typeof config.telegram === "object" ? config.telegram : {};

async function api(pathname) {
  const response = await fetch(`${API_BASE}${pathname}`);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${pathname} failed: ${response.status} ${text}`);
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

function byIssueNumberDesc(left, right) {
  const delta = issueNumber(right) - issueNumber(left);
  if (delta) return delta;
  return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
}

function isVisible(issue) {
  return Boolean(issue && !issue.hiddenAt && !issue.deletedAt);
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function companyHints() {
  return [
    ...(Array.isArray(config.company_hints) ? config.company_hints : []),
    process.env.PAPERCLIP_DEFAULT_COMPANY || "",
    process.env.PAPERCLIP_COMPANY_NAME || "",
  ]
    .map(normalized)
    .filter(Boolean);
}

function companyMatches(company) {
  const hints = companyHints();
  if (!hints.length) return true;
  const name = normalized(company?.name);
  const prefix = normalized(company?.issuePrefix);
  return hints.some((hint) => name.includes(hint) || hint.includes(name) || hint === prefix);
}

function childrenOf(root, issues) {
  return issues.filter((issue) => isVisible(issue) && issue.parentId === root.id).sort((a, b) => issueNumber(a) - issueNumber(b));
}

function isSynthesis(issue) {
  const pattern = monitorConfig.synthesis_title_pattern || telegramConfig.synthesis_title_pattern || "^Синтез:|^Synthesis:";
  return new RegExp(pattern, "i").test(String(issue?.title || ""));
}

function rootQuestion(root) {
  const body = String(root?.description || "");
  const match = body.match(/Исходный вопрос:\s*\n([\s\S]*?)(?:\n\n|$)/);
  return String(match?.[1] || root?.title || "").replace(/\s+/g, " ").trim();
}

async function scan() {
  const companies = (await api("/companies")).filter(companyMatches);
  const scans = [];
  for (const company of companies) {
    const issues = await api(`/companies/${company.id}/issues`);
    const roots = issues.filter((issue) => isVisible(issue) && !issue.parentId).sort(byIssueNumberDesc);
    scans.push({ company, issues, roots });
  }
  return scans;
}

function summarizeRoot(root, issues, options = {}) {
  const children = childrenOf(root, issues);
  const synthesis = children.filter(isSynthesis).sort((a, b) => issueNumber(b) - issueNumber(a))[0] || null;
  const voices = children.filter((issue) => issue.id !== synthesis?.id && !isSynthesis(issue));
  const expectedVoices = Number(options.expectVoices || 0);
  const enoughVoices = expectedVoices ? voices.length >= expectedVoices : voices.length > 0;
  return {
    ok: enoughVoices,
    root: {
      id: root.id,
      ref: issueRef(root),
      title: root.title || "",
      status: root.status || "",
      createdAt: root.createdAt || "",
      question: rootQuestion(root),
    },
    voices: voices.map((issue) => ({
      ref: issueRef(issue),
      title: issue.title || "",
      status: issue.status || "",
    })),
    synthesis: synthesis
      ? {
          ref: issueRef(synthesis),
          title: synthesis.title || "",
          status: synthesis.status || "",
        }
      : null,
  };
}

function parseArgs(args) {
  const options = {
    json: false,
    phrase: DEFAULT_PHRASE,
    timeout: 300,
    interval: 5,
    expectVoices: 1,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--phrase") options.phrase = args[++index] || "";
    else if (arg === "--timeout") options.timeout = Number(args[++index] || options.timeout);
    else if (arg === "--interval") options.interval = Number(args[++index] || options.interval);
    else if (arg === "--expect-voices") options.expectVoices = Number(args[++index] || options.expectVoices);
    else if (arg === "--help" || arg === "-h") usage(0);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.timeout = Math.max(1, options.timeout);
  options.interval = Math.max(0.1, options.interval);
  options.expectVoices = Math.max(0, options.expectVoices);
  return options;
}

async function snapshot(options) {
  const scans = await scan();
  const roots = scans.flatMap(({ company, issues, roots: rootItems }) =>
    rootItems.slice(0, 10).map((root) => ({
      company: company.name,
      ...summarizeRoot(root, issues, options),
    })),
  );
  const summary = { ok: true, apiBase: API_BASE, roots };
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log("Recent Paperclip roots:");
    for (const item of roots) {
      console.log(`- ${item.root.ref} ${item.root.status} voices=${item.voices.length} ${item.root.title}`);
    }
  }
  return summary;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTelegramRoot(options) {
  const startedAt = Date.now();
  const baselineScans = await scan();
  const baselineRefs = new Set(baselineScans.flatMap(({ roots }) => roots.map((root) => issueRef(root) || root.id)));

  if (!options.json) {
    console.log("Send this ordinary Telegram message to the bot:");
    console.log(options.phrase);
    console.log("");
    console.log("Waiting for the new Paperclip session...");
  }

  let lastRoots = [];
  while (Date.now() - startedAt <= options.timeout * 1000) {
    const scans = await scan();
    for (const { company, issues, roots } of scans) {
      lastRoots = roots;
      const match = roots.find((root) => {
        const ref = issueRef(root) || root.id;
        if (baselineRefs.has(ref)) return false;
        const created = Date.parse(root.createdAt || "");
        const recent = !Number.isFinite(created) || created >= startedAt - 10_000;
        const question = rootQuestion(root);
        const phraseTail = options.phrase.replace(/^давай\s+спросим\s+агору\s+про\s+/i, "").trim();
        const phraseMatches = !phraseTail || question.toLowerCase().includes(phraseTail.toLowerCase());
        return recent && phraseMatches;
      });
      if (match) {
        const result = {
          ok: true,
          apiBase: API_BASE,
          company: company.name,
          phrase: options.phrase,
          ...summarizeRoot(match, issues, options),
        };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else {
          console.log(`Detected: ${result.root.ref}`);
          console.log(`- status: ${result.root.status}`);
          console.log(`- voices: ${result.voices.length}`);
          console.log(`- synthesis: ${result.synthesis ? `${result.synthesis.ref} ${result.synthesis.status}` : "not yet"}`);
          if (!result.ok) {
            console.log(`- warning: expected at least ${options.expectVoices} voice task(s)`);
          }
        }
        return result;
      }
    }
    await sleep(options.interval * 1000);
  }

  const result = {
    ok: false,
    apiBase: API_BASE,
    phrase: options.phrase,
    timeoutSeconds: options.timeout,
    lastRootRefs: lastRoots.slice(0, 5).map(issueRef),
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`No new matching Paperclip session detected within ${options.timeout}s.`);
    if (result.lastRootRefs.length) console.log(`Recent roots: ${result.lastRootRefs.join(", ")}`);
  }
  process.exitCode = 1;
  return result;
}

const [command = "snapshot", ...tail] = process.argv.slice(2);
if (command === "--help" || command === "-h") usage(0);
const options = parseArgs(tail);

if (command === "snapshot") {
  await snapshot(options);
} else if (command === "wait") {
  await waitForTelegramRoot(options);
} else {
  usage(1);
}
