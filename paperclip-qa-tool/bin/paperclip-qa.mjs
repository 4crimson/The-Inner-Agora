#!/usr/bin/env node

import { ConfigValidationError, loadConfig, suiteSummary } from "../src/config.mjs";
import { cleanupRun } from "../src/cleanup-runner.mjs";
import { runHealthChecks } from "../src/health-check.mjs";
import { createRun, manifestPathForRun, readManifest, runDirectory } from "../src/manifest.mjs";
import { PaperclipClient } from "../src/paperclip-client.mjs";
import { appendBugsToDoc, bugBatch, writeBugsJsonl, writeReport } from "../src/report-writer.mjs";
import { createRetestRun, executeRetestRun, executeSuite, runSuite } from "../src/suite-runner.mjs";
import { TelegramUserbot, TelegramUserbotError } from "../src/telegram-userbot.mjs";

function parseArgs(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") return { command: "", help: true, json: false, config: "" };
  const [command, ...tail] = argv;
  const options = {
    command,
    json: false,
    config: "",
    suite: "",
    run: "",
    mode: "",
    cleanup: "",
    appendDoc: "",
    area: "",
    dryRun: false,
    liveOk: false,
    limit: 20,
  };
  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--config") options.config = tail[++index] || "";
    else if (arg === "--suite") options.suite = tail[++index] || "";
    else if (arg === "--run") options.run = tail[++index] || "";
    else if (arg === "--mode") options.mode = tail[++index] || "";
    else if (arg === "--cleanup") options.cleanup = tail[++index] || "";
    else if (arg === "--append-doc") options.appendDoc = tail[++index] || "";
    else if (arg === "--area") options.area = tail[++index] || "";
    else if (arg === "--limit") options.limit = Number(tail[++index] || "20");
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--live-ok") options.liveOk = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  node paperclip-qa-tool/bin/paperclip-qa.mjs config-check --config FILE [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs health --config FILE [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs run-start --config FILE --suite NAME [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs run --config FILE --suite NAME [--cleanup hard|soft|none] [--json] [--dry-run|--live-ok]
  node paperclip-qa-tool/bin/paperclip-qa.mjs manifest-show --config FILE --run RUN_ID [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs cleanup --config FILE --run RUN_ID --mode hard|soft|none [--json] [--dry-run]
  node paperclip-qa-tool/bin/paperclip-qa.mjs report --config FILE --run RUN_ID [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs bugs --config FILE --run RUN_ID [--append-doc FILE] [--dry-run] [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs retest --config FILE --run OLD_RUN [--cleanup hard|soft|none] [--dry-run] [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs bug-batch --config FILE --run RUN_ID [--area AREA] [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs telegram-check --config FILE [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs telegram-history --config FILE [--limit N] [--dry-run] [--json]
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
      guards: {
        allowWarnings: config.guards.allowWarnings,
      },
    },
    suites: suiteSummary(config),
  };
}

async function runCleanupForManifest({ config, manifestPath, mode, dryRun = false }) {
  return cleanupRun({
    manifestPath,
    mode,
    dryRun,
    client: new PaperclipClient({ apiBase: config.paperclip.apiBase }),
    userbot: new TelegramUserbot({ config }),
  });
}

function writeRunArtifacts({ config, runId, manifestPath }) {
  const manifest = readManifest(manifestPath);
  const outputDir = runDirectory({ artifactsDir: config.artifacts.dir, runId });
  const report = writeReport({ manifest, outputDir });
  const bugs = writeBugsJsonl({ manifest, outputDir });
  return {
    reportPath: report.reportPath,
    bugsPath: bugs.bugsPath,
    bugs: bugs.bugs.length,
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
  if (options.command === "health") {
    const result = await runHealthChecks({
      config,
      userbot: new TelegramUserbot({ config }),
      paperclipClient: new PaperclipClient({ apiBase: config.paperclip.apiBase }),
    });
    printPayload(result, options.json);
    return result.ok ? 0 : 1;
  }
  if (options.command === "run-start") {
    if (!options.suite) throw new ConfigValidationError(["--suite is required"]);
    if (!config.suites[options.suite]) throw new ConfigValidationError([`suite not found: ${options.suite}`]);
    const run = createRun({ config, suite: options.suite });
    printPayload({ ok: true, runId: run.runId, manifestPath: run.manifestPath }, options.json);
    return 0;
  }
  if (options.command === "run") {
    if (!options.suite) throw new ConfigValidationError(["--suite is required"]);
    if (!options.dryRun && !options.liveOk) {
      throw new ConfigValidationError(["--live-ok is required for non-dry-run suite execution"]);
    }
    const result = options.dryRun
      ? runSuite({ config, suiteName: options.suite, dryRun: true, cleanupMode: options.cleanup })
      : await executeSuite({
        config,
        suiteName: options.suite,
        cleanupMode: options.cleanup,
        userbot: new TelegramUserbot({ config }),
        paperclipClient: new PaperclipClient({ apiBase: config.paperclip.apiBase }),
      });
    if (!options.dryRun && result.cleanup !== "none") {
      const cleanupResult = await runCleanupForManifest({
        config,
        manifestPath: result.manifestPath,
        mode: result.cleanup,
      });
      result.cleanup = cleanupResult.cleanup;
      result.ok = result.ok && cleanupResult.ok;
    }
    if (!options.dryRun) {
      Object.assign(result, writeRunArtifacts({ config, runId: result.runId, manifestPath: result.manifestPath }));
    }
    printPayload(result, options.json);
    return result.ok ? 0 : 1;
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
    const result = await runCleanupForManifest({ config, manifestPath, mode, dryRun: options.dryRun });
    printPayload({ ok: result.ok, runId: options.run, manifestPath, cleanup: result.cleanup }, options.json);
    return result.ok ? 0 : 1;
  }
  if (options.command === "report") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId: options.run });
    const manifest = readManifest(manifestPath);
    const outputDir = runDirectory({ artifactsDir: config.artifacts.dir, runId: options.run });
    const report = writeReport({ manifest, outputDir });
    printPayload({ ok: true, runId: options.run, manifestPath, ...report }, options.json);
    return 0;
  }
  if (options.command === "bugs") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId: options.run });
    const manifest = readManifest(manifestPath);
    const outputDir = runDirectory({ artifactsDir: config.artifacts.dir, runId: options.run });
    const result = writeBugsJsonl({ manifest, outputDir });
    const appendDoc = appendBugsToDoc({ bugs: result.bugs, docPath: options.appendDoc, dryRun: options.dryRun });
    printPayload({ ok: true, runId: options.run, manifestPath, bugsPath: result.bugsPath, bugs: result.bugs.length, appendDoc }, options.json);
    return 0;
  }
  if (options.command === "retest") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    if (!options.dryRun && !options.liveOk) {
      throw new ConfigValidationError(["--live-ok is required for non-dry-run retest execution"]);
    }
    const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId: options.run });
    const previousManifest = readManifest(manifestPath);
    const result = options.dryRun
      ? createRetestRun({ config, previousManifest, dryRun: true, cleanupMode: options.cleanup })
      : await executeRetestRun({
        config,
        previousManifest,
        cleanupMode: options.cleanup,
        userbot: new TelegramUserbot({ config }),
        paperclipClient: new PaperclipClient({ apiBase: config.paperclip.apiBase }),
      });
    if (!options.dryRun && result.cleanup !== "none") {
      const cleanupResult = await runCleanupForManifest({
        config,
        manifestPath: result.manifestPath,
        mode: result.cleanup,
      });
      result.cleanup = cleanupResult.cleanup;
      result.ok = result.ok && cleanupResult.ok;
    }
    if (!options.dryRun) {
      Object.assign(result, writeRunArtifacts({ config, runId: result.runId, manifestPath: result.manifestPath }));
    }
    printPayload(result, options.json);
    return result.ok ? 0 : 1;
  }
  if (options.command === "bug-batch") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId: options.run });
    const manifest = readManifest(manifestPath);
    printPayload({ ok: true, runId: options.run, manifestPath, ...bugBatch({ manifest, area: options.area }) }, options.json);
    return 0;
  }
  if (options.command === "telegram-check") {
    const userbot = new TelegramUserbot({ config });
    printPayload({ ok: true, userbot: userbot.checkEnv() }, options.json);
    return 0;
  }
  if (options.command === "telegram-history") {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new ConfigValidationError(["--limit must be a positive integer"]);
    }
    const userbot = new TelegramUserbot({ config });
    printPayload({ ok: true, history: userbot.history({ limit: options.limit, dryRun: options.dryRun }) }, options.json);
    return 0;
  }
  throw new Error(`Unknown command: ${options.command}`);
}

try {
  const status = await main(process.argv.slice(2));
  process.exitCode = status;
} catch (error) {
  const errors = error instanceof ConfigValidationError ? error.errors : [error.message || String(error)];
  const payload = { ok: false, errors };
  if (error instanceof TelegramUserbotError && error.payload) payload.userbot = error.payload;
  printPayload(payload, process.argv.includes("--json"));
  process.exitCode = 1;
}
