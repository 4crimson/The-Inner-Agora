#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FRAGMENTS_DIR = path.join(ROOT, "config", "cockpit");
const DEFAULT_RUNTIME_CONFIG = path.join(ROOT, "paperclip-cockpit.json");
const FRAGMENT_FILES = [
  "00-runtime-core.json",
  "10-telegram-core.json",
  "11-telegram-command-boundary.json",
  "12-telegram-mode-selector.json",
  "13-telegram-callbacks.json",
  "20-project-runtime.json",
  "30-presentation.json",
  "40-intents.json",
  "50-actions.json",
];

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/build-cockpit-config.mjs --check [--json] [--fragments-dir DIR] [--config FILE]
  node scripts/build-cockpit-config.mjs --print [--fragments-dir DIR]
  node scripts/build-cockpit-config.mjs --write [--fragments-dir DIR] [--config FILE]

Builds the runtime Paperclip Cockpit config from local source fragments. The
default --check mode compares generated output with paperclip-cockpit.json
without writing or calling Telegram/Paperclip/Hermes.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    mode: "",
    json: false,
    fragmentsDir: DEFAULT_FRAGMENTS_DIR,
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check" || arg === "--print" || arg === "--write") {
      if (options.mode) throw new Error("Choose only one of --check, --print, or --write");
      options.mode = arg.slice(2);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--fragments-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--fragments-dir requires a directory path");
      options.fragmentsDir = path.resolve(value);
    } else if (arg === "--config") {
      const value = argv[++index];
      if (!value) throw new Error("--config requires a file path");
      options.runtimeConfig = path.resolve(value);
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.mode) usage(1);
  if (options.mode !== "check" && options.json) throw new Error("--json is only supported with --check");
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

export function buildCockpitConfig(fragmentsDir = DEFAULT_FRAGMENTS_DIR) {
  let config = {};
  const fragments = [];

  for (const fragment of FRAGMENT_FILES) {
    const filePath = path.join(fragmentsDir, fragment);
    const partial = readJson(filePath);
    config = deepMerge(config, partial);
    fragments.push(path.relative(ROOT, filePath));
  }

  return { config, fragments };
}

function check(options) {
  const { config, fragments } = buildCockpitConfig(options.fragmentsDir);
  const generated = stableJson(config);
  const runtime = fs.readFileSync(options.runtimeConfig, "utf8");
  const ok = generated === runtime;
  const payload = {
    ok,
    fragmentsDir: path.relative(ROOT, options.fragmentsDir) || path.basename(options.fragmentsDir),
    runtimeConfig: path.relative(ROOT, options.runtimeConfig) || path.basename(options.runtimeConfig),
    fragments,
    generatedSha256: sha256(generated),
    runtimeSha256: sha256(runtime),
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (ok) {
    console.log(`ok: generated config matches ${payload.runtimeConfig}`);
  } else {
    console.error(`mismatch: generated config differs from ${payload.runtimeConfig}`);
    console.error(`generated: ${payload.generatedSha256}`);
    console.error(`runtime:   ${payload.runtimeSha256}`);
  }

  return ok ? 0 : 1;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { config } = buildCockpitConfig(options.fragmentsDir);
    const generated = stableJson(config);

    if (options.mode === "print") {
      process.stdout.write(generated);
      return;
    }

    if (options.mode === "write") {
      fs.writeFileSync(options.runtimeConfig, generated);
      console.log(`wrote ${path.relative(ROOT, options.runtimeConfig) || options.runtimeConfig}`);
      return;
    }

    process.exitCode = check(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
