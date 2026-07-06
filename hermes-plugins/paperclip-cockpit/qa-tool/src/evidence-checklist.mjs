import fs from "node:fs";
import path from "node:path";

const REQUIRED_DOCS = [
  "docs/roadmap/BUGS.md",
  "docs/roadmap/COMPLETION_AUDIT.md",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function statusItem(id, label, value, docs = REQUIRED_DOCS) {
  return {
    id,
    label,
    value: value == null ? "" : value,
    requiredDocs: docs,
    status: value ? "present" : "missing",
  };
}

function missingItem(id, reason) {
  return { id, reason };
}

function runGuardMissing(run) {
  if (run.repaired) return false;
  return run.guardAfter !== "ok";
}

function runHasCleanupResiduals(run) {
  return Number(run.cleanupResiduals || 0) > 0;
}

function presentEvidence(gate, commits) {
  return {
    releaseGateId: gate.gateId || "",
    decision: gate.decision || "",
    runIds: (gate.runs || []).map((run) => run.runId).filter(Boolean),
    backupId: gate.backup?.id || "",
    profilePluginSync: gate.profilePluginSync?.status || "",
    guards: (gate.runs || []).map((run) => ({
      runId: run.runId,
      guardBefore: run.guardBefore || "not-run",
      guardAfter: run.guardAfter || "not-run",
      guardRepeat: run.guardRepeat || "not-run",
      repaired: Boolean(run.repaired),
    })),
    cleanup: (gate.runs || []).map((run) => ({
      runId: run.runId,
      cleanupResiduals: Number(run.cleanupResiduals || 0),
      activeRunsBeforeCleanup: Number(run.activeRunsBeforeCleanup || 0),
      cancelledRuns: Number(run.cancelledRuns || 0),
    })),
    repairs: (gate.runs || [])
      .filter((run) => run.repaired)
      .map((run) => ({
        runId: run.runId,
        repairBackup: run.repairBackup || "",
        repairCommand: run.repairCommand || "",
        guardRepeat: run.guardRepeat || "not-run",
      })),
    commits,
  };
}

function checklistForGate(gate, commits) {
  const runIds = (gate.runs || []).map((run) => run.runId).filter(Boolean);
  const items = [
    statusItem("release-gate", "Release gate id", gate.gateId || ""),
    statusItem("release-decision", "Release decision", gate.decision || ""),
    statusItem("run-ids", "QA run ids", runIds.join(", ")),
    statusItem("backup-id", "Backup id", gate.backup?.id || ""),
    statusItem("profile-plugin-sync", "Profile/plugin sync", gate.profilePluginSync?.status || ""),
    statusItem("commit-hash", "Commit hash", commits.join(", ")),
  ];

  for (const run of gate.runs || []) {
    items.push(statusItem(
      `guard:${run.runId}`,
      `Guard status for ${run.runId}`,
      `before=${run.guardBefore}; after=${run.guardAfter}; repeat=${run.guardRepeat}`,
    ));
    items.push(statusItem(
      `cleanup:${run.runId}`,
      `Cleanup status for ${run.runId}`,
      `residuals=${Number(run.cleanupResiduals || 0)}; activeRunsBeforeCleanup=${Number(run.activeRunsBeforeCleanup || 0)}; cancelledRuns=${Number(run.cancelledRuns || 0)}`,
    ));
    if (run.repaired) {
      items.push(statusItem(
        `repair:${run.runId}`,
        `Repair evidence for ${run.runId}`,
        `backup=${run.repairBackup}; command=${run.repairCommand}; guardRepeat=${run.guardRepeat}`,
      ));
    }
  }
  return items;
}

function missingEvidenceForGate(gate, commits) {
  const missing = [];
  if (!gate.gateId) missing.push(missingItem("release-gate", "release gate id is missing"));
  if (!gate.decision || gate.decision === "blocked") {
    missing.push(missingItem("release-decision", "release decision is blocked or missing"));
  }
  if (!Array.isArray(gate.runs) || gate.runs.length === 0) missing.push(missingItem("run-ids", "no QA run ids recorded"));
  if (!gate.backup?.id) missing.push(missingItem("backup-id", "backup id is missing"));
  if (gate.profilePluginSync?.status !== "ok") missing.push(missingItem("profile-plugin-sync", "profile/plugin sync is not ok"));
  if (!commits.length) missing.push(missingItem("commit-hash", "commit hash is missing"));

  for (const run of gate.runs || []) {
    if (runGuardMissing(run)) {
      missing.push(missingItem(`post-suite-guard:${run.runId}`, "post-suite guard is missing or red without repair evidence"));
    }
    if (runHasCleanupResiduals(run)) {
      missing.push(missingItem(`cleanup:${run.runId}`, "cleanup residuals are present"));
    }
    if (run.repaired && (!run.repairBackup || !run.repairCommand || run.guardRepeat !== "ok")) {
      missing.push(missingItem(`repair:${run.runId}`, "repair backup, command, or repeat guard is missing"));
    }
  }
  return missing;
}

function evidenceMarkdown(payload) {
  const lines = [
    `# Evidence Checklist: ${payload.releaseGateId || "missing"}`,
    "",
    `Decision: ${payload.presentEvidence.decision || "missing"}`,
    `Runs: ${payload.presentEvidence.runIds.join(", ") || "missing"}`,
    `Backup: ${payload.presentEvidence.backupId || "missing"}`,
    `Profile/plugin sync: ${payload.presentEvidence.profilePluginSync || "missing"}`,
    `Commits: ${payload.presentEvidence.commits.join(", ") || "missing"}`,
    "",
    "## Required Docs",
    "",
    ...payload.requiredDocs.map((doc) => `- ${doc.id}`),
    "",
    "## Checklist",
    "",
  ];

  for (const item of payload.checklist) {
    lines.push(`- [${item.status === "present" ? "x" : " "}] ${item.label}: ${item.value || "missing"}`);
    lines.push(`  - Docs: ${item.requiredDocs.join(", ")}`);
  }

  if (payload.missingEvidence.length) {
    lines.push("", "## Missing Evidence", "");
    for (const item of payload.missingEvidence) lines.push(`- ${item.id}: ${item.reason}`);
  }

  return `${lines.join("\n")}\n`;
}

export function writeEvidenceChecklist({ releaseGatePath, commits = [], projectRoot = process.cwd() }) {
  if (!releaseGatePath) throw new Error("--release-gate is required");
  const resolvedGatePath = path.resolve(projectRoot, releaseGatePath);
  const gate = JSON.parse(fs.readFileSync(resolvedGatePath, "utf8"));
  const cleanCommits = [...new Set((commits || []).map((item) => String(item || "").trim()).filter(Boolean))];
  const requiredDocs = REQUIRED_DOCS.map((doc) => ({ id: doc, path: path.resolve(projectRoot, doc) }));
  const payload = {
    ok: false,
    releaseGateId: gate.gateId || "",
    releaseGatePath: resolvedGatePath,
    requiredDocs,
    presentEvidence: presentEvidence(gate, cleanCommits),
    missingEvidence: missingEvidenceForGate(gate, cleanCommits),
    checklist: checklistForGate(gate, cleanCommits),
    evidenceChecklistPath: path.join(path.dirname(resolvedGatePath), "EVIDENCE_CHECKLIST.md"),
  };
  payload.ok = payload.missingEvidence.length === 0;
  ensureDir(path.dirname(payload.evidenceChecklistPath));
  fs.writeFileSync(payload.evidenceChecklistPath, evidenceMarkdown(payload), "utf8");
  return payload;
}
