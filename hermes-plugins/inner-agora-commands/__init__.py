from __future__ import annotations

import json
import logging
import shlex
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

ROOT = Path("/Users/admin/Documents/The Inner Agora")
NODE = "node"
TASK_STATUSES = {"todo", "in_progress", "blocked", "done", "cancelled"}


def _clip(text: str, limit: int = 12000) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n\n[... clipped {len(text) - limit} chars ...]"


def _run(args: list[str], timeout: int = 180) -> str:
    try:
        result = subprocess.run(
            args,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return f"Command timed out after {timeout}s: `{shlex.join(args)}`"
    except Exception as exc:
        logger.warning("inner-agora command failed before execution: %s", exc)
        return f"Command failed before execution: {exc}"

    output = result.stdout.strip()
    error = result.stderr.strip()
    if result.returncode == 0:
        return _clip(output or "OK")

    body = output
    if error:
        body = f"{body}\n\nstderr:\n{error}".strip()
    return _clip(f"Command exited with {result.returncode}.\n\n{body}")


def _agora_script(*args: str, timeout: int = 180) -> str:
    return _run([NODE, "scripts/agora.mjs", *args], timeout=timeout)


def _guard_script() -> str:
    raw = _run([NODE, "scripts/inner-agora-guard.mjs", "--json"], timeout=60)
    try:
        data = json.loads(raw)
    except Exception:
        return raw
    return (
        f"The Inner Agora guard: {'ok' if data.get('ok') else 'failed'}\n"
        f"- profile: {data.get('profileName')}\n"
        f"- model: {data.get('config', {}).get('model')}\n"
        f"- cwd: {data.get('config', {}).get('cwd')}\n"
        f"- SOUL.md: {data.get('files', {}).get('soulBytes')} bytes\n"
        f"- MEMORY.md: {data.get('files', {}).get('memoryBytes')} bytes\n"
        f"- plugin: {'ok' if data.get('plugin', {}).get('ok') else 'missing'}\n"
        f"- Paperclip: {'ok' if data.get('paperclip', {}).get('ok') else 'failed'}"
    )


def _parse_words(raw_args: str) -> list[str]:
    try:
        return shlex.split(raw_args)
    except ValueError:
        return raw_args.split()


def register(ctx: Any) -> None:
    def prepare(raw_args: str) -> str:
        words = _parse_words(raw_args)
        mode = words[0] if words else "balanced"
        return _agora_script("prepare", mode, timeout=240)

    def status(_: str) -> str:
        return _agora_script("status")

    def philosophers(_: str) -> str:
        return _agora_script("philosophers")

    def tasks(raw_args: str) -> str:
        words = _parse_words(raw_args)
        scope = "open"
        limit = "10"
        if words and words[0] in {"all", "open"}:
            scope = words.pop(0)
        if words:
            limit = words[0]
        if not limit.isdigit():
            return "Usage: /agora_tasks [open|all] [limit]"
        return _agora_script("tasks", f"--{scope}", "--limit", limit)

    def task(raw_args: str) -> str:
        issue = raw_args.strip()
        if not issue:
            return "Usage: /agora_task ISSUE"
        return _agora_script("task", issue)

    def move(raw_args: str) -> str:
        words = _parse_words(raw_args)
        if len(words) != 2 or words[1] not in TASK_STATUSES:
            return "Usage: /agora_move ISSUE <todo|in_progress|blocked|done|cancelled>"
        return _agora_script("move", words[0], words[1])

    def ask(raw_args: str) -> str:
        words = _parse_words(raw_args)
        if not words:
            return "Usage: /agora_ask [--min|--balanced|--max|--all|--philosophers list] <question>"
        return _agora_script("ask", *words, timeout=900)

    def council(raw_args: str) -> str:
        words = _parse_words(raw_args)
        if not words:
            return "Usage: /agora_council <question>"
        return _agora_script("council", *words, timeout=900)

    def dialogue(raw_args: str) -> str:
        words = _parse_words(raw_args)
        if len(words) < 2:
            return "Usage: /agora_dialogue <philosopher> <question>"
        return _agora_script("dialogue", *words, timeout=600)

    def synth(raw_args: str) -> str:
        issue = raw_args.strip()
        if not issue:
            return "Usage: /agora_synth ISSUE"
        return _agora_script("synthesize", issue, timeout=900)

    def memory(raw_args: str) -> str:
        issue = raw_args.strip()
        if not issue:
            return "Usage: /agora_memory ISSUE"
        return _agora_script("export-memory", issue)

    def guard(_: str) -> str:
        return _guard_script()

    ctx.register_command(
        name="agora-prepare",
        handler=prepare,
        description="Prepare The Inner Agora Paperclip agents.",
        args_hint="[local|balanced|max]",
    )
    ctx.register_command(
        name="agora-status",
        handler=status,
        description="Show The Inner Agora/Paperclip status.",
        args_hint="",
    )
    ctx.register_command(
        name="agora-philosophers",
        handler=philosophers,
        description="List active The Inner Agora philosophers in Paperclip.",
        args_hint="",
    )
    ctx.register_command(
        name="agora-tasks",
        handler=tasks,
        description="List The Inner Agora tasks.",
        args_hint="[open|all] [limit]",
    )
    ctx.register_command(
        name="agora-task",
        handler=task,
        description="Show one The Inner Agora task.",
        args_hint="ISSUE",
    )
    ctx.register_command(
        name="agora-move",
        handler=move,
        description="Move a The Inner Agora task.",
        args_hint="ISSUE <status>",
    )
    ctx.register_command(
        name="agora-council",
        handler=council,
        description="Create the minimum working council: Plato, Descartes, Heidegger.",
        args_hint="<question>",
    )
    ctx.register_command(
        name="agora-ask",
        handler=ask,
        description="Create a The Inner Agora Paperclip council session.",
        args_hint="[--min|--balanced|--max|--all|--philosophers list] <question>",
    )
    ctx.register_command(
        name="agora-dialogue",
        handler=dialogue,
        description="Create a one-on-one philosopher dialogue.",
        args_hint="<philosopher> <question>",
    )
    ctx.register_command(
        name="agora-synth",
        handler=synth,
        description="Create Agora Assistant synthesis for an issue.",
        args_hint="ISSUE",
    )
    ctx.register_command(
        name="agora-memory",
        handler=memory,
        description="Export an issue to The Inner Agora memory.",
        args_hint="ISSUE",
    )
    ctx.register_command(
        name="agora-guard",
        handler=guard,
        description="Run The Inner Agora guard.",
        args_hint="",
    )
