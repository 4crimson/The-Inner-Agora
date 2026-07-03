import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = process.cwd();
const DEFAULT_DRIVER = path.join(TOOL_ROOT, "scripts", "telegram-userbot-driver.py");

export class TelegramUserbotError extends Error {
  constructor(message, { status = 1, stdout = "", stderr = "", payload = null } = {}) {
    super(message);
    this.name = "TelegramUserbotError";
    this.status = status;
    this.stdout = stdout;
    this.stderr = stderr;
    this.payload = payload;
  }
}

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout || "{}");
  } catch (error) {
    throw new TelegramUserbotError("Telegram userbot returned invalid JSON", { stdout });
  }
}

export class TelegramUserbot {
  constructor({ config, python = "python3", driverPath = DEFAULT_DRIVER, env = process.env } = {}) {
    this.config = config;
    this.python = env.TELEGRAM_USERBOT_PYTHON || python;
    this.driverPath = env.PAPERCLIP_QA_TELEGRAM_DRIVER || driverPath;
    this.env = env;
  }

  commandEnv() {
    return {
      ...this.env,
      TELEGRAM_TEST_TARGET: this.config.telegram.target,
      TELEGRAM_USERBOT_SESSION: this.config.telegram.userbot.session,
    };
  }

  run(args) {
    const result = spawnSync(this.python, [this.driverPath, ...args], {
      cwd: PROJECT_ROOT,
      env: this.commandEnv(),
      encoding: "utf8",
    });
    const payload = parseJsonOutput(result.stdout);
    if (result.error || result.status !== 0 || payload.ok === false) {
      throw new TelegramUserbotError(result.error?.message || "Telegram userbot command failed", {
        status: result.status || 1,
        stdout: result.stdout,
        stderr: result.stderr,
        payload,
      });
    }
    return payload;
  }

  checkEnv() {
    return this.run(["check-env"]);
  }

  history({ limit = 20, dryRun = false } = {}) {
    const args = ["history", "--limit", String(limit)];
    if (dryRun) args.push("--dry-run");
    return this.run(args);
  }

  send({ text, wait = 8, limit = 20, dryRun = false } = {}) {
    const args = ["send", String(text || ""), "--wait", String(wait), "--limit", String(limit)];
    if (dryRun) args.push("--dry-run");
    return this.run(args);
  }

  notify({ text, dryRun = false } = {}) {
    const args = ["notify", String(text || "")];
    if (dryRun) args.push("--dry-run");
    return this.run(args);
  }

  deleteMessages({ ids, dryRun = false } = {}) {
    const messageIds = [...new Set((ids || []).map((id) => Number(id)).filter(Number.isInteger))];
    const args = ["delete", "--ids", messageIds.join(",")];
    if (dryRun) args.push("--dry-run");
    return this.run(args);
  }
}
