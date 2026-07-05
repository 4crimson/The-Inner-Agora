import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COST_UTILS = ROOT / "scripts" / "agora" / "cost-utils.mjs"


class AgoraCostUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_cost_utils_normalize_log_and_summarize_token_usage(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              appendCostLog,
              costDashboard,
              costDashboardLines,
              costPricingSummary,
              costSummary,
              costSummaryLine,
              normalizePricingConfig,
              normalizeTokenUsage,
              tokenCostEntry,
            }} from {json.dumps(COST_UTILS.as_uri())};

            assert.deepEqual(
              normalizeTokenUsage({{ prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }}),
              {{ promptTokens: 12, completionTokens: 8, totalTokens: 20 }},
            );
            assert.deepEqual(
              normalizeTokenUsage({{ input_tokens: 5, output_tokens: 7 }}),
              {{ promptTokens: 5, completionTokens: 7, totalTokens: 12 }},
            );
            assert.equal(normalizeTokenUsage({{}}), null);

            const entry = tokenCostEntry({{
              kind: "intent-extractor",
              source: "llm",
              model: "test/model",
              usage: {{ prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }},
              createdAt: "2026-07-05T10:00:00.000Z",
            }});
            assert.equal(entry.kind, "intent-extractor");
            assert.equal(entry.model, "test/model");
            assert.equal(entry.totalTokens, 20);

            const session = appendCostLog({{ costLog: [entry] }}, [
              tokenCostEntry({{
                kind: "repair",
                model: "test/model",
                usage: {{ prompt_tokens: 2, completion_tokens: 3 }},
                createdAt: "2026-07-05T10:00:01.000Z",
              }}),
            ]);
            assert.equal(session.costLog.length, 2);
            assert.deepEqual(costSummary(session), {{
              calls: 2,
              promptTokens: 14,
              completionTokens: 11,
              totalTokens: 25,
            }});
            assert.equal(
              costSummaryLine(session),
              "Токены LLM: 25 total (prompt 14, completion 11, calls 2)",
            );

            const dashboard = costDashboard({{
              session: {{
                costLog: [
                  {{
                    kind: "intent-extractor",
                    source: "llm",
                    model: "slots",
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                    createdAt: "2026-07-05T10:00:00.000Z",
                  }},
                  {{
                    kind: "intent-extractor-repair",
                    source: "llm",
                    model: "slots",
                    promptTokens: 2,
                    completionTokens: 3,
                    totalTokens: 5,
                    createdAt: "2026-07-05T11:00:00.000Z",
                  }},
                  {{
                    kind: "voice",
                    source: "paperclip",
                    model: "hermes",
                    promptTokens: 20,
                    completionTokens: 10,
                    totalTokens: 30,
                    createdAt: "2026-07-05T12:00:00.000Z",
                  }},
                ],
              }},
            }}, {{ limit: 2, since: "2026-07-05T10:30:00.000Z" }});
            assert.deepEqual(dashboard.summary, {{
              calls: 2,
              promptTokens: 22,
              completionTokens: 13,
              totalTokens: 35,
            }});
            assert.equal(dashboard.entries.length, 2);
            assert.equal(dashboard.entries[0].kind, "intent-extractor-repair");
            assert.equal(dashboard.entries[1].kind, "voice");

            assert.deepEqual(costDashboard({{ session: {{ costLog: [] }} }}).summary, {{
              calls: 0,
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            }});

            const lines = costDashboardLines({{ session: {{ costLog: dashboard.entries }} }}, {{ limit: 2 }});
            assert.ok(lines.includes("# Стоимость и токены"));
            assert.ok(lines.includes("- Токены LLM: 35 total (prompt 22, completion 13, calls 2)"));
            assert.ok(lines.includes("## Последние вызовы"));
            assert.ok(lines.some((line) => line.includes("voice source=paperclip model=hermes total=30")));

            const pricing = normalizePricingConfig({{
              currency: "USD",
              rates: {{
                slots: {{
                  inputPer1MTokens: 1,
                  outputPer1MTokens: 2,
                }},
                hermes_local: {{
                  inputPer1MTokens: 0,
                  outputPer1MTokens: 0,
                }},
              }},
            }});
            assert.deepEqual(pricing.rates.slots, {{
              inputPer1MTokens: 1,
              outputPer1MTokens: 2,
              totalPer1MTokens: null,
            }});

            const priced = costPricingSummary({{
              costLog: [
                {{
                  model: "slots",
                  promptTokens: 1000000,
                  completionTokens: 500000,
                  totalTokens: 1500000,
                }},
                {{
                  adapter: "hermes_local",
                  model: "google/gemma",
                  promptTokens: 10,
                  completionTokens: 10,
                  totalTokens: 20,
                }},
                {{
                  model: "unknown-model",
                  promptTokens: 7,
                  completionTokens: 3,
                  totalTokens: 10,
                }},
              ],
            }}, pricing);
            assert.equal(priced.currency, "USD");
            assert.equal(priced.pricedCalls, 2);
            assert.equal(priced.unknownCalls, 1);
            assert.equal(priced.knownCost, 2);
            assert.equal(priced.unknownTokens, 10);

            const pricedDashboard = costDashboard({{ costLog: priced.entries.map((entry) => entry.entry) }}, {{ pricing }});
            assert.equal(pricedDashboard.pricing.knownCost, 2);
            const pricedLines = costDashboardLines({{ costLog: priced.entries.map((entry) => entry.entry) }}, {{ pricing }});
            assert.ok(pricedLines.some((line) => line.includes("Стоимость: $2.000000 USD")));
            assert.ok(pricedLines.some((line) => line.includes("unknown: 1 calls / 10 tokens")));
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_cost_utils_parse_cli_args_and_pricing_path(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              costPricingPath,
              parseCostsArgs,
            }} from {json.dumps(COST_UTILS.as_uri())};

            assert.deepEqual(parseCostsArgs(["--json", "--limit", "5", "--since", "2026-07-05T10:00:00.000Z"]), {{
              json: true,
              limit: 5,
              since: "2026-07-05T10:00:00.000Z",
              until: "",
              pricingPath: "",
            }});
            assert.deepEqual(
              parseCostsArgs(["--limit=0", "--until=2026-07-06T00:00:00.000Z", "--pricing=default"]),
              {{
                json: false,
                limit: 0,
                since: "",
                until: "2026-07-06T00:00:00.000Z",
                pricingPath: "default",
              }},
            );
            assert.equal(
              parseCostsArgs(["--hours", "2"], {{ now: new Date("2026-07-05T12:00:00.000Z") }}).since,
              "2026-07-05T10:00:00.000Z",
            );
            assert.throws(() => parseCostsArgs(["--limit", "-1"]), /--limit requires a non-negative number/);
            assert.throws(() => parseCostsArgs(["--hours", "0"]), /--hours requires a positive number/);
            assert.throws(() => parseCostsArgs(["--pricing"]), /--pricing requires env, default, off, or a JSON file path/);
            assert.throws(() => parseCostsArgs(["--unknown"]), /Unknown costs option: --unknown/);

            assert.equal(costPricingPath("", {{ root: "/repo" }}), "");
            assert.equal(costPricingPath("off", {{ root: "/repo" }}), "");
            assert.equal(costPricingPath("default", {{ root: "/repo", env: {{}} }}), "/repo/costs.config.json");
            assert.equal(
              costPricingPath("env", {{ root: "/repo", env: {{ INNER_AGORA_COST_PRICING_CONFIG: "/tmp/pricing.json" }} }}),
              "/tmp/pricing.json",
            );
            assert.equal(costPricingPath("relative/pricing.json", {{ root: "/repo" }}), "/repo/relative/pricing.json");
            assert.equal(costPricingPath("/absolute/pricing.json", {{ root: "/repo" }}), "/absolute/pricing.json");
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
