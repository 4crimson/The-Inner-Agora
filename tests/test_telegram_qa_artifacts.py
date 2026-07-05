import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QA_ARTIFACTS = ROOT / "scripts" / "telegram" / "qa-artifacts.mjs"


class TelegramQaArtifactsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_qa_artifacts_read_latest_manifest_bugs_and_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            artifacts = Path(tmp) / "qa"
            old_run = artifacts / "old"
            new_run = artifacts / "new"
            old_run.mkdir(parents=True)
            new_run.mkdir(parents=True)

            (old_run / "manifest.json").write_text(
                json.dumps(
                    {
                        "runId": "old",
                        "tests": [{"id": "old.pass", "status": "passed"}],
                        "cleanup": [{"status": "ok"}],
                    }
                ),
                encoding="utf-8",
            )
            (new_run / "manifest.json").write_text(
                json.dumps(
                    {
                        "suite": "service-commands",
                        "results": [
                            {"id": "service.help", "status": "passed"},
                            {"id": "service.agora", "status": "failed"},
                            {"id": "service.extra", "status": "running"},
                        ],
                        "cleanup": {"mode": "hard", "residuals": [{"id": "THE-1"}]},
                    }
                ),
                encoding="utf-8",
            )
            (new_run / "bugs.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps({"id": "BUG-1", "title": "raw Hermes UI still visible"}),
                        "plain bug line",
                    ]
                ),
                encoding="utf-8",
            )

            old_time = 1_700_000_000
            new_time = old_time + 60
            os.utime(old_run / "manifest.json", (old_time, old_time))
            os.utime(new_run / "manifest.json", (new_time, new_time))

            source = textwrap.dedent(
                f"""
                import assert from "node:assert/strict";
                import {{
                  latestQaRun,
                  qaBugs,
                  qaCleanupWord,
                  qaCounts,
                  qaStatusWord,
                  qaTests,
                  resolveQaArtifactsDir,
                }} from {json.dumps(QA_ARTIFACTS.as_uri())};

                const artifactsDir = {json.dumps(str(artifacts))};
                const run = latestQaRun(artifactsDir);
                assert.equal(run.manifest.suite, "service-commands");
                assert.ok(run.dir.endsWith("/new"));

                const tests = qaTests(run.manifest);
                assert.deepEqual(tests.map((test) => test.id), ["service.help", "service.agora", "service.extra"]);

                const bugs = qaBugs(run);
                assert.equal(bugs.length, 2);
                assert.equal(bugs[0].id, "BUG-1");
                assert.equal(bugs[1].title, "plain bug line");

                const counts = qaCounts(run.manifest);
                assert.equal(counts.total, 3);
                assert.equal(counts.passed, 1);
                assert.equal(counts.failed, 1);
                assert.equal(qaStatusWord(counts, bugs), "FAIL");
                assert.equal(qaCleanupWord(run.manifest), "residuals 1");

                assert.equal(
                  resolveQaArtifactsDir({{ telegramQa: {{ artifacts_dir: artifactsDir }}, cwd: "/tmp/project" }}),
                  artifactsDir,
                );
                assert.equal(
                  resolveQaArtifactsDir({{ rootQa: {{ artifactsDir: "qa-runs" }}, cwd: "/tmp/project" }}),
                  "/tmp/project/qa-runs",
                );
                assert.equal(latestQaRun("/path/that/does/not/exist"), null);
                assert.equal(qaStatusWord({{ total: 2, passed: 2, failed: 0 }}, []), "PASS");
                assert.equal(qaStatusWord({{ total: 2, passed: 1, failed: 0 }}, []), "RUNNING");
                assert.equal(qaStatusWord({{ total: 0, passed: 0, failed: 0 }}, []), "UNKNOWN");
                assert.equal(qaCleanupWord({{ cleanup: [{{ status: "failed" }}] }}), "failed 1");
                """
            )
            result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
