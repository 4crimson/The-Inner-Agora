import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function resolveQaArtifactsDir({
  telegramQa = {},
  rootQa = {},
  cwd = process.cwd(),
  defaultRelative = "artifacts/telegram-test-runs",
} = {}) {
  const configured =
    telegramQa?.artifacts_dir ||
    telegramQa?.artifactsDir ||
    rootQa?.artifacts_dir ||
    rootQa?.artifactsDir;
  const raw = String(configured || defaultRelative).trim();
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

export function latestQaRun(artifactsDir) {
  if (!fs.existsSync(artifactsDir)) return null;
  const runs = fs
    .readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runDir = path.join(artifactsDir, entry.name);
      const manifestPath = path.join(runDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) return null;
      try {
        const manifest = readJson(manifestPath);
        const stat = fs.statSync(manifestPath);
        return { dir: runDir, manifest, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return runs[0] || null;
}

export function qaTests(manifest) {
  if (Array.isArray(manifest?.tests)) return manifest.tests;
  if (Array.isArray(manifest?.results)) return manifest.results;
  return [];
}

export function qaBugs(run) {
  if (!run) return [];
  const bugsPath = path.join(run.dir, "bugs.jsonl");
  if (fs.existsSync(bugsPath)) {
    const bugs = fs
      .readFileSync(bugsPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { title: line };
        }
      });
    if (bugs.length) return bugs;
  }
  return Array.isArray(run.manifest?.bugs) ? run.manifest.bugs : [];
}

export function qaCounts(manifest) {
  const tests = qaTests(manifest);
  const passedStatuses = new Set(["pass", "passed", "ok", "success", "succeeded"]);
  const failedStatuses = new Set(["fail", "failed", "error", "blocked", "timed_out", "timeout"]);
  const passed = tests.filter((test) => passedStatuses.has(String(test?.status || "").toLowerCase())).length;
  const failed = tests.filter((test) => failedStatuses.has(String(test?.status || "").toLowerCase())).length;
  const total =
    tests.length ||
    Number(manifest?.counts?.total || manifest?.summary?.total || manifest?.total || manifest?.planned || 0) ||
    0;
  return { total, passed, failed, tests };
}

export function qaStatusWord(counts, bugs) {
  if (counts.failed > 0 || bugs.length > 0) return "FAIL";
  if (counts.total > 0 && counts.passed >= counts.total) return "PASS";
  if (counts.total > 0) return "RUNNING";
  return "UNKNOWN";
}

export function qaCleanupWord(manifest) {
  const cleanup = manifest?.cleanup;
  if (!cleanup) return "unknown";
  const residuals = Array.isArray(cleanup?.residuals) ? cleanup.residuals : [];
  if (residuals.length) return `residuals ${residuals.length}`;
  if (Array.isArray(cleanup)) {
    const failed = cleanup.filter((item) => String(item?.status || "").toLowerCase() === "failed");
    return failed.length ? `failed ${failed.length}` : "clean";
  }
  if (String(cleanup?.status || "").toLowerCase() === "failed") return "failed";
  return "clean";
}
