import { ConfigValidationError } from "./config.mjs";
import { createRun, writeManifest } from "./manifest.mjs";
import { evaluateTest } from "./evaluator.mjs";
import { bugsFromManifest } from "./report-writer.mjs";

function plannedTest(test) {
  return {
    id: test.id,
    message: test.message || "",
    kind: test.kind || "telegram",
    status: "planned",
    dryRun: true,
    expect: test.expect || {},
  };
}

export function runSuite({ config, suiteName, dryRun = false, cleanupMode = "" }) {
  const suite = config.suites[suiteName];
  if (!suite) throw new ConfigValidationError([`suite not found: ${suiteName}`]);
  const mode = cleanupMode || config.paperclip.cleanup;
  if (!["hard", "soft", "none"].includes(mode)) throw new ConfigValidationError(["--cleanup must be hard, soft, or none"]);

  const run = createRun({ config, suite: suiteName });
  const manifest = {
    ...run.manifest,
    cleanup: {
      ...run.manifest.cleanup,
      mode,
    },
  };

  if (!dryRun) {
    throw new ConfigValidationError(["live run is not implemented yet; use --dry-run"]);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.tests = suite.tests.map(plannedTest);
  writeManifest(run.manifestPath, manifest);

  return {
    ok: true,
    dryRun: true,
    runId: run.runId,
    manifestPath: run.manifestPath,
    suite: suiteName,
    cleanup: mode,
    plannedTests: manifest.tests.map((test) => test.id),
  };
}

function issueIds(issues) {
  return new Set((issues || []).map((issue) => issue.id).filter(Boolean));
}

function rootIssues(issues) {
  return (issues || []).filter((issue) => !issue.parentId);
}

function normalizeTelegramMessage(message, testId) {
  return {
    messageId: message.id ?? message.messageId,
    direction: message.out ? "out" : "in",
    date: message.date || "",
    text: message.text || message.message || "",
    testId,
    ...(Array.isArray(message.buttons) ? { buttons: message.buttons } : {}),
  };
}

function replyText(messages) {
  return (messages || [])
    .filter((message) => !message.out)
    .map((message) => message.text || message.message || "")
    .join("\n");
}

function messageButtons(messages) {
  return (messages || []).flatMap((message) => Array.isArray(message.buttons) ? message.buttons : []);
}

export async function executeSuite({ config, suiteName, userbot, paperclipClient, cleanupMode = "", now = new Date() }) {
  const suite = config.suites[suiteName];
  if (!suite) throw new ConfigValidationError([`suite not found: ${suiteName}`]);
  const mode = cleanupMode || config.paperclip.cleanup;
  if (!["hard", "soft", "none"].includes(mode)) throw new ConfigValidationError(["--cleanup must be hard, soft, or none"]);

  const run = createRun({ config, suite: suiteName });
  const manifest = {
    ...run.manifest,
    cleanup: {
      ...run.manifest.cleanup,
      mode,
    },
  };

  const company = await paperclipClient.findCompanyByName(config.paperclip.company);
  if (!company) throw new ConfigValidationError([`paperclip company not found: ${config.paperclip.company}`]);
  manifest.paperclip.companyId = company.id;
  const before = await paperclipClient.listIssues(company.id);
  const beforeIds = issueIds(before);

  for (const test of suite.tests) {
    const sent = userbot.send({
      text: test.message || "",
      wait: test.waitSeconds ?? 8,
      limit: test.limit ?? 20,
    });
    const telegramMessages = (sent.messages || []).map((message) => normalizeTelegramMessage(message, test.id));
    manifest.telegram.messages.push(...telegramMessages);

    const after = await paperclipClient.listIssues(company.id);
    const newIssues = after.filter((issue) => issue.id && !beforeIds.has(issue.id));
    const newRootIds = new Set(rootIssues(newIssues).map((issue) => issue.id));
    for (const issue of newIssues) {
      if (!manifest.paperclip.issues.some((existing) => existing.id === issue.id)) {
        manifest.paperclip.issues.push({ ...issue, testId: test.id, matchedBy: "snapshot" });
      }
    }
    for (const issue of rootIssues(newIssues)) {
      if (!manifest.paperclip.roots.some((existing) => existing.id === issue.id)) {
        manifest.paperclip.roots.push({ ...issue, testId: test.id, matchedBy: "snapshot" });
      }
    }

    const evaluation = evaluateTest({
      test,
      observed: {
        ok: true,
        replyText: replyText(sent.messages || []),
        messages: sent.messages || [],
        buttons: messageButtons(sent.messages || []),
        paperclipRootsCreated: newRootIds.size,
        rootsCreated: rootIssues(newIssues),
      },
    });
    manifest.tests.push({
      id: test.id,
      message: test.message || "",
      status: evaluation.status,
      checks: evaluation.checks,
      observed: {
        sentId: sent.sent_id,
        paperclipRootsCreated: newRootIds.size,
      },
    });
  }

  manifest.bugs = bugsFromManifest(manifest);
  manifest.finishedAt = now.toISOString();
  writeManifest(run.manifestPath, manifest);
  return {
    ok: manifest.tests.every((test) => test.status === "pass"),
    dryRun: false,
    runId: run.runId,
    manifestPath: run.manifestPath,
    suite: suiteName,
    cleanup: mode,
    tests: manifest.tests.map((test) => ({ id: test.id, status: test.status })),
    bugs: manifest.bugs.length,
  };
}

export function createRetestRun({ config, previousManifest, dryRun = false, cleanupMode = "" }) {
  const mode = cleanupMode || previousManifest.cleanup?.mode || config.paperclip.cleanup;
  if (!["hard", "soft", "none"].includes(mode)) throw new ConfigValidationError(["--cleanup must be hard, soft, or none"]);
  if (!dryRun) {
    throw new ConfigValidationError(["live retest is not implemented yet; use --dry-run"]);
  }

  const failed = (Array.isArray(previousManifest.tests) ? previousManifest.tests : []).filter((test) => test.status === "fail");
  const run = createRun({ config, suite: `${previousManifest.suite || "suite"}-retest` });
  const manifest = {
    ...run.manifest,
    suite: previousManifest.suite,
    previousRunId: previousManifest.runId,
    finishedAt: new Date().toISOString(),
    cleanup: {
      ...run.manifest.cleanup,
      mode,
    },
    tests: failed.map((test) => ({
      id: test.id,
      message: test.message || "",
      status: "planned",
      dryRun: true,
      previousStatus: test.status,
    })),
  };
  writeManifest(run.manifestPath, manifest);
  return {
    ok: true,
    dryRun: true,
    previousRunId: previousManifest.runId,
    runId: run.runId,
    manifestPath: run.manifestPath,
    selectedTests: manifest.tests.map((test) => test.id),
  };
}
