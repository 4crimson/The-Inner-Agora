#!/usr/bin/env node

import { ConfigValidationError, loadConfig, suiteSummary } from "../src/config.mjs";

function parseArgs(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") return { command: "", help: true, json: false, config: "" };
  const [command, ...tail] = argv;
  const options = { command, json: false, config: "" };
  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--config") options.config = tail[++index] || "";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config FILE [--json]
`;
}

function printPayload(payload, json) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else if (payload.ok) console.log("ok");
  else console.log(`error: ${(payload.errors || []).join(", ")}`);
}

function configSummary(config) {
  return {
    ok: true,
    config: {
      name: config.name,
      telegram: {
        target: config.telegram.target,
      },
      paperclip: {
        apiBase: config.paperclip.apiBase,
        company: config.paperclip.company,
        cleanup: config.paperclip.cleanup,
      },
      artifacts: {
        dir: config.artifacts.dir,
      },
    },
    suites: suiteSummary(config),
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options.command || options.help) {
    console.log(usage());
    return options.help ? 0 : 1;
  }
  if (options.command !== "config-check") throw new Error(`Unknown command: ${options.command}`);
  if (!options.config) throw new ConfigValidationError(["--config is required"]);

  const config = loadConfig(options.config);
  printPayload(configSummary(config), options.json);
  return 0;
}

try {
  const status = await main(process.argv.slice(2));
  process.exitCode = status;
} catch (error) {
  const errors = error instanceof ConfigValidationError ? error.errors : [error.message || String(error)];
  printPayload({ ok: false, errors }, process.argv.includes("--json"));
  process.exitCode = 1;
}
