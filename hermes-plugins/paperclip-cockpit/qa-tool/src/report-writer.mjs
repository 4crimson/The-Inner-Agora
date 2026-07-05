import fs from "node:fs";
import path from "node:path";

const TELEGRAM_TOKEN_RE = /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g;
const API_HASH_RE = /\b[a-f0-9]{32}\b/gi;

export function redact(value) {
  return String(value ?? "")
    .replace(TELEGRAM_TOKEN_RE, "[redacted:telegram-token]")
    .replace(API_HASH_RE, "[redacted:api-hash]");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function testCounts(manifest) {
  const tests = Array.isArray(manifest.tests) ? manifest.tests : [];
  return {
    total: tests.length,
    pass: tests.filter((test) => test.status === "pass").length,
    fail: tests.filter((test) => test.status === "fail").length,
    planned: tests.filter((test) => test.status === "planned").length,
  };
}

function guardFailures(manifest) {
  return [
    manifest.guardBefore?.ok === false ? "pre-suite-guard" : "",
    manifest.guardAfter?.ok === false ? "post-suite-guard" : "",
  ].filter(Boolean);
}

function statusForSummary({ counts, bugs, residuals, guardFailures: failedGuards = [] }) {
  const blockingBugs = bugs.filter((bug) => bug.severity === "P0" || bug.severity === "P1");
  if (counts.planned > 0 && counts.pass === 0 && counts.fail === 0) return "BLOCKED";
  if (counts.fail > 0 || residuals.length > 0 || blockingBugs.length > 0 || failedGuards.length > 0) return "FAIL";
  return "PASS";
}

function compactObjectSummary(value) {
  const entries = Object.entries(value || {});
  if (!entries.length) return "none";
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

function topFinding({ status, bugs, residuals, guardFailures: failedGuards = [] }) {
  if (failedGuards.length) return `health guard failed: ${failedGuards.join(", ")}`;
  if (residuals.length) return `cleanup residuals: ${residuals.length}`;
  if (bugs.length) return `${bugs[0].area || "unknown"} ${bugs[0].severity || "P2"}: ${bugs[0].title || bugs[0].testId}`;
  if (status === "PASS") return "критичных проблем не найдено";
  return "run blocked before acceptance";
}

function nextStep({ status, bugs, residuals, guardFailures: failedGuards = [] }) {
  if (status === "PASS") return "live suite complete";
  if (failedGuards.length) return "developer batch: post-suite health";
  if (status === "BLOCKED") return "readiness or live approval";
  if (residuals.length) return "developer batch: cleanup";
  const firstP1 = bugs.find((bug) => bug.severity === "P0" || bug.severity === "P1") || bugs[0];
  if (firstP1?.area) return `developer batch: ${firstP1.area}`;
  return "retest failed ids";
}

function failedTests(manifest) {
  return (Array.isArray(manifest.tests) ? manifest.tests : []).filter((test) => test.status === "fail");
}

function checkLine(check) {
  const actual = check.actual === undefined ? "" : ` actual=${redact(JSON.stringify(check.actual))}`;
  return `  - ${check.ok ? "ok" : "fail"} ${check.name}${actual}`;
}

export function writeReport({ manifest, outputDir }) {
  ensureDir(outputDir);
  const counts = testCounts(manifest);
  const residuals = Array.isArray(manifest.cleanup?.residuals) ? manifest.cleanup.residuals : [];
  const lines = [
    `# QA Report: ${manifest.runId}`,
    "",
    `Suite: ${manifest.suite}`,
    `Started: ${manifest.startedAt || ""}`,
    `Finished: ${manifest.finishedAt || ""}`,
    "",
    "## Summary",
    "",
    `Total: ${counts.total}`,
    `Pass: ${counts.pass}`,
    `Fail: ${counts.fail}`,
    `Planned: ${counts.planned}`,
    "",
    "## Failed Tests",
    "",
  ];

  const failures = failedTests(manifest);
  if (!failures.length) {
    lines.push("None", "");
  } else {
    for (const test of failures) {
      lines.push(`- ${test.id}: ${redact(test.message || "")}`);
      for (const check of test.checks || []) lines.push(checkLine(check));
      if (test.observed?.replyText) lines.push(`  evidence: ${redact(test.observed.replyText)}`);
      lines.push("");
    }
  }

  lines.push("## Cleanup", "");
  lines.push(`Mode: ${manifest.cleanup?.mode || ""}`);
  if (!residuals.length) {
    lines.push("Residuals: none");
  } else {
    lines.push("Residuals:");
    for (const residual of residuals) {
      lines.push(`- ${redact(residual.kind || "item")} ${redact(residual.id || "")}: ${redact(residual.reason || "")}`);
    }
  }
  lines.push("");

  const reportPath = path.join(outputDir, "REPORT.md");
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return { reportPath, counts };
}

export function bugsFromManifest(manifest) {
  return failedTests(manifest).map((test) => ({
    id: `${manifest.runId}:${test.id}`,
    runId: manifest.runId,
    suite: manifest.suite,
    testId: test.id,
    title: `QA failure: ${test.id}`,
    severity: inferSeverity(test),
    area: inferArea(test),
    symptom: test.message || "",
    expected: failedCheckNames(test).join(", "),
    actual: redact(test.observed?.replyText || ""),
    evidence: {
      telegramMessageIds: [test.observed?.sentId].filter(Boolean),
      paperclipIssueRefs: [],
      logSnippets: [],
      transcript: redact(test.observed?.replyText || ""),
    },
    failedChecks: (test.checks || []).filter((check) => !check.ok).map((check) => check.name),
    acceptanceCriteria: [`${test.id} passes on retest`],
  }));
}

export function writeBugsJsonl({ manifest, outputDir }) {
  ensureDir(outputDir);
  const bugsById = new Map();
  for (const bug of [...bugsFromManifest(manifest), ...(Array.isArray(manifest.bugs) ? manifest.bugs : [])]) {
    bugsById.set(bug.id, bug);
  }
  const bugs = [...bugsById.values()];
  const bugsPath = path.join(outputDir, "bugs.jsonl");
  fs.writeFileSync(bugsPath, bugs.map((bug) => JSON.stringify(bug)).join("\n") + (bugs.length ? "\n" : ""), "utf8");
  return { bugsPath, bugs };
}

export function appendBugsToDoc({ bugs, docPath, dryRun = false }) {
  if (!docPath) return null;
  const lines = ["## QA Bug Batch", ""];
  for (const bug of bugs) {
    lines.push(`- ${bug.testId}: ${redact(bug.title)}`);
  }
  lines.push("");
  const preview = lines.join("\n");
  if (!dryRun) {
    fs.mkdirSync(path.dirname(path.resolve(docPath)), { recursive: true });
    fs.appendFileSync(docPath, preview, "utf8");
  }
  return { docPath: path.resolve(docPath), dryRun, preview };
}

function failedCheckNames(test) {
  return (test.checks || []).filter((check) => !check.ok).map((check) => check.name);
}

function inferArea(test) {
  const checks = new Set(failedCheckNames(test));
  if (String(test.id || "").includes("cleanup") || test.kind === "cleanup") return "cleanup";
  if (checks.has("localRouteContains")) return "local-model";
  if (checks.has("paperclipRootsCreated") || checks.has("paperclipRootsCreatedAtLeast")) return "paperclip-recovery";
  if (checks.has("buttonsPresent") || checks.has("replyContains") || checks.has("replyNotContains") || checks.has("noRawTokens")) {
    return "telegram-ui";
  }
  return "unknown";
}

function inferSeverity(test) {
  const checks = new Set(failedCheckNames(test));
  if (checks.has("noRawTokens") || checks.has("replyNotContains")) return "P1";
  if (checks.has("paperclipRootsCreated") || checks.has("paperclipRootsCreatedAtLeast")) return "P1";
  if (checks.has("buttonsPresent") || checks.has("replyContains") || checks.has("localRouteContains")) return "P2";
  return "P3";
}

function normalizeSeverity(severity) {
  return ["P0", "P1", "P2", "P3"].includes(severity) ? severity : "P2";
}

function evidenceText(evidence) {
  if (typeof evidence === "string") return evidence;
  if (evidence && typeof evidence === "object") {
    return [
      ...(Array.isArray(evidence.logSnippets) ? evidence.logSnippets : []),
      evidence.transcript || "",
    ].filter(Boolean).join("\n");
  }
  return "";
}

function normalizedBug(bug) {
  return {
    id: bug.id,
    severity: normalizeSeverity(bug.severity),
    area: bug.area || "unknown",
    testId: bug.testId,
    title: bug.title || `QA failure: ${bug.testId}`,
    symptom: bug.symptom || bug.title || "",
    expected: bug.expected || "",
    actual: bug.actual || "",
    evidence: redact(evidenceText(bug.evidence)),
    failedChecks: Array.isArray(bug.failedChecks) ? bug.failedChecks : [],
    rootCauseHypothesis: bug.rootCauseHypothesis || "",
    acceptanceCriteria: Array.isArray(bug.acceptanceCriteria) ? bug.acceptanceCriteria : [],
  };
}

function countBy(bugs, key) {
  return bugs.reduce((counts, bug) => {
    const value = bug[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

export function bugBatch({ manifest, area }) {
  const explicit = Array.isArray(manifest.bugs) ? manifest.bugs : [];
  const explicitTestIds = new Set(explicit.map((bug) => bug.testId).filter(Boolean));
  const generated = bugsFromManifest(manifest)
    .filter((bug) => !explicitTestIds.has(bug.testId))
    .map((bug) => ({ ...bug, area: bug.area || "unknown" }));
  const bugs = [...explicit, ...generated].map(normalizedBug).filter((bug) => !area || bug.area === area);
  return {
    area: area || "all",
    summary: {
      total: bugs.length,
      byArea: countBy(bugs, "area"),
      bySeverity: countBy(bugs, "severity"),
    },
    bugs,
  };
}

export function writeAcceptance({ manifest, outputDir }) {
  ensureDir(outputDir);
  const batch = bugBatch({ manifest });
  const counts = testCounts(manifest);
  const residuals = Array.isArray(manifest.cleanup?.residuals) ? manifest.cleanup.residuals : [];
  const blockingBugs = batch.bugs.filter((bug) => bug.severity === "P0" || bug.severity === "P1");
  const failedGuards = guardFailures(manifest);
  const reasons = [];
  if (counts.fail > 0) reasons.push("failed-tests");
  if (residuals.length > 0) reasons.push("cleanup-residuals");
  reasons.push(...failedGuards);
  if (blockingBugs.length > 0) reasons.push("blocking-bugs");

  const decision = reasons.length
    ? "reject"
    : batch.bugs.length
      ? "accept-with-known-issues"
      : "accept";
  const lines = [
    `# Acceptance: ${manifest.runId}`,
    "",
    `Decision: ${decision}`,
    `Suite: ${manifest.suite}`,
    "",
    "## Test Counts",
    "",
    `Total: ${counts.total}`,
    `Pass: ${counts.pass}`,
    `Fail: ${counts.fail}`,
    `Planned: ${counts.planned}`,
    "",
    "## Bugs",
    "",
    `Total: ${batch.summary.total}`,
    `By area: ${JSON.stringify(batch.summary.byArea)}`,
    `By severity: ${JSON.stringify(batch.summary.bySeverity)}`,
    "",
    "## Cleanup",
    "",
    residuals.length ? `Residuals: ${residuals.length}` : "Residuals: none",
    "",
    "## Guards",
    "",
    `Before: ${manifest.guardBefore ? (manifest.guardBefore.ok ? "ok" : "failed") : "not-run"}`,
    `After: ${manifest.guardAfter ? (manifest.guardAfter.ok ? "ok" : "failed") : "not-run"}`,
    "",
  ];
  if (reasons.length) {
    lines.push("## Blocking Reasons", "");
    for (const reason of reasons) lines.push(`- ${reason}`);
    lines.push("");
  }

  const acceptancePath = path.join(outputDir, "ACCEPTANCE.md");
  fs.writeFileSync(acceptancePath, `${lines.join("\n")}\n`, "utf8");
  return {
    acceptancePath,
    decision,
    reasons,
    summary: {
      tests: counts,
      totalBugs: batch.summary.total,
      byArea: batch.summary.byArea,
      bySeverity: batch.summary.bySeverity,
      cleanupResiduals: residuals.length,
      guardFailures: failedGuards,
    },
  };
}

export function buildTelegramSummary({ manifest, outputDir }) {
  const counts = testCounts(manifest);
  const batch = bugBatch({ manifest });
  const bugs = batch.bugs;
  const residuals = Array.isArray(manifest.cleanup?.residuals) ? manifest.cleanup.residuals : [];
  const failedGuards = guardFailures(manifest);
  const status = statusForSummary({ counts, bugs, residuals, guardFailures: failedGuards });
  const reportPath = path.join(outputDir, "REPORT.md");
  const acceptancePath = path.join(outputDir, "ACCEPTANCE.md");
  const bugsPath = path.join(outputDir, "bugs.jsonl");
  const text = [
    `QA ${redact(manifest.suite || "suite")}: ${status}`,
    `Run: ${redact(manifest.runId || "")}`,
    "",
    `Проверки: ${counts.pass}/${counts.total} passed, ${counts.fail} failed`,
    `Баги: ${bugs.length} (${compactObjectSummary(batch.summary.byArea)}; ${compactObjectSummary(batch.summary.bySeverity)})`,
    `Cleanup: ${residuals.length ? `residuals ${residuals.length}` : "clean"}`,
    "",
    "Главное:",
    `- ${redact(topFinding({ status, bugs, residuals, guardFailures: failedGuards }))}`,
    "",
    "Артефакты:",
    `- REPORT.md: ${redact(reportPath)}`,
    `- ACCEPTANCE.md: ${redact(acceptancePath)}`,
    `- bugs.jsonl: ${redact(bugsPath)}`,
    "",
    `Следующий шаг: ${redact(nextStep({ status, bugs, residuals, guardFailures: failedGuards }))}`,
  ].join("\n");
  return {
    status,
    text,
    summary: {
      tests: counts,
      bugs: bugs.length,
      byArea: batch.summary.byArea,
      bySeverity: batch.summary.bySeverity,
      cleanupResiduals: residuals.length,
      guardFailures: failedGuards,
      nextStep: nextStep({ status, bugs, residuals, guardFailures: failedGuards }),
    },
  };
}
