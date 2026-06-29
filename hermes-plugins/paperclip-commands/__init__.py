from __future__ import annotations

import json
import logging
import os
import re
import shlex
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

API_BASE = os.environ.get("PAPERCLIP_API_BASE", "http://127.0.0.1:3100/api").rstrip("/")
HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
TASK_STATUSES = {"todo", "in_progress", "blocked", "done", "cancelled"}
OPEN_STATUSES = {"todo", "in_progress", "blocked"}

PC_HELP = """Usage:
/pc help
/pc companies
/pc health
/pc agents [--company NAME]
/pc tasks [--company NAME] [open|all|todo|in_progress|blocked|done|cancelled] [limit]
/pc task ISSUE
/pc comments ISSUE
/pc move ISSUE <todo|in_progress|blocked|done|cancelled>

Short aliases:
/pc orgs
/pc people
/pc list
/pc t ISSUE
/pc m ISSUE STATUS

Company selection:
- env PAPERCLIP_DEFAULT_COMPANY or PAPERCLIP_COMPANY_NAME
- otherwise Hermes terminal.cwd is fuzzy-matched to a Paperclip company
- pass --company "Company Name" when needed
"""


class PaperclipError(RuntimeError):
    pass


def _clip(text: str, limit: int = 12000) -> str:
    text = str(text or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n\n[... clipped {len(text) - limit} chars ...]"


def _api(path: str, *, method: str = "GET", body: dict[str, Any] | None = None, timeout: int = 10) -> Any:
    url = f"{API_BASE}{path}"
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", "replace")
        raise PaperclipError(f"{method} {path} failed: HTTP {exc.code} {text}") from exc
    except Exception as exc:
        raise PaperclipError(f"{method} {path} failed: {exc}") from exc


def _parse_words(raw_args: str) -> list[str]:
    try:
        return shlex.split(raw_args)
    except ValueError:
        return raw_args.split()


def _norm(text: str) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", "", str(text or "").casefold())


def _compact_id(value: str, size: int = 8) -> str:
    return str(value or "")[:size]


def _nested_yaml_value(text: str, section: str, key: str) -> str:
    in_section = False
    for line in text.splitlines():
        if line and not line.startswith((" ", "\t")):
            in_section = line.strip() == f"{section}:"
            continue
        if not in_section:
            continue
        match = re.match(rf"^\s+{re.escape(key)}:\s*(.*?)\s*$", line)
        if match:
            return match.group(1).strip().strip("'\"")
    return ""


def _config_cwd_hint() -> str:
    try:
        config = (HERMES_HOME / "config.yaml").read_text("utf-8")
    except Exception:
        return ""
    cwd = _nested_yaml_value(config, "terminal", "cwd")
    if not cwd:
        return ""
    return Path(cwd).name


def _company_hints() -> list[str]:
    hints = [
        os.environ.get("PAPERCLIP_DEFAULT_COMPANY", ""),
        os.environ.get("PAPERCLIP_COMPANY_NAME", ""),
        os.environ.get("INNER_AGORA_COMPANY_NAME", ""),
        os.environ.get("AI_BOARD_COMPANY_NAME", ""),
        _config_cwd_hint(),
        HERMES_HOME.name,
    ]
    return [item for item in hints if item]


def _match_company(companies: list[dict[str, Any]], token: str) -> dict[str, Any] | None:
    needle = _norm(token)
    if not needle:
        return None

    for company in companies:
        if str(company.get("id", "")) == token:
            return company
    for company in companies:
        if _norm(company.get("name", "")) == needle:
            return company
    for company in companies:
        name = _norm(company.get("name", ""))
        if needle in name or name in needle:
            return company
    for company in companies:
        if str(company.get("issuePrefix", "")).casefold() == token.casefold():
            return company
    return None


def _companies() -> list[dict[str, Any]]:
    data = _api("/companies")
    if not isinstance(data, list):
        raise PaperclipError("Paperclip /companies returned unexpected data")
    return data


def _resolve_company(token: str = "") -> dict[str, Any]:
    companies = _companies()
    if token:
        match = _match_company(companies, token)
        if match:
            return match
        raise PaperclipError(f"Unknown Paperclip company: {token}\n\n{_format_companies(companies)}")

    for hint in _company_hints():
        match = _match_company(companies, hint)
        if match:
            return match

    if len(companies) == 1:
        return companies[0]

    raise PaperclipError(
        "Multiple Paperclip companies found. Pass --company \"Name\" or set PAPERCLIP_DEFAULT_COMPANY.\n\n"
        + _format_companies(companies)
    )


def _extract_company(words: list[str]) -> tuple[list[str], str]:
    remaining: list[str] = []
    company = ""
    index = 0
    while index < len(words):
        word = words[index]
        if word == "--company" and index + 1 < len(words):
            company = words[index + 1]
            index += 2
            continue
        if word.startswith("--company="):
            company = word.split("=", 1)[1]
            index += 1
            continue
        remaining.append(word)
        index += 1
    return remaining, company


def _agent_name(agent_by_id: dict[str, dict[str, Any]], agent_id: str | None) -> str:
    if not agent_id:
        return "-"
    agent = agent_by_id.get(agent_id)
    return str(agent.get("name", agent_id)) if agent else str(agent_id)


def _format_companies(companies: list[dict[str, Any]]) -> str:
    lines = ["# Paperclip companies"]
    for company in sorted(companies, key=lambda item: str(item.get("name", "")).casefold()):
        prefix = company.get("issuePrefix") or "-"
        status = company.get("status") or "unknown"
        lines.append(f"- {company.get('name')} ({prefix}) status={status} id={_compact_id(company.get('id'))}")
    return "\n".join(lines)


def _health(_: str) -> str:
    data = _api("/health", timeout=5)
    if isinstance(data, dict):
        return f"Paperclip health: {'ok' if data.get('ok', True) else 'failed'} version={data.get('version', '-')}"
    return "Paperclip health: ok"


def _companies_cmd(_: str) -> str:
    return _format_companies(_companies())


def _agents_cmd(raw_args: str) -> str:
    words, company_token = _extract_company(_parse_words(raw_args))
    if words and not company_token:
        company_token = " ".join(words)
    company = _resolve_company(company_token)
    agents = _api(f"/companies/{company['id']}/agents")
    lines = [f"# Paperclip agents: {company['name']}"]
    for agent in sorted(agents, key=lambda item: str(item.get("name", "")).casefold()):
        status = agent.get("status") or "unknown"
        adapter = agent.get("adapterType") or "-"
        role = agent.get("role") or "-"
        lines.append(f"- {status:<12} {agent.get('name')} role={role} adapter={adapter}")
    lines.append(f"\nTotal: {len(agents)}")
    return "\n".join(lines)


def _tasks_cmd(raw_args: str) -> str:
    words, company_token = _extract_company(_parse_words(raw_args))
    scope = "open"
    limit = 10

    if words and words[0].casefold() in {"open", "all", "todo", "in_progress", "blocked", "done", "cancelled"}:
        scope = words.pop(0).casefold()
    elif words and not words[0].isdigit():
        company_token = words.pop(0)

    if words and words[0].casefold() in {"open", "all", "todo", "in_progress", "blocked", "done", "cancelled"}:
        scope = words.pop(0).casefold()
    if words and words[0].isdigit():
        limit = max(1, min(50, int(words[0])))

    company = _resolve_company(company_token)
    issues = [item for item in _api(f"/companies/{company['id']}/issues") if not item.get("hiddenAt")]
    agents = _api(f"/companies/{company['id']}/agents")
    agent_by_id = {agent["id"]: agent for agent in agents}

    if scope == "open":
        issues = [item for item in issues if item.get("status") in OPEN_STATUSES]
    elif scope != "all":
        issues = [item for item in issues if item.get("status") == scope]

    issues.sort(key=lambda item: str(item.get("lastActivityAt") or item.get("updatedAt") or ""), reverse=True)
    lines = [f"# Paperclip tasks: {company['name']} ({scope}, limit {limit})"]
    if not issues:
        lines.append("- No tasks.")
    for issue in issues[:limit]:
        assignee = _agent_name(agent_by_id, issue.get("assigneeAgentId"))
        ident = issue.get("identifier") or _compact_id(issue.get("id"))
        parent = "child" if issue.get("parentId") else "root"
        lines.append(f"- {issue.get('status'):<12} {ident:<8} {parent:<5} assignee={assignee} {issue.get('title')}")
    return "\n".join(lines)


def _task_cmd(raw_args: str) -> str:
    issue_ref = raw_args.strip()
    if not issue_ref:
        return "Usage: /pc_task ISSUE"
    issue = _api(f"/issues/{issue_ref}")
    agents = _api(f"/companies/{issue['companyId']}/agents")
    agent_by_id = {agent["id"]: agent for agent in agents}
    comments = [item for item in _api(f"/issues/{issue['id']}/comments") if not item.get("deletedAt")]
    lines = [
        f"# {issue.get('identifier') or issue.get('id')}: {issue.get('title')}",
        f"- status: {issue.get('status')}",
        f"- priority: {issue.get('priority') or '-'}",
        f"- assignee: {_agent_name(agent_by_id, issue.get('assigneeAgentId'))}",
        f"- parent: {issue.get('parentId') or '-'}",
        f"- url: http://127.0.0.1:3100/issues/{issue.get('id')}",
        "",
        "## Description",
        _clip(issue.get("description") or "", 2000) or "-",
        "",
        "## Last comments",
    ]
    if not comments:
        lines.append("- No comments.")
    for comment in comments[-3:]:
        body = re.sub(r"\s+", " ", comment.get("body") or "").strip()
        lines.append(f"- {comment.get('authorType') or 'unknown'} {comment.get('createdAt') or ''}: {_clip(body, 500)}")
    return "\n".join(lines)


def _comments_cmd(raw_args: str) -> str:
    issue_ref = raw_args.strip()
    if not issue_ref:
        return "Usage: /pc_comments ISSUE"
    issue = _api(f"/issues/{issue_ref}")
    comments = [item for item in _api(f"/issues/{issue['id']}/comments") if not item.get("deletedAt")]
    lines = [f"# Comments: {issue.get('identifier') or issue.get('id')}", issue.get("title") or ""]
    if not comments:
        lines.append("\nNo comments.")
    for comment in comments[-8:]:
        lines.extend(["", f"--- {comment.get('authorType') or 'unknown'} {comment.get('createdAt') or ''} ---", comment.get("body") or ""])
    return _clip("\n".join(lines))


def _move_cmd(raw_args: str) -> str:
    words = _parse_words(raw_args)
    if len(words) != 2 or words[1] not in TASK_STATUSES:
        return "Usage: /pc_move ISSUE <todo|in_progress|blocked|done|cancelled>"
    issue_ref, next_status = words
    issue = _api(f"/issues/{issue_ref}")
    old_status = issue.get("status")
    if old_status == next_status:
        return f"{issue.get('identifier') or issue.get('id')} already {next_status}"
    updated = _api(f"/issues/{issue['id']}", method="PATCH", body={"status": next_status})
    try:
        _api(
            f"/issues/{issue['id']}/comments",
            method="POST",
            body={"body": f"Status changed via Paperclip Telegram bridge: {old_status} -> {next_status}."},
        )
    except Exception as exc:
        logger.info("Paperclip comment after move failed: %s", exc)
    ident = updated.get("identifier") or issue.get("identifier") or issue.get("id")
    return f"Moved {ident}: {old_status} -> {next_status}\nOpen: http://127.0.0.1:3100/issues/{issue['id']}"


def _router(raw_args: str) -> str:
    raw = raw_args.strip()
    if not raw:
        return PC_HELP.strip()
    words = _parse_words(raw)
    head = words[0].casefold()
    tail = " ".join(words[1:]).strip()

    try:
        if head in {"help", "помощь", "commands", "?"}:
            return PC_HELP.strip()
        if head in {"health", "ping", "здоровье"}:
            return _health(tail)
        if head in {"companies", "company", "orgs", "org", "организации", "компании"}:
            return _companies_cmd(tail)
        if head in {"agents", "people", "staff", "агенты", "сотрудники"}:
            return _agents_cmd(tail)
        if head in {"tasks", "issues", "list", "таски", "задачи"}:
            return _tasks_cmd(tail)
        if head in {"task", "issue", "t", "задача"}:
            return _task_cmd(tail)
        if head in {"comments", "comment", "комменты", "комментарии"}:
            return _comments_cmd(tail)
        if head in {"move", "m", "двинь", "перемести"}:
            return _move_cmd(tail)
    except PaperclipError as exc:
        return str(exc)

    return PC_HELP.strip()


def _safe(handler: Any, raw_args: str) -> str:
    try:
        return _clip(handler(raw_args))
    except PaperclipError as exc:
        return str(exc)
    except Exception as exc:
        logger.exception("paperclip command failed")
        return f"Paperclip command failed: {exc}"


def register(ctx: Any) -> None:
    ctx.register_command(
        name="pc",
        handler=lambda raw: _safe(_router, raw),
        description="Universal Paperclip command router.",
        args_hint="<companies|agents|tasks|task|comments|move|health>",
    )
    ctx.register_command(
        name="pc-companies",
        handler=lambda raw: _safe(_companies_cmd, raw),
        description="List Paperclip companies.",
        args_hint="",
    )
    ctx.register_command(
        name="pc-health",
        handler=lambda raw: _safe(_health, raw),
        description="Check Paperclip API health.",
        args_hint="",
    )
    ctx.register_command(
        name="pc-agents",
        handler=lambda raw: _safe(_agents_cmd, raw),
        description="List agents in a Paperclip company.",
        args_hint='[--company "Company Name"]',
    )
    ctx.register_command(
        name="pc-tasks",
        handler=lambda raw: _safe(_tasks_cmd, raw),
        description="List Paperclip tasks/issues.",
        args_hint='[--company "Company Name"] [open|all|todo|in_progress|blocked|done|cancelled] [limit]',
    )
    ctx.register_command(
        name="pc-task",
        handler=lambda raw: _safe(_task_cmd, raw),
        description="Show one Paperclip task/issue.",
        args_hint="ISSUE",
    )
    ctx.register_command(
        name="pc-comments",
        handler=lambda raw: _safe(_comments_cmd, raw),
        description="Show comments for one Paperclip task/issue.",
        args_hint="ISSUE",
    )
    ctx.register_command(
        name="pc-move",
        handler=lambda raw: _safe(_move_cmd, raw),
        description="Move a Paperclip task/issue to another status.",
        args_hint="ISSUE <todo|in_progress|blocked|done|cancelled>",
    )
