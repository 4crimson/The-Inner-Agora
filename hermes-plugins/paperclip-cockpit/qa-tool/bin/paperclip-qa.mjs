#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigValidationError, loadConfig, suiteSummary } from "../src/config.mjs";
import { cleanupRun } from "../src/cleanup-runner.mjs";
import { runSuiteHealthGuard, shouldRunSuiteHealthGuard } from "../src/guard-runner.mjs";
import { runHealthChecks } from "../src/health-check.mjs";
import { createRun, manifestPathForRun, readManifest, runDirectory, updateManifest } from "../src/manifest.mjs";
import { PaperclipClient } from "../src/paperclip-client.mjs";
import { appendBugsToDoc, bugBatch, buildTelegramSummary, writeAcceptance, writeBugsJsonl, writeReport } from "../src/report-writer.mjs";
import { createRetestRun, executeRetestRun, executeSuite, runSuite } from "../src/suite-runner.mjs";
import { TelegramUserbot, TelegramUserbotError } from "../src/telegram-userbot.mjs";

const PROJECT_ROOT = process.cwd();
const COMPLETION_CHECKLIST_PATH = path.join(PROJECT_ROOT, "docs", "telegram-testing", "TELEGRAM_QA_COMPLETION_CHECKLIST.json");

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
    kind: "",
    notify: "",
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
    else if (arg === "--kind") options.kind = tail[++index] || "";
    else if (arg === "--notify") options.notify = tail[++index] || "";
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
  node paperclip-qa-tool/bin/paperclip-qa.mjs live-plan --config FILE --suite NAME [--cleanup hard|soft|none] [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs readiness --config FILE --suite NAME [--cleanup hard|soft|none] [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs release-plan --config FILE [--cleanup hard|soft|none] [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs completion-check --config FILE [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs run-start --config FILE --suite NAME [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs run --config FILE --suite NAME [--cleanup hard|soft|none] [--notify telegram] [--json] [--dry-run|--live-ok]
  node paperclip-qa-tool/bin/paperclip-qa.mjs manifest-show --config FILE --run RUN_ID [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs cleanup --config FILE --run RUN_ID --mode hard|soft|none --live-ok [--json] [--dry-run]
  node paperclip-qa-tool/bin/paperclip-qa.mjs report --config FILE --run RUN_ID [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs summary --config FILE --run RUN_ID [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs notify --config FILE --run RUN_ID --kind result --live-ok [--json]
  node paperclip-qa-tool/bin/paperclip-qa.mjs acceptance --config FILE --run RUN_ID [--json]
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
        cleanupRunWaitAttempts: config.paperclip.cleanupRunWaitAttempts,
        cleanupRunWaitDelayMs: config.paperclip.cleanupRunWaitDelayMs,
      },
      artifacts: {
        dir: config.artifacts.dir,
      },
      guards: {
        allowWarnings: config.guards.allowWarnings,
        postSuiteHealth: config.guards.postSuiteHealth,
      },
      reporting: {
        telegram: config.reporting.telegram,
      },
    },
    suites: suiteSummary(config),
  };
}

function completionSummary() {
  const checklist = JSON.parse(fs.readFileSync(COMPLETION_CHECKLIST_PATH, "utf8"));
  const requirements = Array.isArray(checklist.requirements) ? checklist.requirements : [];
  const byStatus = {};
  for (const item of requirements) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }
  const blockingRequirements = Array.isArray(checklist.blocksCompletion) ? checklist.blocksCompletion : [];
  const requirementById = new Map(requirements.map((item) => [item.id, item]));
  return {
    ok: true,
    complete: blockingRequirements.length === 0 && requirements.every((item) => item.status === "proven"),
    goal: checklist.goal,
    overallStatus: checklist.overallStatus,
    checklistPath: path.relative(PROJECT_ROOT, COMPLETION_CHECKLIST_PATH),
    blockingRequirements,
    blockingActions: blockingRequirements.map((id) => {
      const item = requirementById.get(id) || {};
      return {
        id,
        remainingEvidence: item.remainingEvidence || "",
        ...(item.nextAction || {}),
      };
    }),
    summary: {
      total: requirements.length,
      proven: byStatus.proven || 0,
      partial: byStatus.partial || 0,
      missingLiveEvidence: byStatus["missing-live-evidence"] || 0,
    },
    requirements: requirements.map((item) => ({
      id: item.id,
      status: item.status,
      remainingEvidence: item.remainingEvidence || "",
    })),
  };
}

function releasePlan({ configPath, config, cleanupMode }) {
  const cleanup = cleanupMode || config.paperclip.cleanup;
  if (!["hard", "soft", "none"].includes(cleanup)) throw new ConfigValidationError(["--cleanup must be hard, soft, or none"]);
  const base = "node paperclip-qa-tool/bin/paperclip-qa.mjs";
  const quotedConfig = shellQuote(configPath);
  const quotedCleanup = shellQuote(cleanup);
  const notify = notifyArgument(config);
  const suites = Object.entries(config.suites)
    .filter(([, suite]) => (suite.tests || []).some((test) => (test.kind || "telegram") === "telegram"))
    .map(([name]) => name);
  return {
    ok: true,
    cleanup,
    suites,
    preflightCommands: [
      `${base} completion-check --config ${quotedConfig} --json`,
      ...suites.map((suite) => `${base} readiness --config ${quotedConfig} --suite ${shellQuote(suite)} --cleanup ${quotedCleanup} --json`),
    ],
    acknowledgement: "This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?",
    liveCommands: suites.map((suite) => `${base} run --config ${quotedConfig} --suite ${shellQuote(suite)} --cleanup ${quotedCleanup}${notify} --live-ok --json`),
    postRunCommands: [
      `${base} report --config ${quotedConfig} --run QA-... --json`,
      `${base} acceptance --config ${quotedConfig} --run QA-... --json`,
      `${base} bug-batch --config ${quotedConfig} --run QA-... --json`,
      `${base} completion-check --config ${quotedConfig} --json`,
    ],
  };
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function livePlan({ configPath, config, suiteName, cleanupMode }) {
  const suite = config.suites[suiteName];
  if (!suite) throw new ConfigValidationError([`suite not found: ${suiteName}`]);
  const cleanup = cleanupMode || config.paperclip.cleanup;
  if (!["hard", "soft", "none"].includes(cleanup)) throw new ConfigValidationError(["--cleanup must be hard, soft, or none"]);
  const base = "node paperclip-qa-tool/bin/paperclip-qa.mjs";
  const quotedConfig = shellQuote(configPath);
  const quotedSuite = shellQuote(suiteName);
  const quotedCleanup = shellQuote(cleanup);
  const notify = notifyArgument(config);
  return {
    ok: true,
    suite: suiteName,
    cleanup,
    target: config.telegram.target,
    paperclip: {
      apiBase: config.paperclip.apiBase,
      company: config.paperclip.company,
    },
    tests: suite.tests.map((test) => ({ id: test.id, kind: test.kind || "telegram", message: test.message || "" })),
    guardWarnings: config.guards.allowWarnings,
    commands: {
      configCheck: `${base} config-check --config ${quotedConfig} --json`,
      health: `${base} health --config ${quotedConfig} --json`,
      dryRun: `${base} run --config ${quotedConfig} --suite ${quotedSuite} --cleanup ${quotedCleanup} --dry-run --json`,
      liveRun: `${base} run --config ${quotedConfig} --suite ${quotedSuite} --cleanup ${quotedCleanup}${notify} --live-ok --json`,
    },
    acknowledgement: "This will send Telegram messages and may create Paperclip issues. Cleanup will run with hard-delete-first and soft fallback. Proceed?",
  };
}

function notifyArgument(config) {
  return config.reporting?.telegram?.enabled && config.reporting?.telegram?.sendResult
    ? " --notify telegram"
    : "";
}

function shouldNotifyTelegram(config, options) {
  if (options.notify) {
    if (options.notify !== "telegram") throw new ConfigValidationError(["--notify must be telegram"]);
    return true;
  }
  return Boolean(config.reporting?.telegram?.enabled && config.reporting?.telegram?.sendResult);
}

function suitePreview({ config, suiteName, cleanupMode }) {
  const suite = config.suites[suiteName];
  if (!suite) throw new ConfigValidationError([`suite not found: ${suiteName}`]);
  const cleanup = cleanupMode || config.paperclip.cleanup;
  if (!["hard", "soft", "none"].includes(cleanup)) throw new ConfigValidationError(["--cleanup must be hard, soft, or none"]);
  return {
    suite: suiteName,
    cleanup,
    plannedTests: suite.tests.map((test) => test.id),
    tests: suite.tests.map((test) => ({
      id: test.id,
      kind: test.kind || "telegram",
      message: test.message || "",
      expect: test.expect || {},
    })),
  };
}

async function readiness({ configPath, config, suiteName, cleanupMode, userbot, paperclipClient }) {
  const plan = livePlan({ configPath, config, suiteName, cleanupMode });
  const health = await runHealthChecks({ config, userbot, paperclipClient });
  const preview = suitePreview({ config, suiteName, cleanupMode });
  const gates = [
    { name: "config", ok: true },
    { name: "health", ok: health.ok },
    { name: "suite", ok: preview.plannedTests.length > 0 },
    { name: "live-acknowledgement", ok: Boolean(plan.acknowledgement) },
    { name: "no-live-side-effects", ok: true },
  ];
  const readyForLive = gates.every((gate) => gate.ok);
  return {
    ok: readyForLive,
    readyForLive,
    suite: suiteName,
    cleanup: preview.cleanup,
    health,
    preview,
    livePlan: plan,
    gates,
  };
}

async function runCleanupForManifest({ config, manifestPath, mode, dryRun = false }) {
  return cleanupRun({
    manifestPath,
    mode,
    dryRun,
    runWaitAttempts: config.paperclip.cleanupRunWaitAttempts,
    runWaitDelayMs: config.paperclip.cleanupRunWaitDelayMs,
    client: new PaperclipClient({ apiBase: config.paperclip.apiBase }),
    userbot: new TelegramUserbot({ config }),
  });
}

function writeRunArtifacts({ config, runId, manifestPath }) {
  const manifest = readManifest(manifestPath);
  const outputDir = runDirectory({ artifactsDir: config.artifacts.dir, runId });
  const report = writeReport({ manifest, outputDir });
  const bugs = writeBugsJsonl({ manifest, outputDir });
  const acceptance = writeAcceptance({ manifest, outputDir });
  return {
    reportPath: report.reportPath,
    acceptancePath: acceptance.acceptancePath,
    decision: acceptance.decision,
    reasons: acceptance.reasons,
    bugsPath: bugs.bugsPath,
    bugs: bugs.bugs.length,
  };
}

function beforeSuiteHealthGuard({ config, suite }) {
  if (!shouldRunSuiteHealthGuard({ config, suite })) return null;
  return ({ manifest, manifestPath }) => runSuiteHealthGuard({
    config,
    manifest,
    manifestPath,
    phase: "before",
  });
}

function runAfterSuiteHealthGuard({ config, suite, manifestPath }) {
  const manifest = readManifest(manifestPath);
  if (!shouldRunSuiteHealthGuard({ config, suite, manifest })) return null;
  const guardAfter = runSuiteHealthGuard({
    config,
    manifest,
    manifestPath,
    phase: "after",
  });
  updateManifest(manifestPath, (current) => ({ ...current, guardAfter }));
  return guardAfter;
}

function summarizeRun({ config, runId }) {
  const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId });
  const manifest = readManifest(manifestPath);
  const outputDir = runDirectory({ artifactsDir: config.artifacts.dir, runId });
  writeReport({ manifest, outputDir });
  writeBugsJsonl({ manifest, outputDir });
  writeAcceptance({ manifest, outputDir });
  const summary = buildTelegramSummary({ manifest, outputDir });
  return {
    ok: true,
    runId,
    manifestPath,
    ...summary,
  };
}

function recordTelegramNotification({ config, runId, notification }) {
  const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId });
  updateManifest(manifestPath, (manifest) => ({
    ...manifest,
    reporting: {
      ...(manifest.reporting || {}),
      telegram: [
        ...((manifest.reporting || {}).telegram || []),
        notification,
      ],
    },
  }));
}

