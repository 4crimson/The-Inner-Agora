#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SKILLS_DIR = path.join(ROOT, "skills");
const PROMPT_START = "<!-- INNER_AGORA_SKILL_PROMPT_START -->";
const PROMPT_END = "<!-- INNER_AGORA_SKILL_PROMPT_END -->";
const RISK_TIERS = new Set(["L0", "L1", "L2", "L3"]);

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/skill-loader.mjs list [--json] [--skills-dir DIR]
  node scripts/skill-loader.mjs validate [--skills-dir DIR]
  node scripts/skill-loader.mjs show <id> [--json] [--skills-dir DIR]
  node scripts/skill-loader.mjs prompt <id> [--json] [--skills-dir DIR]
  node scripts/skill-loader.mjs resolve-fixture --json [--skills-dir DIR] [--risk-fixture]
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
    skillsDir: DEFAULT_SKILLS_DIR,
    riskFixture: false,
  };

  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--skills-dir") {
      options.skillsDir = path.resolve(String(tail[++index] || ""));
      if (!options.skillsDir) throw new Error("--skills-dir requires a path");
    } else if (arg === "--risk-fixture") {
      options.riskFixture = true;
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

export function validateSkillManifest(skill, context = "skill.json") {
  if (!isPlainObject(skill)) throw new Error(`${context}: manifest must be an object`);
  for (const field of ["id", "name", "description", "riskTier", "allowedTools"]) {
    requireField(skill, field, context);
  }

  requireString(skill, "id", context);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skill.id)) throw new Error(`${context}: field id has invalid format`);
  requireString(skill, "name", context);
  requireString(skill, "description", context);
  requireString(skill, "riskTier", context);
  if (!RISK_TIERS.has(skill.riskTier)) throw new Error(`${context}: field riskTier must be L0, L1, L2, or L3`);
  requireArray(skill, "allowedTools", context);
  for (const [index, tool] of skill.allowedTools.entries()) {
    if (typeof tool !== "string" || !tool.trim()) {
      throw new Error(`${context}: allowedTools[${index}] must be a non-empty string`);
    }
  }
  if ("promptFile" in skill && (typeof skill.promptFile !== "string" || !skill.promptFile.trim())) {
    throw new Error(`${context}: field promptFile must be a non-empty string`);
  }
  return { promptFile: "SKILL.md", ...skill };
}

function skillManifestPath(skillsDir, id) {
  return path.join(skillsDir, id, "skill.json");
}

export function loadSkill(skillsDir, id) {
  const filePath = skillManifestPath(skillsDir, id);
  const skill = validateSkillManifest(readJson(filePath), path.relative(ROOT, filePath));
  return skill;
}

