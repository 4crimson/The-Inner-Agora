#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FIXTURES_DIR = path.join(ROOT, "tests", "fixtures", "baseline");
const DEFAULT_TIMEOUT_MS = 120000;

const DEFAULT_COMMANDS = [
  {
    name: "council-dry-run",
    args: ["node", "scripts/agora.mjs", "council", "--dry-run", "Что такое свобода?"],
  },
  {
    name: "ask-selected-dry-run",
    args: ["node", "scripts/agora.mjs", "ask", "--dry-run", "--philosophers", "socrates,kant,foucault", "Что такое свобода?"],
  },
  {
    name: "ask-min-dry-run",
    args: ["node", "scripts/agora.mjs", "ask", "--dry-run", "--min", "тест"],
  },
  {
    name: "ask-max-dry-run",
    args: ["node", "scripts/agora.mjs", "ask", "--dry-run", "--max", "тест"],
  },
  {
    name: "ask-unknown-philosopher-dry-run",
    args: ["node", "scripts/agora.mjs", "ask", "--dry-run", "--philosophers", "nonexistent-key", "тест"],
  },
  {
    name: "mode-get",
    args: ["node", "scripts/agora.mjs", "mode", "get"],
  },
  {
    name: "philosophers-tags",
    args: ["node", "scripts/agora.mjs", "philosophers", "--tags"],
  },
  {
    name: "board-directors-ask-dry-run",
    env: { INNER_AGORA_ACTIVE_CHAMBER: "board-directors" },
    args: ["node", "scripts/agora.mjs", "ask", "--dry-run", "go/no-go по найму CTO"],
  },
  {
    name: "skills-board-product-json",
    env: { INNER_AGORA_ACTIVE_CHAMBER: "board-directors" },
    args: ["node", "scripts/agora.mjs", "skills", "product", "--json"],
  },
];

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/regression.mjs record [--fixtures-dir DIR] [--commands-file FILE]
  node scripts/regression.mjs check [--fixtures-dir DIR] [--commands-file FILE]
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...tail] = argv;
  if (!command || command === "--help" || command === "-h") usage(command ? 0 : 1);
  if (!["record", "check"].includes(command)) usage(1);

  const options = {
    command,
    fixturesDir: DEFAULT_FIXTURES_DIR,
    commandsFile: "",
  };

  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    if (arg === "--fixtures-dir") {
      options.fixturesDir = path.resolve(String(tail[++index] || ""));
      if (!options.fixturesDir) throw new Error("--fixtures-dir requires a path");
    } else if (arg === "--commands-file") {
      options.commandsFile = path.resolve(String(tail[++index] || ""));
      if (!options.commandsFile) throw new Error("--commands-file requires a path");
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

function loadCommands(commandsFile) {
  if (!commandsFile) return DEFAULT_COMMANDS;
  const data = readJson(commandsFile);
  const commands = Array.isArray(data) ? data : data.commands;
  if (!Array.isArray(commands)) throw new Error(`Commands file must be an array or { "commands": [...] }: ${commandsFile}`);
  return commands;
}

function validateCommand(command) {
  if (!command || typeof command !== "object") throw new Error("Regression command must be an object");
  if (!command.name || typeof command.name !== "string") throw new Error("Regression command requires string name");
  if (!Array.isArray(command.args) || !command.args.length) throw new Error(`Regression command ${command.name} requires args[]`);
}

function slug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function snapshotPath(fixturesDir, command) {
  return path.join(fixturesDir, `${slug(command.name)}.json`);
}

function normalize(text) {
  return String(text || "")
    .replace(/\/[^\s"]*inner-agora-regression-[^/\s"]+\/state\.json/g, path.join(ROOT, ".inner-agora-state.json"))
    .replace(/\b[A-Z][A-Z0-9]{1,12}-\d+\b/g, "<ISSUE>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<TIMESTAMP>")
    .replace(/updated=\S+/g, "updated=<TS>")
    .replace(/created=\S+/g, "created=<TS>")
    .replace(/run=\S+/g, "run=<ID>")
    .replace(/wake=(queued|accepted):\S+/g, "wake=$1:<ID>")
    .replace(/issues\/[A-Za-z0-9_-]+/g, "issues/<ID>")
    .trimEnd();
}

function commandForSpawn(args) {
  const command = args.map(String);
  if (command[0] === "node") return [process.execPath, ...command.slice(1)];
  return command;
}

function runCommand(command) {
  validateCommand(command);
  const args = commandForSpawn(command.args);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inner-agora-regression-"));
  const statePath = path.join(tempDir, "state.json");
  fs.writeFileSync(
    statePath,
    stableJson({
      schemaVersion: 1,
      chatId: "regression",
      mode: "local",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  );

  const result = spawnSync(args[0], args.slice(1), {
    cwd: command.cwd ? path.resolve(ROOT, command.cwd) : ROOT,
    encoding: "utf8",
    timeout: Number(command.timeout_ms || DEFAULT_TIMEOUT_MS),
    env: {
      ...process.env,
      INNER_AGORA_STATE_PATH: statePath,
      INNER_AGORA_LEGACY_STATE_PATH: path.join(tempDir, "missing-legacy-state.json"),
      ...(command.env || {}),
    },
  });
  fs.rmSync(tempDir, { recursive: true, force: true });

  return {
    name: command.name,
    args: command.args.map((arg) => normalize(String(arg))),
    exitCode: result.status ?? (result.signal ? 128 : 1),
    signal: result.signal || null,
    stdout: normalize(result.stdout || ""),
    stderr: normalize(result.stderr || result.error?.message || ""),
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function firstDiff(expected, actual) {
  const expectedLines = expected.split(/\r?\n/);
  const actualLines = actual.split(/\r?\n/);
  const limit = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < limit; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return [
        `line ${index + 1}`,
        `expected: ${expectedLines[index] ?? "<missing>"}`,
        `actual:   ${actualLines[index] ?? "<missing>"}`,
      ].join("\n");
    }
  }
  return "outputs differ";
}

function record(options, commands) {
  fs.mkdirSync(options.fixturesDir, { recursive: true });
  for (const command of commands) {
    const snapshot = runCommand(command);
    const filePath = snapshotPath(options.fixturesDir, command);
    fs.writeFileSync(filePath, stableJson(snapshot));
    console.log(`recorded ${command.name}: ${path.relative(ROOT, filePath)}`);
  }
}

function check(options, commands) {
  let failures = 0;
  for (const command of commands) {
    const filePath = snapshotPath(options.fixturesDir, command);
    if (!fs.existsSync(filePath)) {
      console.error(`missing baseline for ${command.name}: ${filePath}`);
      failures += 1;
      continue;
    }

    const expected = fs.readFileSync(filePath, "utf8");
    const actual = stableJson(runCommand(command));
    if (expected !== actual) {
      console.error(`regression mismatch: ${command.name}`);
      console.error(firstDiff(expected, actual));
      failures += 1;
    } else {
      console.log(`ok ${command.name}`);
    }
  }

  if (failures) {
    console.error(`Regression check failed: ${failures} mismatch(es).`);
    process.exitCode = 1;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const commands = loadCommands(options.commandsFile);
  if (options.command === "record") record(options, commands);
  else check(options, commands);
}

main();
