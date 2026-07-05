import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIGEST_UTILS = ROOT / "scripts" / "agora" / "digest-utils.mjs"


class AgoraDigestUtilsTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_digest_utils_preserve_synthesis_and_voice_formatting(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{
              bulletLines,
              hasSynthesisShape,
              meaningfulBody,
              normalizedDigestBody,
              paragraphLines,
              printFallbackDigest,
              printSynthesisDigest,
              printVoiceDigest,
              rootQuestion,
              sectionBody,
              synthesisComment,
            }} from {json.dumps(DIGEST_UTILS.as_uri())};

            const wrapped = [
              "cat <<'EOF'",
              "# Memo",
              "**1. Реальный вопрос** Почему свобода не равна произволу?",
              "",
              "```bash",
              "echo hidden",
              "```",
              "⚠️ File-mutation verifier: internal",
              "EOF",
            ].join("\\n");

            assert.equal(
              meaningfulBody(wrapped),
              "# Memo\\n**1. Реальный вопрос** Почему свобода не равна произволу?",
            );
            assert.equal(
              normalizedDigestBody(wrapped),
              "Memo\\n1. Реальный вопрос\\nПочему свобода не равна произволу?",
            );
            assert.equal(hasSynthesisShape("2. Участники и их позиции\\n- Платон: форма"), true);
            assert.equal(hasSynthesisShape("ordinary operational comment"), false);
            assert.equal(
              rootQuestion({{
                title: "Fallback title",
                description: "Исходный вопрос:\\nЧто такое свобода?\\n\\nДальше: x",
              }}),
              "Что такое свобода?",
            );

            const digest = [
              "1. Реальный вопрос",
              "Свобода как способность выбирать основание действия.",
              "",
              "2. Участники и их позиции",
              "- Платон: свобода требует формы.",
              "* Декарт: свобода требует метода.",
              "",
              "3. Главные линии конфликта",
              "- Форма против метода.",
              "",
              "6. Что осталось нерешенным",
              "- Цена ошибки.",
              "",
              "7. Следующий шаг",
              "Проверить практический критерий.",
              "",
              "Пометки:",
              "- Не сглаживать конфликт.",
            ].join("\\n");

            assert.equal(sectionBody(digest, 3), "- Форма против метода.");
            assert.deepEqual(bulletLines("- a\\n* b\\nplain", 3), ["- a", "- b"]);
            assert.deepEqual(paragraphLines("one\\n\\ntwo\\n\\nthree", 2), ["one", "two"]);

            const selected = synthesisComment([
              {{ id: "deleted", body: digest, deletedAt: "yes" }},
              {{ id: "shell", body: "```bash\\ncurl http://example\\n```", authorType: "agent" }},
              {{ id: "agent", body: digest, authorType: "agent" }},
            ]);
            assert.equal(selected.id, "agent");

            const lines = [];
            const originalLog = console.log;
            console.log = (...args) => lines.push(args.join(" "));
            try {{
              assert.equal(printSynthesisDigest({{ body: digest }}), true);
              assert.equal(printVoiceDigest({{
                body: [
                  "1. Как он понял вопрос",
                  "Как вопрос о выборе.",
                  "",
                  "2. Позиция",
                  "Свобода начинается с метода.",
                  "",
                  "3. Что скрыто в вопросе",
                  "Страх ошибки.",
                ].join("\\n"),
              }}), true);
              printFallbackDigest({{ body: "plain paragraph\\n\\nsecond paragraph" }});
            }} finally {{
              console.log = originalLog;
            }}

            assert.ok(lines.includes("Реальный вопрос:"));
            assert.ok(lines.includes("- Свобода как способность выбирать основание действия."));
            assert.ok(lines.includes("Позиции:"));
            assert.ok(lines.includes("- Декарт: свобода требует метода."));
            assert.ok(lines.includes("Как он понял вопрос:"));
            assert.ok(lines.includes("- plain paragraph"));
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
