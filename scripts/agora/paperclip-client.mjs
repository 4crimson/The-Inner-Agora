import { spawnSync } from "node:child_process";

export function shouldAutoRestartPaperclip(apiBase, env = process.env) {
  try {
    const parsed = new URL(apiBase);
    return (
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
      (parsed.port === "3100" || !parsed.port) &&
      env.INNER_AGORA_AUTO_RESTART_PAPERCLIP !== "0"
    );
  } catch {
    return false;
  }
}

export function restartPaperclipService({ root = process.cwd(), spawn = spawnSync } = {}) {
  const result = spawn("zsh", ["-lc", "launchctl kickstart -k gui/$(id -u)/local.paperclipai.default"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error?.message || "",
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function paperclipFetchError(pathname, options, url, error, recovery) {
  const lines = [
    `${options.method || "GET"} ${pathname} failed before HTTP response: ${error.message}`,
    `Paperclip API URL: ${url}`,
  ];
  if (recovery) {
    lines.push(`Auto-restart attempted: launchctl kickstart local.paperclipai.default exit=${recovery.status ?? "null"}`);
    if (recovery.stderr) lines.push(`Auto-restart stderr: ${recovery.stderr}`);
    if (recovery.error) lines.push(`Auto-restart error: ${recovery.error}`);
  }
  lines.push(
    "Most likely Paperclip is not running or the local port is unavailable.",
    "Check: curl http://127.0.0.1:3100/api/health",
    "Restart: launchctl kickstart -k gui/$(id -u)/local.paperclipai.default",
  );
  return new Error(lines.join("\n"));
}

export function wakeSummary(result) {
  if (!result) return "wake=not-requested";
  if (!result.ok) return `wake=failed (${result.error})`;
  const run = result.run || {};
  if (run.id) return `wake=${run.status || "queued"}:${run.id}`;
  return `wake=${run.status || "accepted"}`;
}

export function createPaperclipClient({
  apiBase = "http://127.0.0.1:3100/api",
  root = process.cwd(),
  fetchImpl = globalThis.fetch,
  shouldAutoRestart = () => shouldAutoRestartPaperclip(apiBase),
  restartService = () => restartPaperclipService({ root }),
  sleepImpl = sleep,
} = {}) {
  const normalizedApiBase = String(apiBase || "").replace(/\/$/, "");

  async function api(pathname, options = {}) {
    const url = `${normalizedApiBase}${pathname}`;
    const request = () =>
      fetchImpl(url, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });

    let response;
    try {
      response = await request();
    } catch (error) {
      if (shouldAutoRestart()) {
        const recovery = restartService();
        await sleepImpl(2500);
        try {
          response = await request();
        } catch (retryError) {
          throw paperclipFetchError(pathname, options, url, retryError, recovery);
        }
      } else {
        throw paperclipFetchError(pathname, options, url, error, null);
      }
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
    }
    return data;
  }

  async function createIssue(companyId, payload) {
    return api(`/companies/${companyId}/issues`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async function updateIssue(issueId, patch) {
    return api(`/issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async function addComment(issueId, body) {
    return api(`/issues/${issueId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async function wakeAgent(agentId, issueId, reason, options = {}) {
    const idempotencyKey = options.idempotencyKey || `inner-agora:${issueId}:${agentId}`;
    return api(`/agents/${agentId}/wakeup`, {
      method: "POST",
      body: JSON.stringify({
        source: "assignment",
        triggerDetail: "system",
        reason,
        payload: { issueId, source: "inner-agora" },
        idempotencyKey,
        forceFreshSession: Boolean(options.forceFreshSession),
      }),
    });
  }

  async function wakeAgentSafe(agentId, issueId, reason, options = {}) {
    try {
      const run = await wakeAgent(agentId, issueId, reason, options);
      return { ok: true, run };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }

  return { api, createIssue, updateIssue, addComment, wakeAgent, wakeAgentSafe };
}
