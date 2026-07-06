import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POLICY_UTILS = ROOT / "scripts" / "agora" / "policy-utils.mjs"


class AgoraPolicyUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_policy_utils_resolve_risk_and_transparency_text_with_injected_loaders(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              chamberRiskTier,
              roleRiskTier,
              transparencyPolicyText,
            }} from {json.dumps(POLICY_UTILS.as_uri())};

            assert.equal(roleRiskTier({{ riskTier: "high-stakes" }}), "high-stakes");
            assert.equal(roleRiskTier({{}}), "reflective");
            assert.equal(chamberRiskTier({{ riskTier: "business" }}), "business");
            assert.equal(chamberRiskTier({{}}), "reflective");

            const chamber = {{ id: "philosophy", transparencyPolicy: "source-citation" }};
            assert.equal(transparencyPolicyText({{
              chamberOrPolicyId: chamber,
              skillsDir: "/tmp/skills",
              composeChamberPolicy: (selected, options) => `${{selected.id}}:${{options.skillsDir}}`,
            }}), "philosophy:/tmp/skills");

            assert.equal(transparencyPolicyText({{
              chamberOrPolicyId: "source-citation",
              skillsDir: "/tmp/skills",
              loadSkillPrompt: (skillsDir, policyId) => `${{policyId}}@${{skillsDir}}`,
            }}), "source-citation@/tmp/skills");

            assert.equal(transparencyPolicyText({{
              chamberOrPolicyId: "",
              activeChamber: () => chamber,
              skillsDir: "/tmp/skills",
              loadSkillPrompt: (skillsDir, policyId) => `${{policyId}}@${{skillsDir}}`,
            }}), "source-citation@/tmp/skills");

            assert.equal(transparencyPolicyText({{
              chamberOrPolicyId: "missing-policy",
              loadSkillPrompt: () => {{ throw new Error("missing"); }},
              fallbackTransparencyPolicy: (policyId, error) => `${{policyId}}:${{error.message}}`,
            }}), "missing-policy:missing");
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