export function listSkills(skillsDir = DEFAULT_SKILLS_DIR) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(skillManifestPath(skillsDir, id)))
    .map((id) => loadSkill(skillsDir, id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function extractPromptBlock(text) {
  const start = text.indexOf(PROMPT_START);
  const end = text.indexOf(PROMPT_END);
  if (start === -1 || end === -1 || end <= start) return text.trim();
  return text.slice(start + PROMPT_START.length, end).trim();
}

export function loadSkillPrompt(skillsDir, id) {
  const skill = loadSkill(skillsDir, id);
  const promptPath = path.join(skillsDir, id, skill.promptFile || "SKILL.md");
  return extractPromptBlock(fs.readFileSync(promptPath, "utf8"));
}

function skillForResolution(id, options) {
  const catalog = options.skillCatalog;
  if (catalog) return catalog.get(id) || null;
  try {
    const skill = loadSkill(options.skillsDir || DEFAULT_SKILLS_DIR, id);
    let prompt = "";
    try {
      prompt = loadSkillPrompt(options.skillsDir || DEFAULT_SKILLS_DIR, id);
    } catch {
      prompt = "";
    }
    return { ...skill, prompt };
  } catch {
    return null;
  }
}

function diagnostic(level, code, message) {
  return { level, code, message };
}

export function resolveSkillsForRole(role, chamber, options = {}) {
  const requested = Array.isArray(role?.skills) ? role.skills.map(String).filter(Boolean) : [];
  const allowed = new Set(Array.isArray(chamber?.allowedSkills) ? chamber.allowedSkills.map(String) : []);
  const skills = [];
  const diagnostics = [];

  for (const skillId of requested) {
    const skill = skillForResolution(skillId, options);
    if (!skill) {
      diagnostics.push(diagnostic("warning", "skill_missing", `Skill ${skillId} requested by role ${role?.key || "unknown"} is not installed.`));
      continue;
    }

    if (!allowed.has(skillId)) {
      const highRisk = ["L2", "L3"].includes(skill.riskTier);
      diagnostics.push(
        diagnostic(
          highRisk ? "error" : "warning",
          highRisk ? "high_risk_skill_not_allowed" : "skill_not_allowed",
          `Skill ${skillId} requested by role ${role?.key || "unknown"} is not allowed by chamber ${chamber?.id || "unknown"}.`,
        ),
      );
      continue;
    }

    skills.push({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      riskTier: skill.riskTier,
      allowedTools: skill.allowedTools,
      prompt: skill.prompt || "",
    });
  }

  return { skills, diagnostics };
}

function printSkills(skills, json) {
  if (json) {
    console.log(stableJson({ skills: skills.map(({ id, name, riskTier, allowedTools }) => ({ id, name, riskTier, allowedTools })) }).trimEnd());
    return;
  }
  for (const skill of skills) console.log(`${skill.id}\t${skill.riskTier}\t${skill.name}`);
}

function fixtureCatalog(items) {
  return new Map(items.map((item) => [item.id, { promptFile: "SKILL.md", prompt: "", ...item }]));
}

function resolveFixture(options) {
  const skillCatalog = options.riskFixture
    ? fixtureCatalog([
        {
          id: "external-write",
          name: "External Write",
          description: "Test L2 skill.",
          riskTier: "L2",
          allowedTools: ["external-write"],
        },
      ])
    : fixtureCatalog([
        {
          id: "source-citation",
          name: "Source Citation",
          description: "Citation protocol.",
          riskTier: "L0",
          allowedTools: [],
        },
        {
          id: "web-research",
          name: "Web Research",
          description: "Read-only web research.",
          riskTier: "L1",
          allowedTools: ["web-search", "web-open"],
        },
      ]);

  const role = options.riskFixture
    ? { key: "test-role", skills: ["external-write"] }
    : { key: "test-role", skills: ["source-citation", "web-research"] };
  const chamber = options.riskFixture
    ? { id: "test-chamber", allowedSkills: [] }
    : { id: "test-chamber", allowedSkills: ["source-citation"] };
  const payload = resolveSkillsForRole(role, chamber, { skillCatalog });
  if (options.json) console.log(stableJson(payload).trimEnd());
  else console.log(payload);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "list") return printSkills(listSkills(options.skillsDir), options.json);
  if (options.command === "validate") {
    const skills = listSkills(options.skillsDir);
    console.log(`validated ${skills.length} skill(s)`);
    return;
  }
  if (options.command === "show") {
    if (!options.id) throw new Error("show requires skill id");
    const skill = loadSkill(options.skillsDir, options.id);
    if (options.json) console.log(stableJson(skill).trimEnd());
    else console.log(`${skill.id}\t${skill.riskTier}\t${skill.name}`);
    return;
  }
  if (options.command === "prompt") {
    if (!options.id) throw new Error("prompt requires skill id");
    const prompt = loadSkillPrompt(options.skillsDir, options.id);
    if (options.json) console.log(stableJson({ id: options.id, prompt }).trimEnd());
    else console.log(prompt);
    return;
  }
  if (options.command === "resolve-fixture") return resolveFixture(options);
  usage(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
