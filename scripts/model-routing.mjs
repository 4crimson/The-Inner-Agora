#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG_PATH = path.join(ROOT, "models.config.json");
const RISK_ORDER = new Map([
  ["reflective", 0],
  ["advisory", 1],
  ["high-stakes", 2],
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function configPath(options = {}) {
  return path.resolve(options.configPath || process.env.INNER_AGORA_MODELS_CONFIG || DEFAULT_CONFIG_PATH);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function validateModelsConfig(config) {
  assertObject(config, "models config");
  if (config.schemaVersion !== 1) throw new Error("models config schemaVersion must be 1");
  assertObject(config.slotExtractor, "slotExtractor");
  assertObject(config.adapters, "adapters");
  assertObject(config.routingRule, "routingRule");
  for (const name of ["hermes_local", "codex_local"]) {
    const adapter = assertObject(config.adapters[name], `adapters.${name}`);
    if (!adapter.type) throw new Error(`adapters.${name}.type is required`);
    if (!adapter.model) throw new Error(`adapters.${name}.model is required`);
  }
  for (const key of ["default", "localMode", "shortDialogueSingleRole", "fullCouncilHighStakes"]) {
    const adapterName = config.routingRule[key];
    if (!config.adapters[adapterName]) throw new Error(`routingRule.${key} references unknown adapter ${adapterName}`);
  }
  return config;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function loadModelsConfig(options = {}) {
  return applyEnvOverrides(validateModelsConfig(clone(readJsonFile(configPath(options)))));
}

function applyEnvOverrides(config) {
  if (process.env.INNER_AGORA_LLM_MODEL) config.slotExtractor.model = process.env.INNER_AGORA_LLM_MODEL;
  if (process.env.INNER_AGORA_LLM_BASE_URL) config.slotExtractor.baseUrl = process.env.INNER_AGORA_LLM_BASE_URL;
  if (process.env.INNER_AGORA_HERMES_MODEL) config.adapters.hermes_local.model = process.env.INNER_AGORA_HERMES_MODEL;
  if (process.env.INNER_AGORA_HERMES_BASE_URL) config.adapters.hermes_local.baseUrl = process.env.INNER_AGORA_HERMES_BASE_URL;
  if (process.env.INNER_AGORA_CODEX_MODEL) config.adapters.codex_local.model = process.env.INNER_AGORA_CODEX_MODEL;
  if (process.env.INNER_AGORA_CODEX_REASONING_EFFORT) {
    config.adapters.codex_local.reasoningEffort = process.env.INNER_AGORA_CODEX_REASONING_EFFORT;
  }
  return config;
}

export function normalizeRiskTier(value) {
  const normalized = String(value || "reflective").trim().toLowerCase();
  return RISK_ORDER.has(normalized) ? normalized : "reflective";
}

export function highestRiskTier(values = []) {
  return values
    .map(normalizeRiskTier)
    .sort((left, right) => (RISK_ORDER.get(right) || 0) - (RISK_ORDER.get(left) || 0))[0] || "reflective";
}

function routeAdapterName(request, config) {
  const mode = String(request.mode || "").trim().toLowerCase();
  const riskTier = highestRiskTier([request.chamberRiskTier, ...(Array.isArray(request.roleRiskTiers) ? request.roleRiskTiers : [])]);
  const roleCount = Number(request.roleCount || 0);
  const intent = String(request.intent || "");

  if (mode === "local") return { adapterName: config.routingRule.localMode, reason: "localMode", riskTier };
  if ((intent === "dialogue" || intent === "follow-up") && roleCount <= 1) {
    return { adapterName: config.routingRule.shortDialogueSingleRole, reason: "shortDialogueSingleRole", riskTier };
  }
  if (mode === "all" && riskTier === "high-stakes") {
    return { adapterName: config.routingRule.fullCouncilHighStakes, reason: "fullCouncilHighStakes", riskTier };
  }
  return { adapterName: config.routingRule.default, reason: "default", riskTier };
}

export function adapterForRequest(request = {}, options = {}) {
  const config = loadModelsConfig(options);
  const { adapterName, reason, riskTier } = routeAdapterName(request, config);
  const adapter = clone(config.adapters[adapterName]);
  return {
    name: adapterName,
    adapter,
    model: adapter.model,
    reason,
    riskTier,
    env: adapterEnv({ name: adapterName, adapter }),
  };
}

export function adapterEnv(route) {
  const name = route?.name;
  const adapter = route?.adapter || {};
  if (name === "hermes_local") {
    return {
      INNER_AGORA_AGENT_ADAPTER: "hermes_local",
      INNER_AGORA_HERMES_MODEL: adapter.model,
      ...(adapter.baseUrl ? { INNER_AGORA_HERMES_BASE_URL: adapter.baseUrl } : {}),
    };
  }
  if (name === "codex_local") {
    return {
      INNER_AGORA_AGENT_ADAPTER: "codex_local",
      INNER_AGORA_CODEX_MODEL: adapter.model,
      ...(adapter.reasoningEffort ? { INNER_AGORA_CODEX_REASONING_EFFORT: adapter.reasoningEffort } : {}),
    };
  }
  return {};
}

export function slotExtractorConfig(options = {}) {
  const config = loadModelsConfig(options);
  return clone(config.slotExtractor);
}

export function hermesProfileConfig(options = {}) {
  const config = loadModelsConfig(options);
  const adapter = clone(config.adapters.hermes_local);
  return {
    model: adapter.model,
    baseUrl: adapter.baseUrl || "",
    reasoningEffort: adapter.reasoningEffort || "none",
  };
}

export function codexAdapterConfig(options = {}) {
  const config = loadModelsConfig(options);
  return clone(config.adapters.codex_local);
}

export function hermesAdapterConfig(options = {}) {
  const config = loadModelsConfig(options);
  return clone(config.adapters.hermes_local);
}

function parseCliArgs(args = []) {
  const options = { json: false, mode: "", riskTier: "", roleCount: 0, intent: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--mode") options.mode = args[++index] || "";
    else if (arg === "--risk-tier") options.riskTier = args[++index] || "";
    else if (arg === "--role-count") options.roleCount = Number(args[++index] || 0);
    else if (arg === "--intent") options.intent = args[++index] || "";
    else throw new Error(`Unknown model-routing argument: ${arg}`);
  }
  return options;
}

function printValue(value, json) {
  if (json) process.stdout.write(stableJson(value));
  else console.log(JSON.stringify(value));
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseCliArgs(args);
  if (command === "config") return printValue(loadModelsConfig(), options.json);
  if (command === "route") {
    return printValue(
      adapterForRequest({
        mode: options.mode,
        chamberRiskTier: options.riskTier,
        roleCount: options.roleCount,
        intent: options.intent,
      }),
      options.json,
    );
  }
  if (command === "slot-extractor") return printValue(slotExtractorConfig(), options.json);
  if (command === "hermes-profile") return printValue(hermesProfileConfig(), options.json);
  throw new Error("Usage: node scripts/model-routing.mjs <config|route|slot-extractor|hermes-profile> [--json]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
  }
}
