import { TelegramUserbotError } from "./telegram-userbot.mjs";

function check(name, ok, details = {}) {
  return { name, ok: Boolean(ok), ...details };
}

export async function runHealthChecks({ config, userbot, paperclipClient }) {
  const checks = [
    check("config", true, {
      suites: Object.keys(config.suites || {}),
      telegramTarget: config.telegram.target,
      paperclipCompany: config.paperclip.company,
    }),
  ];

  try {
    const result = userbot.checkEnv();
    checks.push(check("telegram-userbot", Boolean(result.ok), {
      missing: result.missing || [],
      target: result.config?.target,
      session: result.config?.session,
    }));
  } catch (error) {
    const payload = error instanceof TelegramUserbotError ? error.payload : null;
    checks.push(check("telegram-userbot", false, {
      missing: payload?.missing || [],
      error: error.message || String(error),
    }));
  }

  try {
    const company = await paperclipClient.findCompanyByName(config.paperclip.company);
    checks.push(check("paperclip-company", Boolean(company), {
      companyId: company?.id || null,
      company: config.paperclip.company,
    }));
  } catch (error) {
    checks.push(check("paperclip-company", false, {
      company: config.paperclip.company,
      error: error.message || String(error),
    }));
  }

  return {
    ok: checks.every((item) => item.ok),
    checks,
  };
}
