import { spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_GUARD_ARGS = ["scripts/inner-agora-guard.mjs", "--json"];

function numericExpectation(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function suiteCreatesWork(suite) {
  return (suite?.tests || []).some((test) => {
    const expect = test.expect || {};
    return numericExpectation(expect.paperclipRootsCreated) > 0
      || numericExpectation(expect.paperclipRootsCreatedAtLeast) > 0;
  });
}

export function manifestCreatedWork(manifest) {
  if ((manifest?.paperclip?.issues || []).length > 0) return true;
  if ((manifest?.paperclip?.roots || []).length > 0) return true;
  return (manifest?.tests || []).some((test) => numericExpectation(test?.observed?.paperclipRootsCreated) > 0);
}

export function postSuiteHealthConfig(config) {
  return config?.guards?.postSuiteHealth || {};
}

export function shouldRunSuiteHealthGuard({ config, suite, manifest } = {}) {
  const guard = postSuiteHealthConfig(config);
  if (!guard.enabled) return false;
  const runFor = guard.runFor || "work-creating";
  if (runFor === "always") return true;
  if (manifest) return manifestCreatedWork(manifest) || suiteCreatesWork(suite);
  return suiteCreatesWork(suite);
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function excerpt(value) {
  return String(value || "").slice(0, 4000);
}

function compactGuardResult(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    ok: data.ok === true,
    changed: data.changed === true,
    profileName: data.profileName || "",
    events: Array.isArray(data.events) ? data.events : [],
    paperclip: data.paperclip || null,
    agents: data.agents || null,
    gateway: data.gateway || null,
    monitor: data.monitor || null,
    telegram: data.telegram || null,
  };
}

export function runSuiteHealthGuard({
  config,
  manifest,
  manifestPath,
  phase,
  now = new Date(),
  cwd = process.cwd(),
} = {}) {
  const guard = postSuiteHealthConfig(config);
  const command = guard.command || process.execPath;
  const args = Array.isArray(guard.args) ? guard.args.map(String) : DEFAULT_GUARD_ARGS;
  const timeoutMs = Number.isFinite(Number(guard.timeoutMs)) ? Number(guard.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const startedAt = now.toISOString();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PAPERCLIP_QA_GUARD_PHASE: phase || "",
      PAPERCLIP_QA_RUN_ID: manifest?.runId || "",
      PAPERCLIP_QA_SUITE: manifest?.suite || "",
      PAPERCLIP_QA_MANIFEST_PATH: manifestPath || "",
    },
  });
  const finishedAt = new Date().toISOString();
  const data = parseJson(String(result.stdout || "").trim());
  const error = result.error?.message || "";
  const ok = result.status === 0 && data?.ok === true;
  return {
    phase: phase || "",
    ok,
    startedAt,
    finishedAt,
    command: [command, ...args],
    status: result.status,
    signal: result.signal || "",
    timeoutMs,
    result: compactGuardResult(data),
    stdoutExcerpt: excerpt(result.stdout),
    stderrExcerpt: excerpt(result.stderr || error),
    ...(data ? {} : { error: "guard output was not valid JSON" }),
  };
}
