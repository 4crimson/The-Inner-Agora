#!/usr/bin/env python3
"""Compatibility wrapper for the Paperclip Cockpit QA Telegram userbot driver."""

from __future__ import annotations

import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_DRIVER = ROOT / "hermes-plugins" / "paperclip-cockpit" / "qa-tool" / "scripts" / "telegram-userbot-driver.py"

runpy.run_path(str(CANONICAL_DRIVER), run_name="__main__")