function notifyRunSummary({ config, runId, kind, userbot }) {
  const summary = summarizeRun({ config, runId });
  const result = userbot.notify({ text: summary.text });
  const notification = {
    kind: kind || "result",
    transport: "userbot",
    retained: true,
    messageId: result.sent_id ?? result.sentId ?? null,
    target: result.target || config.telegram.target,
    sentAt: new Date().toISOString(),
  };
  recordTelegramNotification({ config, runId, notification });
  return {
    ...summary,
    notification,
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
  if (options.command === "completion-check") {
    printPayload(completionSummary(), options.json);
    return 0;
  }
  if (options.command === "release-plan") {
    printPayload(releasePlan({ configPath: options.config, config, cleanupMode: options.cleanup }), options.json);
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
  if (options.command === "live-plan") {
    if (!options.suite) throw new ConfigValidationError(["--suite is required"]);
    printPayload(livePlan({ configPath: options.config, config, suiteName: options.suite, cleanupMode: options.cleanup }), options.json);
    return 0;
  }
  if (options.command === "readiness") {
    if (!options.suite) throw new ConfigValidationError(["--suite is required"]);
    const result = await readiness({
      configPath: options.config,
      config,
      suiteName: options.suite,
      cleanupMode: options.cleanup,
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
    const suite = config.suites[options.suite];
    const result = options.dryRun
      ? runSuite({ config, suiteName: options.suite, dryRun: true, cleanupMode: options.cleanup })
      : await executeSuite({
        config,
        suiteName: options.suite,
        cleanupMode: options.cleanup,
        userbot: new TelegramUserbot({ config }),
        paperclipClient: new PaperclipClient({ apiBase: config.paperclip.apiBase }),
        beforeSuite: beforeSuiteHealthGuard({ config, suite }),
      });
    if (!options.dryRun && result.cleanup !== "none" && !result.blockedBeforeSuite) {
      const cleanupResult = await runCleanupForManifest({
        config,
        manifestPath: result.manifestPath,
        mode: result.cleanup,
      });
      result.cleanup = cleanupResult.cleanup;
      result.ok = result.ok && cleanupResult.ok;
    }
    if (!options.dryRun && !result.blockedBeforeSuite) {
      const guardAfter = runAfterSuiteHealthGuard({ config, suite, manifestPath: result.manifestPath });
      if (guardAfter) {
        result.guardAfter = guardAfter;
        result.ok = result.ok && guardAfter.ok;
      }
    }
    if (!options.dryRun) {
      Object.assign(result, writeRunArtifacts({ config, runId: result.runId, manifestPath: result.manifestPath }));
      if (shouldNotifyTelegram(config, options)) {
        const notification = notifyRunSummary({
          config,
          runId: result.runId,
          kind: "result",
          userbot: new TelegramUserbot({ config }),
        });
        result.notification = notification.notification;
        result.summary = notification.summary;
      }
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
    if (!options.dryRun && !options.liveOk) throw new ConfigValidationError(["--live-ok is required for cleanup"]);
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
  if (options.command === "summary") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    printPayload(summarizeRun({ config, runId: options.run }), options.json);
    return 0;
  }
  if (options.command === "notify") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    if (!options.liveOk) throw new ConfigValidationError(["--live-ok is required for notify"]);
    const result = notifyRunSummary({
      config,
      runId: options.run,
      kind: options.kind || "result",
      userbot: new TelegramUserbot({ config }),
    });
    printPayload(result, options.json);
    return 0;
  }
  if (options.command === "acceptance") {
    if (!options.run) throw new ConfigValidationError(["--run is required"]);
    const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId: options.run });
    const manifest = readManifest(manifestPath);
    const outputDir = runDirectory({ artifactsDir: config.artifacts.dir, runId: options.run });
    const acceptance = writeAcceptance({ manifest, outputDir });
    printPayload({ ok: true, runId: options.run, manifestPath, ...acceptance }, options.json);
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
      if (shouldNotifyTelegram(config, options)) {
        const notification = notifyRunSummary({
          config,
          runId: result.runId,
          kind: "result",
          userbot: new TelegramUserbot({ config }),
        });
        result.notification = notification.notification;
        result.summary = notification.summary;
      }
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
