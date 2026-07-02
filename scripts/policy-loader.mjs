#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadChamber } from "./chamber-loader.mjs";
import { loadSkillPrompt } from "./skill-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CHAMBERS_DIR = process.env.INNER_AGORA_CHAMBERS_DIR
  ? path.resolve(process.env.INNER_AGORA_CHAMBERS_DIR)
  : path.join(ROOT, "chambers");
const DEFAULT_SKILLS_DIR = process.env.INNER_AGORA_SKILLS_DIR
  ? path.resolve(process.env.INNER_AGORA_SKILLS_DIR)
  : path.join(ROOT, "skills");
const HIGH_STAKES_DISCLAIMER_ID = "high-stakes-disclaimer";

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/policy-loader.mjs compose <chamber-id> [--json] [--chambers-dir DIR] [--skills-dir DIR]
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...tail] = argv;
  if (!command || command === "--help" || command === "-h") usage(command ? 0 : 1);

  const options = {
    command,
    chamberId: "",
    json: false,
    chambersDir: DEFAULT_CHAMBERS_DIR,
    skillsDir: DEFAULT_SKILLS_DIR,
  };

  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--chambers-dir") {
      options.chambersDir = path.resolve(String(tail[++index] || ""));
      if (!options.chambersDir) throw new Error("--chambers-dir requires a path");
    } else if (arg === "--skills-dir") {
      options.skillsDir = path.resolve(String(tail[++index] || ""));
      if (!options.skillsDir) throw new Error("--skills-dir requires a path");
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else if (!options.chamberId && !arg.startsWith("-")) {
      options.chamberId = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function chamberRiskTier(chamber) {
  return String(chamber?.riskTier || "reflective").trim() || "reflective";
}

export function fallbackTransparencyPolicy(policyId, error) {
  return [
    `Протокол прозрачности (${policyId}, fallback: ${error.message || error}):`,
    "- Основной skill prompt не загрузился; используй базовый протокол ниже.",
    "Протокол прозрачности:",
    "- По возможности помечай ключевые утверждения: [источник], [реконструкция], [имитация], [современный перенос].",
    "- [источник] — когда опираешься на конкретный текст, работу, фрагмент или устойчиво известную позицию; называй источник настолько точно, насколько уверен.",
    "- [реконструкция] — когда выводишь позицию из общей оптики, но не даешь прямую цитату.",
    "- [имитация] — когда это стилистическое разыгрывание голоса, темперамента или манеры.",
    "- [современный перенос] — когда применяешь оптику к теме, которой исторически не было в исходном горизонте роли.",
    "- Не выдумывай точные цитаты, страницы, ссылки и названия. Если не уверен, пиши: нужна проверка источника.",
    "- В конце содержательного ответа добавь блок `Пометки:` с пунктами: Источники, Реконструкция, Имитация голоса, Современный перенос, Требует проверки.",
  ].join("\n");
}

function loadPolicyPrompt(skillsDir, policyId) {
  try {
    return loadSkillPrompt(skillsDir, policyId);
  } catch (error) {
    return fallbackTransparencyPolicy(policyId, error);
  }
}

export function composeChamberPolicy(chamber, options = {}) {
  const skillsDir = options.skillsDir || DEFAULT_SKILLS_DIR;
  const policyId = String(chamber?.transparencyPolicy || "source-citation").trim() || "source-citation";
  const parts = [loadPolicyPrompt(skillsDir, policyId)];

  if (chamberRiskTier(chamber) === "high-stakes") {
    parts.push(loadPolicyPrompt(skillsDir, HIGH_STAKES_DISCLAIMER_ID));
  }

  return parts.join("\n\n");
}

function printComposedPolicy(options) {
  if (!options.chamberId) throw new Error("compose requires chamber id");
  const chamber = loadChamber(options.chambersDir, options.chamberId);
  const text = composeChamberPolicy(chamber, options);
  if (options.json) {
    console.log(
      stableJson({
        chamberId: chamber.id,
        riskTier: chamberRiskTier(chamber),
        transparencyPolicy: chamber.transparencyPolicy,
        text,
      }).trimEnd(),
    );
    return;
  }
  console.log(text);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "compose") return printComposedPolicy(options);
  throw new Error(`Unknown command: ${options.command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
