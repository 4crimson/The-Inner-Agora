#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CHAMBERS_DIR = path.join(ROOT, "chambers");

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/chamber-loader.mjs list [--json] [--chambers-dir DIR]
  node scripts/chamber-loader.mjs validate [--chambers-dir DIR]
  node scripts/chamber-loader.mjs show <id> [--json] [--chambers-dir DIR]
  node scripts/chamber-loader.mjs cockpit <id> [--json] [--write FILE] [--chambers-dir DIR]
  node scripts/chamber-loader.mjs merge-fixture [--json]
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...tail] = argv;
  if (!command || command === "--help" || command === "-h") usage(command ? 0 : 1);

  const options = {
    command,
    id: "",
    json: false,
    chambersDir: DEFAULT_CHAMBERS_DIR,
    writePath: "",
  };

  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--chambers-dir") {
      options.chambersDir = path.resolve(String(tail[++index] || ""));
      if (!options.chambersDir) throw new Error("--chambers-dir requires a path");
    } else if (arg === "--write") {
      options.writePath = path.resolve(String(tail[++index] || ""));
      if (!options.writePath) throw new Error("--write requires a path");
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else if (!options.id && !arg.startsWith("-")) {
      options.id = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function deepMerge(base, override) {
  if (override === undefined) return clone(base);
  if (Array.isArray(base) || Array.isArray(override)) return clone(override);
  if (isPlainObject(base) && isPlainObject(override)) {
    const next = { ...base };
    for (const [key, value] of Object.entries(override)) {
      next[key] = key in next ? deepMerge(next[key], value) : clone(value);
    }
    return next;
  }
  return clone(override);
}

function requireField(object, field, context) {
  if (!(field in object)) throw new Error(`${context}: missing required field ${field}`);
}

function requireString(object, field, context) {
  requireField(object, field, context);
  if (typeof object[field] !== "string" || !object[field].trim()) {
    throw new Error(`${context}: field ${field} must be a non-empty string`);
  }
}

function requireArray(object, field, context) {
  requireField(object, field, context);
  if (!Array.isArray(object[field])) throw new Error(`${context}: field ${field} must be an array`);
}

export function validateChamberManifest(chamber, context = "chamber.json") {
  if (!isPlainObject(chamber)) throw new Error(`${context}: manifest must be an object`);

  for (const field of [
    "id",
    "name",
    "description",
    "status",
    "labels",
    "roles",
    "presets",
    "synthesisRole",
    "transparencyPolicy",
    "allowedSkills",
    "company",
  ]) {
    requireField(chamber, field, context);
  }

  requireString(chamber, "id", context);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(chamber.id)) throw new Error(`${context}: field id has invalid format`);
  requireString(chamber, "name", context);
  requireString(chamber, "description", context);
  if (!["active", "draft", "disabled"].includes(chamber.status)) {
    throw new Error(`${context}: field status must be active, draft, or disabled`);
  }

  if (!isPlainObject(chamber.labels)) throw new Error(`${context}: field labels must be an object`);
  for (const field of ["company", "companies", "agent", "agents", "task", "tasks"]) {
    requireString(chamber.labels, field, `${context}.labels`);
  }

  requireArray(chamber, "roles", context);
  if (!chamber.roles.length) throw new Error(`${context}: field roles must not be empty`);
  requireArray(chamber, "presets", context);
  requireString(chamber, "synthesisRole", context);
  requireString(chamber, "transparencyPolicy", context);
  requireArray(chamber, "allowedSkills", context);

  if (!isPlainObject(chamber.company)) throw new Error(`${context}: field company must be an object`);
  for (const field of ["name", "projectName", "goalTitle", "companyId"]) {
    requireField(chamber.company, field, `${context}.company`);
  }
  for (const field of ["name", "projectName", "goalTitle"]) {
    requireString(chamber.company, field, `${context}.company`);
  }
  if (chamber.company.companyId !== null && typeof chamber.company.companyId !== "string") {
    throw new Error(`${context}.company: field companyId must be string or null`);
  }

  return chamber;
}

function chamberManifestPath(chambersDir, id) {
  return path.join(chambersDir, id, "chamber.json");
}

export function loadChamber(chambersDir, id) {
  const filePath = chamberManifestPath(chambersDir, id);
  return validateChamberManifest(readJson(filePath), path.relative(ROOT, filePath));
}

export function loadCockpitConfig(chambersDir, id) {
  loadChamber(chambersDir, id);
  const corePath = path.join(ROOT, "cockpit.core.json");
  const overridePath = path.join(chambersDir, id, "cockpit.overrides.json");
  const core = readJson(corePath);
  const override = fs.existsSync(overridePath) ? readJson(overridePath) : {};
  return deepMerge(core, override);
}

export function listChambers(chambersDir = DEFAULT_CHAMBERS_DIR) {
  if (!fs.existsSync(chambersDir)) return [];
  return fs
    .readdirSync(chambersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(chamberManifestPath(chambersDir, id)))
    .map((id) => loadChamber(chambersDir, id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function printChambers(chambers, json) {
  if (json) {
    console.log(JSON.stringify({ chambers: chambers.map(({ id, name, status }) => ({ id, name, status })) }, null, 2));
    return;
  }
  for (const chamber of chambers) console.log(`${chamber.id}\t${chamber.status}\t${chamber.name}`);
}

function mergeFixture(json) {
  const base = {
    allowedSkills: ["web-research", "memory-export"],
    labels: {
      agent: "philosopher",
      agents: "philosophers",
      task: "session",
      tasks: "sessions",
    },
  };
  const override = {
    allowedSkills: ["source-citation"],
    labels: {
      agent: "director",
    },
  };
  const merged = deepMerge(base, override);
  if (json) console.log(JSON.stringify(merged, null, 2));
  else console.log(merged);
}

function printOrWriteConfig(config, options) {
  if (options.writePath) {
    fs.writeFileSync(options.writePath, stableJson(config), "utf8");
    console.log(`wrote ${path.relative(ROOT, options.writePath)}`);
    return;
  }
  if (options.json) console.log(stableJson(config).trimEnd());
  else console.log(JSON.stringify(config));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "list") return printChambers(listChambers(options.chambersDir), options.json);
  if (options.command === "validate") {
    const chambers = listChambers(options.chambersDir);
    console.log(`validated ${chambers.length} chamber(s)`);
    return;
  }
  if (options.command === "show") {
    if (!options.id) throw new Error("show requires chamber id");
    const chamber = loadChamber(options.chambersDir, options.id);
    if (options.json) console.log(JSON.stringify(chamber, null, 2));
    else console.log(`${chamber.id}\t${chamber.status}\t${chamber.name}`);
    return;
  }
  if (options.command === "cockpit") {
    if (!options.id) throw new Error("cockpit requires chamber id");
    return printOrWriteConfig(loadCockpitConfig(options.chambersDir, options.id), options);
  }
  if (options.command === "merge-fixture") return mergeFixture(options.json);
  usage(1);
}

main();
