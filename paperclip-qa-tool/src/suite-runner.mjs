import { ConfigValidationError } from "./config.mjs";
import { createRun, writeManifest } from "./manifest.mjs";

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
