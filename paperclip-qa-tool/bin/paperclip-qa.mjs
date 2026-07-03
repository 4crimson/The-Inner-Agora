#!/usr/bin/env node

import { ConfigValidationError, loadConfig, suiteSummary } from "../src/config.mjs";
import { cleanupPaperclipIssues } from "../src/cleanup-engine.mjs";
import { createRun, manifestPathForRun, readManifest, writeManifest } from "../src/manifest.mjs";
import { PaperclipClient } from "../src/paperclip-client.mjs";

function parseArgs(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") return { command: "", help: true, json: false, config: "" };
  const [command, ...tail] = argv;
  const options = { command, json: false, config: "", suite: "", run: "", mode: "", dryRun: false };
  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--config") options.config = tail[++index] || "";
    else if (arg === "--suite") options.suite = tail[++index] || "";
    else if (arg === "--run") options.run = tail[++index] || "";
    else if (arg === "--mode") options.mode = tail[++index] || "";
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config FILE [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs run-start --config FILE --suite NAME [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs manifest-show --config FILE --run RUN_ID [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs cleanup --config FILE --run RUN_ID --mode hard|soft|none [--json] [--dry-run]
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
  if (!options.config) throw new ConfigValidationError(["--config is required"]);

  const config = loadConfig(options.config);
  if (options.command === "config-check") {
    printPayload(configSummary(config), options.json);
    return 0;
  }
  if (options.command === "run-start") {
    if (!options.suite) throw new ConfigValidationError(["--suite is required"]);
    if (!config.suites[options.suite]) throw new ConfigValidationError([`suite not found: ${options.suite}`]);
    const run = createRun({ config, suite: options.suite });
    printPayload({ ok: true, runId: run.runId, manifestPath: run.manifestPath }, options.json);
    return 0;
  }
  if (options.command === "manifest-show") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId: options.run });
    const manifest = readManifest(manifestPath);
    printPayload({ ...manifest, ok: true, manifestPath }, options.json);
    return 0;
  }
  if (options.command === "cleanup") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    const mode = options.mode || config.paperclip.cleanup;
    if (!["hard", "soft", "none"].includes(mode)) throw new ConfigValidationError(["--mode must be hard, soft, or none"]);
    const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId: options.run });
    const manifest = readManifest(manifestPath);
    const client = new PaperclipClient({ apiBase: config.paperclip.apiBase });
    const result = await cleanupPaperclipIssues({ client, manifest, mode, dryRun: options.dryRun });
    manifest.cleanup = {
      ...(manifest.cleanup || {}),
      mode,
      attemptedAt: new Date().toISOString(),
      paperclip: [...(manifest.cleanup?.paperclip || []), ...result.actions],
      residuals: [...(manifest.cleanup?.residuals || []), ...result.residuals],
    };
    writeManifest(manifestPath, manifest);
    printPayload({ ok: result.residuals.length === 0, runId: options.run, manifestPath, cleanup: manifest.cleanup }, options.json);
    return result.residuals.length === 0 ? 0 : 1;
  }
  throw new Error(`Unknown command: ${options.command}`);
}

try {
  const status = await main(process.argv.slice(2));
  process.exitCode = status;
} catch (error) {
  const errors = error instanceof ConfigValidationError ? error.errors : [error.message || String(error)];
  printPayload({ ok: false, errors }, process.argv.includes("--json"));
  process.exitCode = 1;
}
