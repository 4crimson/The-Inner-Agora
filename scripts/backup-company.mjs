#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadChamber } from "./chamber-loader.mjs";
import { createPaperclipClient } from "./agora/paperclip-client.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_API_BASE = process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100/api";
const DEFAULT_CHAMBERS_DIR = process.env.INNER_AGORA_CHAMBERS_DIR
  ? path.resolve(process.env.INNER_AGORA_CHAMBERS_DIR)
  : path.join(ROOT, "chambers");
const DEFAULT_CHAMBER_ID = process.env.INNER_AGORA_ACTIVE_CHAMBER || process.env.INNER_AGORA_DEFAULT_CHAMBER || "philosophy";

function usage(exitCode = 0) {
  const text = `Usage:
  node scripts/backup-company.mjs [--company-id ID|--company NAME] [--api-base URL] [--out DIR] [--timestamp ISO] [--json]

Creates a read-only Paperclip backup JSON with company org, agents, issues, and issue comments.`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(args = []) {
  const options = {
    apiBase: DEFAULT_API_BASE,
    outDir: path.join(ROOT, "backups"),
    timestamp: new Date().toISOString(),
    json: false,
    companyId: "",
    companyName: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--api-base") {
      options.apiBase = args[++index] || "";
    } else if (arg.startsWith("--api-base=")) {
      options.apiBase = arg.slice("--api-base=".length);
    } else if (arg === "--out") {
      options.outDir = args[++index] || "";
    } else if (arg.startsWith("--out=")) {
      options.outDir = arg.slice("--out=".length);
    } else if (arg === "--timestamp") {
      options.timestamp = args[++index] || "";
    } else if (arg.startsWith("--timestamp=")) {
      options.timestamp = arg.slice("--timestamp=".length);
    } else if (arg === "--company-id") {
      options.companyId = args[++index] || "";
    } else if (arg.startsWith("--company-id=")) {
      options.companyId = arg.slice("--company-id=".length);
    } else if (arg === "--company") {
      options.companyName = args[++index] || "";
    } else if (arg.startsWith("--company=")) {
      options.companyName = arg.slice("--company=".length);
    } else {
      throw new Error(`Unknown backup option: ${arg}`);
    }
  }
  if (!String(options.apiBase || "").trim()) throw new Error("--api-base must not be empty");
  if (!String(options.outDir || "").trim()) throw new Error("--out must not be empty");
  if (!String(options.timestamp || "").trim()) throw new Error("--timestamp must not be empty");
  return options;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function slugify(value, fallback = "company") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || fallback;
}

function safeTimestamp(value) {
  return String(value || "")
    .replace(/[:.]/g, "-")
    .replace(/[^\p{L}\p{N}TZ_+-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultCompanyConfig() {
  const chamber = loadChamber(DEFAULT_CHAMBERS_DIR, DEFAULT_CHAMBER_ID);
  const company = chamber.company || {};
  return {
    chamberId: chamber.id,
    chamberName: chamber.name,
    companyId: String(process.env.INNER_AGORA_COMPANY_ID || company.companyId || "").trim(),
    companyName: String(process.env.INNER_AGORA_COMPANY_NAME || company.name || "The Inner Agora").trim(),
  };
}

function selectCompany(companies, options, defaults) {
  const companyId = String(options.companyId || defaults.companyId || "").trim();
  const companyName = String(options.companyName || defaults.companyName || "").trim();
  const active = (companies || []).filter((item) => item?.status !== "archived");
  if (companyId) return active.find((item) => item.id === companyId) || null;
  if (companyName) return active.find((item) => item.name === companyName) || null;
  if (active.length === 1) return active[0];
  return null;
}

async function collectBackup(options) {
  const defaults = defaultCompanyConfig();
  const client = createPaperclipClient({
    apiBase: options.apiBase,
    root: ROOT,
    shouldAutoRestart: () => false,
  });
  const companies = await client.api("/companies");
  const company = selectCompany(companies, options, defaults);
  if (!company) {
    const wanted = options.companyId || options.companyName || defaults.companyId || defaults.companyName || "company";
    throw new Error(`Company not found: ${wanted}`);
  }

  const [org, agents, issues] = await Promise.all([
    client.api(`/companies/${encodeURIComponent(company.id)}/org`),
    client.api(`/companies/${encodeURIComponent(company.id)}/agents`),
    client.api(`/companies/${encodeURIComponent(company.id)}/issues`),
  ]);

  const commentsByIssueId = {};
  for (const issue of Array.isArray(issues) ? issues : []) {
    const issueId = String(issue?.id || "").trim();
    if (!issueId) continue;
    commentsByIssueId[issueId] = await client.api(`/issues/${encodeURIComponent(issueId)}/comments`);
  }

  const commentCount = Object.values(commentsByIssueId).reduce(
    (count, comments) => count + (Array.isArray(comments) ? comments.length : 0),
    0,
  );
  return {
    manifest: {
      schemaVersion: 1,
      createdAt: options.timestamp,
      apiBase: options.apiBase,
      chamberId: defaults.chamberId,
      chamberName: defaults.chamberName,
      companyId: company.id,
      companyName: company.name,
      counts: {
        agents: Array.isArray(agents) ? agents.length : 0,
        issues: Array.isArray(issues) ? issues.length : 0,
        comments: commentCount,
      },
    },
    company,
    org,
    agents,
    issues,
    commentsByIssueId,
  };
}

async function writeBackup(backup, options) {
  const dir = path.resolve(
    options.outDir,
    `${safeTimestamp(options.timestamp)}-${slugify(backup.manifest.companyName || backup.manifest.companyId)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  const backupPath = path.join(dir, "backup.json");
  await fs.writeFile(backupPath, stableJson(backup), "utf8");
  return backupPath;
}

export async function backupCompany(options) {
  const backup = await collectBackup(options);
  const backupPath = await writeBackup(backup, options);
  return {
    backupPath,
    companyId: backup.manifest.companyId,
    companyName: backup.manifest.companyName,
    counts: backup.manifest.counts,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await backupCompany(options);
  if (options.json) {
    console.log(stableJson(result));
  } else {
    console.log(`Backup written: ${result.backupPath}`);
    console.log(`Company: ${result.companyName} (${result.companyId})`);
    console.log(
      `Captured: ${result.counts.agents} agents, ${result.counts.issues} issues, ${result.counts.comments} comments`,
    );
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}
