#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/phase1-soak-check.mjs [--started-at ISO_DATE] [--now ISO_DATE] [--json]
  node scripts/phase1-soak-check.mjs [--started-at ISO_DATE] [--fixtures-dir DIR] [--commands-file FILE]
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    startedAt: process.env.PHASE1_SOAK_STARTED_AT || "",
    now: "",
    json: false,
    fixturesDir: "",
    commandsFile: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--started-at") {
      options.startedAt = String(argv[++index] || "");
    } else if (arg === "--now") {
      options.now = String(argv[++index] || "");
    } else if (arg === "--fixtures-dir") {
      options.fixturesDir = path.resolve(String(argv[++index] || ""));
    } else if (arg === "--commands-file") {
      options.commandsFile = path.resolve(String(argv[++index] || ""));
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function isoDate(value, label) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date;
}

function runNode(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status ?? (result.signal ? 128 : 1),
    signal: result.signal || null,
    stdout: (result.stdout || "").trimEnd(),
    stderr: (result.stderr || result.error?.message || "").trimEnd(),
    env,
  };
}

function regressionArgs(options) {
  const args = ["scripts/regression.mjs", "check"];
  if (options.fixturesDir) args.push("--fixtures-dir", options.fixturesDir);
  if (options.commandsFile) args.push("--commands-file", options.commandsFile);
  return args;
}

function runChecks(options) {
  return {
    migration: runNode(["scripts/migrate-roles.mjs", "--check"]),
    regressionLegacy: runNode(regressionArgs(options), { CHAMBER_MODE: "legacy" }),
    regressionChambers: runNode(regressionArgs(options), { CHAMBER_MODE: "chambers" }),
  };
}

function buildReport(options) {
  const started = options.startedAt ? isoDate(options.startedAt, "started-at") : null;
  const now = isoDate(options.now, "now");
  const checks = runChecks(options);
  const ok = Object.values(checks).every((check) => check.status === 0);

  return {
    ok,
    eligible: ok,
    gate: "migration-and-regression",
    startedAt: started ? started.toISOString() : "",
    now: now.toISOString(),
    checks,
  };
}

function printText(report) {
  console.log("# Phase 1 readiness check");
  console.log(`checks=${report.ok ? "ok" : "failed"}`);
  console.log(`eligible=${report.eligible ? "yes" : "no"}`);
  console.log(`gate=${report.gate}`);
  if (report.startedAt) console.log(`startedAt=${report.startedAt}`);
  console.log(`now=${report.now}`);
  for (const [name, check] of Object.entries(report.checks)) {
    console.log(`${name}=exit:${check.status}`);
    if (check.stdout) console.log(check.stdout);
    if (check.stderr) console.error(check.stderr);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
  if (!report.ok) process.exitCode = 1;
}

main();
