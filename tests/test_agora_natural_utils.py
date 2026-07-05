import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NATURAL_UTILS = ROOT / "scripts" / "agora" / "natural-utils.mjs"


class AgoraNaturalUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_natural_utils_parse_args_and_follow_up_context(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              naturalCommandPayload,
              naturalContextFromState,
              naturalFollowUpRequested,
              naturalNewSessionRequested,
              naturalNewTopicRequested,
              naturalReadOnlyRequested,
              naturalWords,
              parseNaturalArgs,
            }} from {json.dumps(NATURAL_UTILS.as_uri())};

            assert.deepEqual(
              parseNaturalArgs(["--routing-mode", "llm", "--json", "--dry-run", "что", "умеешь"], {{ ROUTING_MODE: "regex" }}),
              {{ routingMode: "llm", json: true, dryRun: true, text: "что умеешь" }},
            );
            assert.deepEqual(
              parseNaturalArgs(["обычный", "вопрос"], {{ ROUTING_MODE: "llm" }}),
              {{ routingMode: "llm", json: false, dryRun: false, text: "обычный вопрос" }},
            );
            assert.throws(() => parseNaturalArgs([], {{}}), /Usage: node scripts\\/agora\\.mjs natural/);

            assert.deepEqual(
              naturalCommandPayload(["/agora", "wizard"], {{
                source: "regex",
                slots: {{ intent: "new_session", topic: "" }},
                plan: {{ action: "clarify", missingSlots: ["topic"] }},
              }}),
              {{
                action: "rewrite",
                text: "/agora wizard",
                source: "regex",
                slots: {{ intent: "new_session", topic: "" }},
                plan: {{
                  action: "clarify",
                  missingSlots: ["topic"],
                }},
              }},
            );

            assert.equal(naturalWords("Ёж, HELP!  42"), "еж help 42");
            assert.equal(naturalFollowUpRequested("продолжи по этой сессии"), true);
            assert.equal(naturalNewTopicRequested("это отдельная тема с нуля"), true);
            assert.equal(naturalNewSessionRequested("создай совет про стратегию"), true);
            assert.equal(naturalReadOnlyRequested("что ты умеешь?"), true);

            const freshState = {{
              lastRootIssueRef: "THE-900",
              lastSynthesisRef: "THE-901",
              lastSynthesisSeenAt: "2026-07-05T09:00:00.000Z",
            }};
            assert.deepEqual(
              naturalContextFromState("а что если пойти глубже", freshState, {{
                now: new Date("2026-07-05T10:00:00.000Z"),
                env: {{ INNER_AGORA_FOLLOWUP_WINDOW_HOURS: "24" }},
              }}),
              {{
                lastRootIssueRef: "THE-900",
                lastSynthesisRef: "THE-901",
                isFollowUp: true,
                explicitFollowUp: true,
                implicitFollowUp: false,
              }},
            );
            assert.equal(
              naturalContextFromState("можешь показать итог", freshState, {{
                now: new Date("2026-07-05T10:00:00.000Z"),
                env: {{ INNER_AGORA_FOLLOWUP_WINDOW_HOURS: "24" }},
              }}).isFollowUp,
              false,
            );
            assert.equal(
              naturalContextFromState("давай подумаем дальше", freshState, {{
                now: new Date("2026-07-07T10:00:00.000Z"),
                env: {{ INNER_AGORA_FOLLOWUP_WINDOW_HOURS: "24" }},
              }}).isFollowUp,
              false,
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
