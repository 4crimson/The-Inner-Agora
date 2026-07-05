import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SENDER = ROOT / "scripts" / "telegram" / "sender.mjs"


class TelegramSenderTests(unittest.TestCase):
    def run_node(self, source):
        return subprocess.run(
            ["node", "--input-type=module", "-e", source],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_sender_chunks_text_and_injects_live_dependencies(self):
        source = textwrap.dedent(
            f"""
            import assert from "node:assert/strict";
            import {{ chunks, sendText }} from {json.dumps(SENDER.as_uri())};

            assert.deepEqual(chunks("", 10), ["OK"]);
            assert.deepEqual(chunks("alpha\\n\\nbeta\\n\\ngamma", 13), ["alpha\\n\\nbeta", "gamma"]);
            const longParagraph = `${{ "a".repeat(1250) }}\\n\\n${{ "b".repeat(200) }}`;
            assert.deepEqual(chunks(longParagraph, 1300).map((part) => part.length), [1250, 200]);

            const dryLogs = [];
            await sendText({{
              chatId: "explicit-chat",
              text: "hello",
              keyboard: {{ inline_keyboard: [[{{ text: "Back", callback_data: "pc:back:help" }}]] }},
              dryRun: true,
              telegramChat: () => "unused",
              telegramApi: async () => {{ throw new Error("should not send"); }},
              log: (line) => dryLogs.push(line),
            }});
            assert.equal(dryLogs.length, 1);
            assert.deepEqual(JSON.parse(dryLogs[0]), {{
              chat_id: "explicit-chat",
              text: "hello",
              reply_markup: {{ inline_keyboard: [[{{ text: "Back", callback_data: "pc:back:help" }}]] }},
            }});

            const calls = [];
            await sendText({{
              chatId: "",
              text: `${{ "a".repeat(1250) }}\\n\\n${{ "b".repeat(200) }}`,
              keyboard: {{ inline_keyboard: [[{{ text: "Open", callback_data: "pc:open:THE-1" }}]] }},
              dryRun: false,
              limit: 1300,
              telegramChat: () => "home-chat",
              telegramApi: async (method, payload) => calls.push({{ method, payload }}),
            }});
            assert.equal(calls.length, 2);
            assert.equal(calls[0].method, "sendMessage");
            assert.equal(calls[0].payload.chat_id, "home-chat");
            assert.equal(calls[0].payload.text.length, 1250);
            assert.deepEqual(calls[0].payload.reply_markup, {{
              inline_keyboard: [[{{ text: "Open", callback_data: "pc:open:THE-1" }}]],
            }});
            assert.equal(calls[1].payload.text.length, 200);
            assert.equal("reply_markup" in calls[1].payload, false);

            await assert.rejects(
              () =>
                sendText({{
                  chatId: "",
                  text: "hello",
                  dryRun: false,
                  telegramChat: () => "",
                  telegramApi: async () => {{}},
                }}),
              /Telegram chat id is not configured/,
            );
            """
        )
        result = self.run_node(source)

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
