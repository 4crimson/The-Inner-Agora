import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ADAPTER_UTILS = ROOT / "scripts" / "agora" / "adapter-utils.mjs"


class AgoraAdapterUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_adapter_utils_preserve_route_metadata_contract(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              adapterDisplayLine,
              adapterFromIssue,
              adapterFromState,
              adapterMetadata,
              adapterStatePatch,
            }} from {json.dumps(ADAPTER_UTILS.as_uri())};

            const adapter = {{
              name: "hermes_local",
              model: "test/hermes-local",
              reason: "localMode",
              riskTier: "reflective",
              extra: "not persisted",
            }};

            assert.deepEqual(adapterMetadata(adapter), {{
              name: "hermes_local",
              model: "test/hermes-local",
              reason: "localMode",
              riskTier: "reflective",
            }});

            assert.deepEqual(adapterStatePatch(adapter), {{
              lastAdapterName: "hermes_local",
              lastAdapterModel: "test/hermes-local",
              lastAdapterReason: "localMode",
              lastAdapterRiskTier: "reflective",
            }});

            assert.equal(
              adapterDisplayLine(adapter),
              "adapter=hermes_local, model=test/hermes-local, reason=localMode, risk=reflective",
            );

            assert.equal(adapterFromState({{}}), null);
            assert.deepEqual(adapterFromState({{ lastAdapterName: "codex_local" }}), {{
              name: "codex_local",
              model: "-",
              reason: "-",
              riskTier: "-",
            }});
            assert.deepEqual(
              adapterFromState({{
                lastAdapterName: "hermes_local",
                lastAdapterModel: "test/hermes-local",
                lastAdapterReason: "localMode",
                lastAdapterRiskTier: "reflective",
              }}),
              adapterMetadata(adapter),
            );

            assert.deepEqual(
              adapterFromIssue({{ metadata: {{ innerAgora: {{ adapter }} }} }}),
              adapter,
            );
            assert.deepEqual(
              adapterFromIssue({{ metadata: {{ innerAgoraAdapter: adapter }} }}),
              adapter,
            );
            assert.equal(adapterFromIssue({{ metadata: {{ innerAgora: {{ adapter: {{ model: "missing-name" }} }} }} }}), null);
            assert.equal(adapterFromIssue(null), null);
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
