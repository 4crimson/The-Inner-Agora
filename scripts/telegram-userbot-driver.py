#!/usr/bin/env python3
"""Telegram userbot E2E driver for The Inner Agora.

The script intentionally reads credentials only from environment variables.
It never writes api_id/api_hash/phone into project files; Telethon stores the
authorized session in TELEGRAM_USERBOT_SESSION, which is ignored by git.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TRANSCRIPT_DIR = ROOT / "transcripts" / "telegram-userbot"


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)


def env_value(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def redact(value: str, visible: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= visible:
        return "*" * len(value)
    return f"{value[:visible]}{'*' * max(4, len(value) - visible)}"


def config() -> dict[str, str]:
    return {
        "api_id": env_value("TELEGRAM_API_ID"),
        "api_hash": env_value("TELEGRAM_API_HASH"),
        "phone": env_value("TELEGRAM_USER_PHONE"),
        "target": env_value("TELEGRAM_TEST_TARGET"),
        "session": env_value("TELEGRAM_USERBOT_SESSION", ".telegram-userbot"),
    }


def redacted_config() -> dict[str, str]:
    cfg = config()
    return {
        "api_id": cfg["api_id"],
        "api_hash": redact(cfg["api_hash"]),
        "phone": redact(cfg["phone"]),
        "target": cfg["target"],
        "session": cfg["session"],
    }


def validate_config(require_phone: bool = False) -> list[str]:
    cfg = config()
    missing = []
    for key, env_name in [
        ("api_id", "TELEGRAM_API_ID"),
        ("api_hash", "TELEGRAM_API_HASH"),
        ("target", "TELEGRAM_TEST_TARGET"),
        ("session", "TELEGRAM_USERBOT_SESSION"),
    ]:
        if not cfg[key]:
            missing.append(env_name)
    if require_phone and not cfg["phone"]:
        missing.append("TELEGRAM_USER_PHONE")
    if cfg["api_id"]:
        try:
            int(cfg["api_id"])
        except ValueError:
            missing.append("TELEGRAM_API_ID must be an integer")
    return missing


def load_telethon():
    try:
        from telethon import TelegramClient
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Telethon is not installed. Install it locally with:\n"
            "  python3 -m pip install --user telethon\n"
            "Then rerun this command."
        ) from exc
    return TelegramClient


def transcript_path(explicit: str = "") -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return DEFAULT_TRANSCRIPT_DIR / f"{stamp}.jsonl"


def append_transcript(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            handle.write("\n")


def serialize_button_rows(message: Any) -> list[list[dict[str, str]]]:
    rows = []
    for row in getattr(message, "buttons", None) or []:
        buttons = []
        for button in row:
            data = getattr(button, "data", b"")
            if isinstance(data, bytes):
                data = data.decode("utf-8", "ignore")
            buttons.append(
                {
                    "text": str(getattr(button, "text", "") or ""),
                    "data": str(data or ""),
                }
            )
        if buttons:
            rows.append(buttons)
    return rows


async def client_context():
    cfg = config()
    TelegramClient = load_telethon()
    client = TelegramClient(cfg["session"], int(cfg["api_id"]), cfg["api_hash"])
    await client.connect()
    return client


async def login() -> dict[str, Any]:
    missing = validate_config(require_phone=True)
    if missing:
        raise SystemExit(f"Missing required env: {', '.join(missing)}")
    cfg = config()
    TelegramClient = load_telethon()
    client = TelegramClient(cfg["session"], int(cfg["api_id"]), cfg["api_hash"])
    await client.start(phone=cfg["phone"])
    me = await client.get_me()
    await client.disconnect()
    return {
        "ok": True,
        "session": cfg["session"],
        "user_id": getattr(me, "id", None),
        "username": getattr(me, "username", None),
        "first_name": getattr(me, "first_name", None),
    }


async def send_message(args: argparse.Namespace) -> dict[str, Any]:
    missing = validate_config(require_phone=False)
    if missing:
        raise SystemExit(f"Missing required env: {', '.join(missing)}")
    cfg = config()
    if args.dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "target": cfg["target"],
            "text": args.text,
            "wait_seconds": args.wait,
        }

    client = await client_context()
    try:
        if not await client.is_user_authorized():
            raise SystemExit("Userbot is not authorized. Run: scripts/telegram-userbot-driver.py login")
        entity = await client.get_entity(cfg["target"])
        since = datetime.now(timezone.utc) - timedelta(seconds=2)
        sent = await client.send_message(entity, args.text)
        if args.wait > 0:
            await asyncio.sleep(args.wait)
        rows = []
        async for message in client.iter_messages(entity, limit=args.limit):
            date = message.date
            if date and date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            if date and date < since:
                break
            rows.append(
                {
                    "id": message.id,
                    "date": date.isoformat() if date else "",
                    "out": bool(message.out),
                    "text": message.message or "",
                    "buttons": serialize_button_rows(message),
                }
            )
        rows.reverse()
        output = {
            "ok": True,
            "target": cfg["target"],
            "sent_id": sent.id,
            "messages": rows,
        }
        if args.transcript:
            path = transcript_path(args.transcript)
            append_transcript(path, rows)
            output["transcript"] = str(path)
        return output
    finally:
        await client.disconnect()


async def history(args: argparse.Namespace) -> dict[str, Any]:
    missing = validate_config(require_phone=False)
    if missing:
        raise SystemExit(f"Missing required env: {', '.join(missing)}")
    cfg = config()
    if args.dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "target": cfg["target"],
            "limit": args.limit,
        }

    client = await client_context()
    try:
        if not await client.is_user_authorized():
            raise SystemExit("Userbot is not authorized. Run: scripts/telegram-userbot-driver.py login")
        entity = await client.get_entity(cfg["target"])
        rows = []
        async for message in client.iter_messages(entity, limit=args.limit):
            date = message.date
            if date and date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            rows.append(
                {
                    "id": message.id,
                    "date": date.isoformat() if date else "",
                    "out": bool(message.out),
                    "text": message.message or "",
                    "buttons": serialize_button_rows(message),
                }
            )
        rows.reverse()
        if args.transcript:
            path = transcript_path(args.transcript)
            append_transcript(path, rows)
        return {
            "ok": True,
            "target": cfg["target"],
            "messages": rows,
            **({"transcript": str(transcript_path(args.transcript))} if args.transcript else {}),
        }
    finally:
        await client.disconnect()


def parse_message_ids(raw: str) -> list[int]:
    ids = []
    for item in str(raw or "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            ids.append(int(item))
        except ValueError as exc:
            raise SystemExit(f"Invalid message id: {item}") from exc
    if not ids:
        raise SystemExit("Missing required --ids")
    return ids


async def delete_messages(args: argparse.Namespace) -> dict[str, Any]:
    missing = validate_config(require_phone=False)
    if missing:
        raise SystemExit(f"Missing required env: {', '.join(missing)}")
    cfg = config()
    message_ids = parse_message_ids(args.ids)
    if args.dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "target": cfg["target"],
            "message_ids": message_ids,
        }

    client = await client_context()
    try:
        if not await client.is_user_authorized():
            raise SystemExit("Userbot is not authorized. Run: scripts/telegram-userbot-driver.py login")
        entity = await client.get_entity(cfg["target"])
        await client.delete_messages(entity, message_ids, revoke=True)
        return {
            "ok": True,
            "target": cfg["target"],
            "deleted_message_ids": message_ids,
        }
    finally:
        await client.disconnect()


def check_env(_: argparse.Namespace) -> dict[str, Any]:
    missing = validate_config(require_phone=False)
    return {
        "ok": not missing,
        "missing": missing,
        "config": redacted_config(),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Telegram userbot E2E driver for The Inner Agora")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check-env", help="Validate required env without connecting to Telegram")
    check.set_defaults(func=check_env)

    login_cmd = sub.add_parser("login", help="Interactive Telegram user login")
    login_cmd.set_defaults(func=lambda args: asyncio.run(login()))

    send = sub.add_parser("send", help="Send one userbot message and optionally capture replies")
    send.add_argument("text")
    send.add_argument("--wait", type=float, default=8.0, help="Seconds to wait for replies")
    send.add_argument("--limit", type=int, default=20, help="Max messages to read from target chat")
    send.add_argument("--transcript", default="", help="Optional JSONL transcript path")
    send.add_argument("--dry-run", action="store_true")
    send.set_defaults(func=lambda args: asyncio.run(send_message(args)))

    hist = sub.add_parser("history", help="Read recent target chat messages")
    hist.add_argument("--limit", type=int, default=20, help="Max messages to read from target chat")
    hist.add_argument("--transcript", default="", help="Optional JSONL transcript path")
    hist.add_argument("--dry-run", action="store_true")
    hist.set_defaults(func=lambda args: asyncio.run(history(args)))

    delete = sub.add_parser("delete", help="Delete target chat messages by id")
    delete.add_argument("--ids", required=True, help="Comma-separated Telegram message ids")
    delete.add_argument("--dry-run", action="store_true")
    delete.set_defaults(func=lambda args: asyncio.run(delete_messages(args)))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    result = args.func(args)
    print(stable_json(result))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
