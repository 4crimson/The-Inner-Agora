import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INVENTORY_SCRIPT = ROOT / "scripts" / "cockpit-config-inventory.mjs"


class CockpitConfigInventoryTests(unittest.TestCase):
    def run_inventory(self, *args):
        return subprocess.run(
            ["node", str(INVENTORY_SCRIPT), *map(str, args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_real_config_inventory_captures_split_contract(self):
        result = self.run_inventory("--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["topLevelCommand"], "agora")
        self.assertFalse(payload["registerPcFallback"])
        self.assertEqual(payload["actions"], 44)
        self.assertEqual(payload["telegramCallbacks"], 61)
        self.assertEqual(payload["telegramCommandBoundaryMenus"], 2)
        self.assertEqual(payload["telegramModeSelectorModes"], 6)
        self.assertIn("ask", payload["actionKeys"])
        self.assertIn("costs", payload["actionKeys"])
        self.assertIn("telegram_last_session", payload["actionKeys"])
        self.assertIn("new_question", payload["callbackKeys"])
        self.assertEqual(payload["commandBoundaryMenuKeys"], ["agents", "home"])
        for label in ["Новый вопрос", "Последняя сессия", "Итог", "История", "Помощь", "Проверить"]:
            self.assertIn(label, payload["visibleLabels"])


if __name__ == "__main__":
    unittest.main()
