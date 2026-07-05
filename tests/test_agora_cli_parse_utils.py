import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI_PARSE_UTILS = ROOT / "scripts" / "agora" / "cli-parse-utils.mjs"


class AgoraCliParseUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_cli_parse_utils_preserve_agora_argument_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              parseAskArgs,
              parseCouncilArgs,
              parseFollowUpArgs,
              parseRoleProposalArgs,
              parseTasksArgs,
              stripFullTokens,
            }} from {json.dumps(CLI_PARSE_UTILS.as_uri())};

            assert.deepEqual(
              parseAskArgs(["--mode", "max", "--dry-run", "--philosophers", "socrates,kant", "важный", "вопрос"], {{ defaultMode: "balanced" }}),
              {{
                request: "важный вопрос",
                mode: "max",
                dryRun: true,
                all: false,
                confirmAll: false,
                noArchitects: false,
                philosopherList: "socrates,kant",
              }},
            );
            assert.equal(parseAskArgs(["быстро", "про", "смысл"], {{ defaultMode: "balanced" }}).mode, "min");
            assert.deepEqual(
              parseAskArgs(["--all", "--confirm-all", "--no-architects", "--voices", "ceo,cfo", "board", "topic"], {{ defaultMode: "min" }}),
              {{
                request: "board topic",
                mode: "all",
                dryRun: false,
                all: true,
                confirmAll: true,
                noArchitects: true,
                philosopherList: "ceo,cfo",
              }},
            );
            assert.throws(() => parseAskArgs(["--mode"], {{ defaultMode: "balanced" }}), /--mode requires one of/);
            assert.throws(() => parseAskArgs(["--philosophers"], {{ defaultMode: "balanced" }}), /--philosophers requires comma-separated/);

            assert.deepEqual(parseCouncilArgs(["--dry-run", "короткий", "вопрос"]), {{
              dryRun: true,
              request: "короткий вопрос",
            }});

            assert.deepEqual(parseFollowUpArgs(["THE-1", "--voices", "socrates", "что", "дальше"]), {{
              rootRef: "THE-1",
              roleList: "socrates",
              request: "что дальше",
            }});
            assert.throws(() => parseFollowUpArgs([]), /follow-up <root-issue>/);
            assert.throws(() => parseFollowUpArgs(["THE-1", "--voices"]), /--voices requires comma-separated/);
            assert.throws(() => parseFollowUpArgs(["THE-1"]), /follow-up <root-issue>/);

            assert.deepEqual(
              parseRoleProposalArgs(["--json", "--limit", "-2", "--mode", "макс", "--no-architects", "тема"]),
              {{
                json: true,
                limit: 1,
                mode: "max",
                noArchitects: true,
                topic: "тема",
              }},
            );
            assert.equal(parseRoleProposalArgs(["--limit", "0", "topic"]).limit, 4);
            assert.equal(parseRoleProposalArgs(["--limit", "not-a-number", "topic"]).limit, 4);

            assert.deepEqual(parseTasksArgs(["--all", "--limit", "5"]), {{ scope: "all", limit: 5 }});
            assert.deepEqual(parseTasksArgs([]), {{ scope: "open", limit: 20 }});
            assert.throws(() => parseTasksArgs(["--limit", "0"]), /--limit requires a positive number/);
            assert.throws(() => parseTasksArgs(["--unknown"]), /Unknown tasks argument: --unknown/);

            assert.deepEqual(stripFullTokens(["THE-1", "--full", "подробно", "text", "FULL"]), {{
              full: true,
              args: ["THE-1", "text"],
            }});
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
