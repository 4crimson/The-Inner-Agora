import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEXT_UTILS = ROOT / "scripts" / "agora" / "text-utils.mjs"


class AgoraTextUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_text_utils_preserve_agora_string_contracts(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              clip,
              cleanTitle,
              editDistance,
              extractHereDocBody,
              looseStem,
              looseText,
              oneLine,
              searchStem,
              slugify,
              stableJson,
            }} from {json.dumps(TEXT_UTILS.as_uri())};

            assert.equal(stableJson({{ b: 2, a: 1 }}), '{{\\n  "b": 2,\\n  "a": 1\\n}}\\n');
            assert.equal(clip("  hello  ", 20), "hello");
            assert.equal(clip("abcdef", 3), "abc\\n\\n[... clipped 3 chars ...]");
            assert.equal(cleanTitle("  много\\n пробелов\\t тут  "), "много пробелов тут");
            assert.equal(cleanTitle("   "), "Agora request");
            assert.equal(cleanTitle("x".repeat(120)).length, 96);
            assert.equal(looseText("Ёж, Plato! 42"), "ежplato42");
            assert.equal(looseStem("Платона"), "платон");
            assert.equal(searchStem("мысль"), "мысл");
            assert.equal(editDistance("kitten", "sitting"), 3);
            assert.equal(oneLine(" a\\n b\\t c ", 40), "a b c");
            assert.equal(oneLine("abcdefghijklmnopqrstuvwxyz", 12), " ... [clipped]");
            assert.equal(
              extractHereDocBody("cat <<'EOF'\\nline one\\nline two\\nEOF\\n"),
              "line one\\nline two",
            );
            assert.equal(slugify(" THE: test / result #1 "), "THE-test-result-1");
            assert.equal(slugify("////", "session"), "session");
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
