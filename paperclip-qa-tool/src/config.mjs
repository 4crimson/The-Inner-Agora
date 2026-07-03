import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUITES_DIR = path.join(ROOT, "suites");

export class ConfigValidationError extends Error {
  constructor(errors) {
    super(errors.join("; "));
    this.name = "ConfigValidationError";
    this.errors = errors;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigValidationError([`invalid json: ${filePath}`]);
    }
    throw error;
  }
}

function requireString(value, key, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(key);
}

function normalizeTest(test, suiteName, index) {
  if (!test || typeof test !== "object" || Array.isArray(test)) {
    return { id: `${suiteName}.${index + 1}`, invalid: true };
  }
  return { ...test, id: String(test.id || `${suiteName}.${index + 1}`) };
}

function loadSuiteReference(name) {
  const safeName = String(name || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(safeName)) {
    throw new ConfigValidationError([`invalid suite reference: ${name}`]);
  }
  const filePath = path.join(SUITES_DIR, `${safeName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new ConfigValidationError([`suite reference not found: ${safeName}`]);
  }
  const suite = readJson(filePath);
  if (!suite || typeof suite !== "object" || Array.isArray(suite)) {
    throw new ConfigValidationError([`suite reference must be an object: ${safeName}`]);
  }
  return suite;
}

export function resolveSuites(config) {
  const suites = config.suites && typeof config.suites === "object" && !Array.isArray(config.suites)
    ? config.suites
    : {};
  const resolved = {};
  for (const [suiteName, suiteConfig] of Object.entries(suites)) {
    const localSuite = suiteConfig && typeof suiteConfig === "object" && !Array.isArray(suiteConfig)
      ? suiteConfig
      : {};
    const inherited = localSuite.extends ? loadSuiteReference(localSuite.extends) : {};
    const inheritedTests = Array.isArray(inherited.tests) ? inherited.tests : [];
    const localTests = Array.isArray(localSuite.tests) ? localSuite.tests : [];
    resolved[suiteName] = {
      ...inherited,
      ...localSuite,
      tests: [...inheritedTests, ...localTests].map((test, index) => normalizeTest(test, suiteName, index)),
    };
  }
  return resolved;
}

export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["config must be an object"];
  }

  requireString(config.name, "name", errors);
  requireString(config.telegram?.target, "telegram.target", errors);
  requireString(config.paperclip?.company, "paperclip.company", errors);

  const cleanup = config.paperclip?.cleanup;
  if (cleanup !== undefined && !["hard", "soft", "none"].includes(cleanup)) {
    errors.push("paperclip.cleanup");
  }
  if (!config.suites || typeof config.suites !== "object" || Array.isArray(config.suites)) {
    errors.push("suites");
  }

  let resolvedSuites = {};
  if (!errors.includes("suites")) {
    try {
      resolvedSuites = resolveSuites(config);
    } catch (error) {
      if (error instanceof ConfigValidationError) errors.push(...error.errors);
      else throw error;
    }
  }

  const seenTestIds = new Set();
  for (const suite of Object.values(resolvedSuites)) {
    for (const test of suite.tests || []) {
      if (!test.id || test.invalid) {
        errors.push("suite test");
        continue;
      }
      if (seenTestIds.has(test.id)) errors.push(`duplicate test id: ${test.id}`);
      seenTestIds.add(test.id);
    }
  }

  return [...new Set(errors)];
}

export function normalizeConfig(config) {
  return {
    ...config,
    telegram: {
      ...config.telegram,
      userbot: {
        session: ".telegram-userbot",
        ...(config.telegram?.userbot || {}),
      },
    },
    paperclip: {
      apiBase: "http://127.0.0.1:3100/api",
      cleanup: "hard",
      ...(config.paperclip || {}),
    },
    artifacts: {
      dir: "artifacts/telegram-test-runs",
      ...(config.artifacts || {}),
    },
    suites: resolveSuites(config),
  };
}

export function suiteSummary(config) {
  return Object.entries(config.suites).map(([name, suite]) => ({
    name,
    tests: Array.isArray(suite.tests) ? suite.tests.length : 0,
  }));
}

export function loadConfig(filePath) {
  const configPath = path.resolve(String(filePath || ""));
  const raw = readJson(configPath);
  const errors = validateConfig(raw);
  if (errors.length) throw new ConfigValidationError(errors);
  return normalizeConfig(raw);
}
