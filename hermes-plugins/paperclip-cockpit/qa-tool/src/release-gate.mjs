import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { manifestPathForRun, readManifest, runDirectory } from "./manifest.mjs";
import { writeAcceptance } from "./report-writer.mjs";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function releaseGateId(now = new Date(), random = crypto.randomUUID()) {
  const suffix = String(random).replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase() || "gate";
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    "-",
    suffix,
  ].join("");
}

function guardStatus(guard) {
  if (!guard) return "not-run";
  return guard.ok ? "ok" : "failed";
}

function hasRepairEvidence(manifest) {
  return Boolean(
    manifest.guardAfter?.ok === false
      && manifest.guardRepeat?.ok === true
      && manifest.repairBackup
      && manifest.repairCommand,
  );
}

function profileSyncStatus(rawStatus) {
  const status = rawStatus || "missing";
  return {
    status,
    ok: status === "ok",
  };
}

function summarizeRun({ config, runId }) {
  const manifestPath = manifestPathForRun({ artifactsDir: config.artifacts.dir, runId });
  if (!fs.existsSync(manifestPath)) {
    return {
      runId,
      ok: false,
      manifestPath,
      acceptanceDecision: "missing",
      reasons: [`run-manifest-missing:${runId}`],
      guardBefore: "not-run",
      guardAfter: "not-run",
      guardRepeat: "not-run",
      cleanupResiduals: 0,
      activeRunsBeforeCleanup: 0,
      cancelledRuns: 0,
      repaired: false,
    };
  }

  const manifest = readManifest(manifestPath);
  const outputDir = runDirectory({ artifactsDir: config.artifacts.dir, runId });
  const acceptance = writeAcceptance({ manifest, outputDir });
  const repaired = hasRepairEvidence(manifest);
  const runReasons = [];
  const acceptanceReasons = repaired
    ? acceptance.reasons.filter((reason) => reason !== "post-suite-guard")
    : acceptance.reasons;

  for (const reason of acceptanceReasons) runReasons.push(`${reason}:${runId}`);
  if (!manifest.guardAfter) runReasons.push(`post-suite-guard-missing:${runId}`);

  return {
    runId,
    ok: runReasons.length === 0,
    suite: manifest.suite || "",
    manifestPath,
    acceptancePath: acceptance.acceptancePath,
    acceptanceDecision: acceptance.decision,
    reasons: runReasons,
    guardBefore: guardStatus(manifest.guardBefore),
    guardAfter: guardStatus(manifest.guardAfter),
    guardRepeat: guardStatus(manifest.guardRepeat),
    cleanupResiduals: acceptance.summary.cleanupResiduals,
    activeRunsBeforeCleanup: Array.isArray(manifest.cleanup?.activeRunsBeforeCleanup)
      ? manifest.cleanup.activeRunsBeforeCleanup.length
      : 0,
    cancelledRuns: Array.isArray(manifest.cleanup?.cancelledRuns)
      ? manifest.cleanup.cancelledRuns.length
      : 0,
    repaired,
    repairBackup: manifest.repairBackup || null,
    repairCommand: manifest.repairCommand || "",
  };
}

function releaseMarkdown(gate) {
  const lines = [
    `# Release Gate: ${gate.gateId}`,
    "",
    `Decision: ${gate.decision}`,
    `Backup: ${gate.backup.status}${gate.backup.id ? ` (${gate.backup.id})` : ""}`,
    `Profile/plugin sync: ${gate.profilePluginSync.status}`,
    "",
    "## Runs",
    "",
  ];

  if (!gate.runs.length) {
    lines.push("None", "");
  } else {
    for (const run of gate.runs) {
      lines.push(`- ${run.runId}: ${run.acceptanceDecision}`);
      lines.push(`  - Suite: ${run.suite || "unknown"}`);
      lines.push(`  - Guard before: ${run.guardBefore}`);
      lines.push(`  - Guard after: ${run.guardAfter}`);
      lines.push(`  - Guard repeat: ${run.guardRepeat}`);
      lines.push(`  - Cleanup residuals: ${run.cleanupResiduals}`);
      if (run.repaired) lines.push(`  - Repair: ${run.repairBackup} via ${run.repairCommand}`);
    }
    lines.push("");
  }

  if (gate.reasons.length) {
    lines.push("## Blocking Reasons", "");
    for (const reason of gate.reasons) lines.push(`- ${reason}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function writeReleaseGate({
  config,
  runIds = [],
  backupId = "",
  profilePluginSync = "",
  now = new Date(),
}) {
  const gateId = `RG-${releaseGateId(now)}`;
  const outputDir = path.resolve(config.artifacts.dir, "release-gates", gateId);
  const runs = runIds.map((runId) => summarizeRun({ config, runId }));
  const backup = {
    id: backupId,
    status: backupId ? "recorded" : "missing",
  };
  const sync = profileSyncStatus(profilePluginSync);
  const reasons = [];

  if (!runIds.length) reasons.push("run-ids-missing");
  if (!backupId) reasons.push("backup-id-missing");
  if (!profilePluginSync) reasons.push("profile-plugin-sync-missing");
  else if (!sync.ok) reasons.push(`profile-plugin-sync-${sync.status}`);
  for (const run of runs) reasons.push(...run.reasons);

  const repaired = runs.some((run) => run.repaired);
  const decision = reasons.length ? "blocked" : repaired ? "accepted_with_repair" : "accepted";
  const gate = {
    ok: decision !== "blocked",
    gateId,
    decision,
    reasons,
    generatedAt: now.toISOString(),
    backup,
    profilePluginSync: sync,
    runs,
    summary: {
      totalRuns: runs.length,
      acceptedRuns: runs.filter((run) => run.ok).length,
      repairedRuns: runs.filter((run) => run.repaired).length,
      cleanupResiduals: runs.reduce((total, run) => total + run.cleanupResiduals, 0),
      activeRunsBeforeCleanup: runs.reduce((total, run) => total + run.activeRunsBeforeCleanup, 0),
      cancelledRuns: runs.reduce((total, run) => total + run.cancelledRuns, 0),
    },
  };

  ensureDir(outputDir);
  const releaseGatePath = path.join(outputDir, "release-gate.json");
  const releaseGateMarkdownPath = path.join(outputDir, "RELEASE_GATE.md");
  const payload = {
    ...gate,
    releaseGatePath,
    releaseGateMarkdownPath,
  };
  fs.writeFileSync(releaseGatePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(releaseGateMarkdownPath, releaseMarkdown(payload), "utf8");
  return payload;
}
