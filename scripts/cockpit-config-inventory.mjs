#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = path.join(ROOT, "paperclip-cockpit.json");

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/cockpit-config-inventory.mjs [--json] [--config FILE]

Reads a local Paperclip Cockpit config and prints a non-live inventory for
config split/review work. It does not call Telegram, Paperclip, Hermes, or the
network.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    configPath: DEFAULT_CONFIG,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--config") {
      const value = argv[++index];
      if (!value) throw new Error("--config requires a file path");
      options.configPath = path.resolve(value);
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sortedKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function collectVisibleLabels(config) {
  const labels = [];
  const telegram = config.telegram || {};
  const commandBoundary = telegram.command_boundary || {};

  for (const menu of Object.values(commandBoundary.menus || {})) {
    for (const button of menu.buttons || []) {
      if (button && typeof button.label === "string") labels.push(button.label);
    }
  }

  const modeSelector = telegram.mode_selector || {};
  for (const mode of modeSelector.modes || []) {
    if (mode && typeof mode.label === "string") labels.push(mode.label);
  }

  for (const value of Object.values((telegram.buttons || {}).labels || {})) {
    if (typeof value === "string") labels.push(value);
  }

  return uniqueSorted(labels);
}

export function buildInventory(config, configPath = DEFAULT_CONFIG) {
  const telegram = config.telegram || {};
  const commandBoundary = telegram.command_boundary || {};
  const modeSelector = telegram.mode_selector || {};

  const actionKeys = sortedKeys(config.actions);
  const callbackKeys = sortedKeys(telegram.callbacks);
  const commandBoundaryMenuKeys = sortedKeys(commandBoundary.menus);
  const modeIds = (modeSelector.modes || []).map((mode) => mode.id).filter(Boolean).map(String).sort();

  return {
    configPath: path.relative(ROOT, configPath) || path.basename(configPath),
    topLevelCommand: (config.command || {}).name || "pc",
    registerPcFallback: Boolean((config.command || {}).register_pc_fallback),
    actions: actionKeys.length,
    actionKeys,
    telegramCallbacks: callbackKeys.length,
    callbackKeys,
    telegramCommandBoundaryMenus: commandBoundaryMenuKeys.length,
    commandBoundaryMenuKeys,
    telegramCommandBoundaryEnabled: Boolean(commandBoundary.enabled),
    telegramModeSelectorModes: modeIds.length,
    modeIds,
    visibleLabels: collectVisibleLabels(config),
  };
}

function printText(inventory) {
  console.log(`Paperclip Cockpit config: ${inventory.configPath}`);
  console.log(`command: /${inventory.topLevelCommand}`);
  console.log(`registerPcFallback: ${inventory.registerPcFallback ? "yes" : "no"}`);
  console.log(`actions: ${inventory.actions}`);
  console.log(`telegram callbacks: ${inventory.telegramCallbacks}`);
  console.log(`command-boundary menus: ${inventory.telegramCommandBoundaryMenus}`);
  console.log(`mode-selector modes: ${inventory.telegramModeSelectorModes}`);
  console.log(`visible labels: ${inventory.visibleLabels.join(", ")}`);
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const config = readJson(options.configPath);
    const inventory = buildInventory(config, options.configPath);
    if (options.json) {
      console.log(JSON.stringify(inventory, null, 2));
    } else {
      printText(inventory);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
