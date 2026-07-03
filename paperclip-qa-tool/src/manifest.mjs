import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function pad(value) {
  return String(value).padStart(2, "0");
}

export function createRunId({ suite, now = new Date(), random = crypto.randomUUID() } = {}) {
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
  ].join("");
  const safeSuite = String(suite || "run")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "run";
  const suffix = String(random).replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase() || "run";
  return `QA-${stamp}-${safeSuite}-${suffix}`;
}

export function runDirectory({ artifactsDir, runId }) {
  return path.resolve(String(artifactsDir || "artifacts/telegram-test-runs"), runId);
}

export function manifestPathForRun({ artifactsDir, runId }) {
  return path.join(runDirectory({ artifactsDir, runId }), "manifest.json");
}

export function writeManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, manifestPath);
}

export function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function updateManifest(manifestPath, updater) {
  const current = readManifest(manifestPath);
  const next = updater(current) || current;
  writeManifest(manifestPath, next);
  return next;
}

export function createInitialManifest({ config, suite, runId = createRunId({ suite }), now = new Date() }) {
  return {
    runId,
    suite,
    startedAt: now.toISOString(),
    finishedAt: null,
    telegram: {
      target: config.telegram.target,
      userId: null,
      chatId: null,
      messages: [],
    },
    paperclip: {
      apiBase: config.paperclip.apiBase,
      company: config.paperclip.company,
      companyId: null,
      roots: [],
      issues: [],
    },
    tests: [],
    bugs: [],
    cleanup: {
      mode: config.paperclip.cleanup,
      attemptedAt: null,
      telegram: [],
      paperclip: [],
      residuals: [],
    },
  };
}

export function createRun({ config, suite }) {
  const runId = createRunId({ suite });
  const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId });
  const manifest = createInitialManifest({ config, suite, runId });
  writeManifest(manifestPath, manifest);
  return { runId, manifestPath, manifest };
}
