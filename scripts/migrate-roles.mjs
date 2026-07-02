#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_PATH = path.join(ROOT, "data", "philosophers.json");
const OUTPUT_PATH = path.join(ROOT, "chambers", "philosophy", "roles.json");
const CHAMBER_ID = "philosophy";
const RISK_TIER = "reflective";

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/migrate-roles.mjs [--check|--dry-run]
`);
  process.exit(exitCode);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function migrateRole(role) {
  return {
    ...role,
    chamberId: CHAMBER_ID,
    riskTier: RISK_TIER,
  };
}

function migratedRoles() {
  const legacy = readJson(LEGACY_PATH);
  if (!Array.isArray(legacy)) throw new Error(`Legacy roles must be an array: ${path.relative(ROOT, LEGACY_PATH)}`);
  return legacy.map(migrateRole);
}

function writeRoles(roles) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, stableJson(roles), "utf8");
  console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)}: ${roles.length} roles`);
}

function checkRoles(roles) {
  const expected = stableJson(roles);
  let actual = "";
  try {
    actual = fs.readFileSync(OUTPUT_PATH, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`missing migrated roles: ${path.relative(ROOT, OUTPUT_PATH)}. Run: node scripts/migrate-roles.mjs`);
    }
    throw error;
  }

  if (actual !== expected) {
    throw new Error(`migrated roles are stale: ${path.relative(ROOT, OUTPUT_PATH)}. Run: node scripts/migrate-roles.mjs`);
  }
  console.log(`roles migration check ok: ${roles.length} roles`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage(0);
  const unknown = args.filter((arg) => !["--check", "--dry-run"].includes(arg));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);

  const roles = migratedRoles();
  if (args.includes("--dry-run")) {
    process.stdout.write(stableJson(roles));
    return;
  }
  if (args.includes("--check")) {
    checkRoles(roles);
    return;
  }
  writeRoles(roles);
}

main();
