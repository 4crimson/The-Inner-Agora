import path from "node:path";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function normalizeTokenUsage(usage = {}) {
  const payload = usage && typeof usage === "object" && !Array.isArray(usage) ? usage : {};
  const promptTokens = finiteNumber(payload.prompt_tokens ?? payload.promptTokens ?? payload.input_tokens ?? payload.inputTokens);
  const completionTokens = finiteNumber(
    payload.completion_tokens ?? payload.completionTokens ?? payload.output_tokens ?? payload.outputTokens,
  );
  const totalTokens = finiteNumber(payload.total_tokens ?? payload.totalTokens) || promptTokens + completionTokens;
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return { promptTokens, completionTokens, totalTokens };
}

export function tokenCostEntry({ kind = "llm", source = "", model = "", adapter = "", usage = {}, createdAt = "" } = {}) {
  const normalized = normalizeTokenUsage(usage);
  if (!normalized) return null;
  return {
    kind,
    source,
    model,
    adapter,
    ...normalized,
    createdAt: createdAt || new Date().toISOString(),
  };
}

export function appendCostLog(session = {}, entries = [], { maxEntries = 200 } = {}) {
  const current = Array.isArray(session?.costLog) ? session.costLog : [];
  const nextEntries = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  return {
    ...(session && typeof session === "object" && !Array.isArray(session) ? session : {}),
    costLog: [...current, ...nextEntries].slice(-maxEntries),
  };
}

function costLogFrom(value = {}) {
  if (Array.isArray(value?.costLog)) return value.costLog;
  if (Array.isArray(value?.session?.costLog)) return value.session.costLog;
  return [];
}

function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizePricingConfig(config = {}) {
  const payload = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const rawRates = payload.rates && typeof payload.rates === "object" && !Array.isArray(payload.rates) ? payload.rates : {};
  const rates = {};
  for (const [key, value] of Object.entries(rawRates)) {
    if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
    rates[key] = {
      inputPer1MTokens: nullableFiniteNumber(value.inputPer1MTokens ?? value.input_per_1m_tokens ?? value.promptPer1M),
      outputPer1MTokens: nullableFiniteNumber(value.outputPer1MTokens ?? value.output_per_1m_tokens ?? value.completionPer1M),
      totalPer1MTokens: nullableFiniteNumber(value.totalPer1MTokens ?? value.total_per_1m_tokens ?? value.per1M),
    };
  }
  return {
    currency: String(payload.currency || "USD").trim() || "USD",
    rates,
  };
}

function rateForEntry(entry = {}, pricing = {}) {
  const keys = [
    entry.model,
    entry.adapter,
    entry.source && entry.model ? `${entry.source}:${entry.model}` : "",
    entry.adapter && entry.model ? `${entry.adapter}:${entry.model}` : "",
  ].filter(Boolean);
  for (const key of keys) {
    if (pricing.rates?.[key]) return { key, rate: pricing.rates[key] };
  }
  return { key: "", rate: null };
}

function costForEntry(entry = {}, rate = {}) {
  const totalRate = nullableFiniteNumber(rate.totalPer1MTokens);
  if (totalRate !== null) return (finiteNumber(entry.totalTokens) / 1_000_000) * totalRate;
  const inputRate = nullableFiniteNumber(rate.inputPer1MTokens);
  const outputRate = nullableFiniteNumber(rate.outputPer1MTokens);
  if (inputRate === null && outputRate === null) return null;
  return (
    (finiteNumber(entry.promptTokens) / 1_000_000) * (inputRate || 0) +
    (finiteNumber(entry.completionTokens) / 1_000_000) * (outputRate || 0)
  );
}

export function costPricingSummary(value = {}, pricingConfig = {}) {
  const pricing = normalizePricingConfig(pricingConfig);
  const entries = costLogFrom(value).map((entry) => {
    const { key, rate } = rateForEntry(entry, pricing);
    const cost = rate ? costForEntry(entry, rate) : null;
    return {
      entry,
      priced: cost !== null,
      rateKey: key,
      cost: cost === null ? null : cost,
      currency: pricing.currency,
    };
  });
  return entries.reduce(
    (summary, pricedEntry) => {
      if (pricedEntry.priced) {
        summary.pricedCalls += 1;
        summary.knownCost += pricedEntry.cost || 0;
      } else {
        summary.unknownCalls += 1;
        summary.unknownTokens += finiteNumber(pricedEntry.entry?.totalTokens);
      }
      summary.entries.push(pricedEntry);
      return summary;
    },
    {
      currency: pricing.currency,
      knownCost: 0,
      pricedCalls: 0,
      unknownCalls: 0,
      unknownTokens: 0,
      entries: [],
    },
  );
}

export function costSummary(value = {}) {
  const log = costLogFrom(value);
  return log.reduce(
    (summary, entry) => ({
      calls: summary.calls + 1,
      promptTokens: summary.promptTokens + finiteNumber(entry.promptTokens),
      completionTokens: summary.completionTokens + finiteNumber(entry.completionTokens),
      totalTokens: summary.totalTokens + finiteNumber(entry.totalTokens),
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
}

export function costSummaryLine(value = {}) {
  const summary = costSummary(value);
  if (!summary.calls) return "";
  return `Токены LLM: ${summary.totalTokens} total (prompt ${summary.promptTokens}, completion ${summary.completionTokens}, calls ${summary.calls})`;
}

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

export function costDashboard(value = {}, { limit = 0, since = "", until = "", pricing = null } = {}) {
  const allEntries = costLogFrom(value);
  const sinceDate = parseTimestamp(since);
  const untilDate = parseTimestamp(until);
  let entries = allEntries.filter((entry) => {
    const createdAt = parseTimestamp(entry.createdAt);
    if (sinceDate && (!createdAt || createdAt < sinceDate)) return false;
    if (untilDate && (!createdAt || createdAt > untilDate)) return false;
    return true;
  });
  const parsedLimit = Number(limit);
  if (Number.isFinite(parsedLimit) && parsedLimit > 0) entries = entries.slice(-parsedLimit);
  const dashboard = {
    summary: costSummary({ costLog: entries }),
    entries,
    totalEntries: allEntries.length,
    shownEntries: entries.length,
    since: sinceDate ? sinceDate.toISOString() : "",
    until: untilDate ? untilDate.toISOString() : "",
  };
  if (pricing) dashboard.pricing = costPricingSummary({ costLog: entries }, pricing);
  return dashboard;
}

function pricingLine(pricing) {
  if (!pricing) return "";
  const amount = `$${Number(pricing.knownCost || 0).toFixed(6)} ${pricing.currency}`;
  const unknown =
    pricing.unknownCalls > 0
      ? `; unknown: ${pricing.unknownCalls} calls / ${pricing.unknownTokens} tokens`
      : "";
  return `Стоимость: ${amount} (priced ${pricing.pricedCalls} calls${unknown})`;
}

export function costDashboardLines(value = {}, options = {}) {
  const dashboard = costDashboard(value, options);
  const lines = ["# Стоимость и токены"];
  if (!dashboard.summary.calls) {
    lines.push("- Токенов пока нет в локальном state.");
    return lines;
  }
  lines.push(`- ${costSummaryLine({ costLog: dashboard.entries })}`);
  if (dashboard.pricing) lines.push(`- ${pricingLine(dashboard.pricing)}`);
  lines.push(`- Записей: ${dashboard.shownEntries}/${dashboard.totalEntries}`);
  if (dashboard.since || dashboard.until) {
    lines.push(`- Период: ${dashboard.since || "-"} .. ${dashboard.until || "-"}`);
  }
  lines.push("");
  lines.push("## Последние вызовы");
  for (const entry of dashboard.entries) {
    lines.push(
      `- ${entry.createdAt || "-"} ${entry.kind || "llm"} source=${entry.source || "-"} model=${entry.model || "-"} total=${finiteNumber(entry.totalTokens)} prompt=${finiteNumber(entry.promptTokens)} completion=${finiteNumber(entry.completionTokens)}`,
    );
  }
  return lines;
}

export function parseCostsArgs(args = [], options = {}) {
  const parsed = {
    json: false,
    limit: 20,
    since: "",
    until: "",
    pricingPath: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--limit") {
      parsed.limit = Number(args[++index] || 0);
      if (!Number.isFinite(parsed.limit) || parsed.limit < 0) throw new Error("--limit requires a non-negative number");
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(parsed.limit) || parsed.limit < 0) throw new Error("--limit requires a non-negative number");
    } else if (arg === "--since") {
      parsed.since = args[++index] || "";
      if (!parsed.since) throw new Error("--since requires an ISO timestamp");
    } else if (arg.startsWith("--since=")) {
      parsed.since = arg.slice("--since=".length);
      if (!parsed.since) throw new Error("--since requires an ISO timestamp");
    } else if (arg === "--until") {
      parsed.until = args[++index] || "";
      if (!parsed.until) throw new Error("--until requires an ISO timestamp");
    } else if (arg.startsWith("--until=")) {
      parsed.until = arg.slice("--until=".length);
      if (!parsed.until) throw new Error("--until requires an ISO timestamp");
    } else if (arg === "--hours") {
      const hours = Number(args[++index] || 0);
      if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours requires a positive number");
      const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
      parsed.since = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
    } else if (arg === "--pricing") {
      const value = args[++index] || "";
      if (!value) throw new Error("--pricing requires env, default, off, or a JSON file path");
      parsed.pricingPath = value;
    } else if (arg.startsWith("--pricing=")) {
      const value = arg.slice("--pricing=".length);
      if (!value) throw new Error("--pricing requires env, default, off, or a JSON file path");
      parsed.pricingPath = value;
    } else if (arg === "--help" || arg === "-h") {
      return { ...parsed, help: true };
    } else {
      throw new Error(`Unknown costs option: ${arg}`);
    }
  }
  return parsed;
}

export function costPricingPath(value = "", { root = process.cwd(), cwd = root, env = process.env } = {}) {
  const raw = String(value || "").trim();
  if (!raw || raw === "off") return "";
  if (raw === "env" || raw === "default") {
    return env.INNER_AGORA_COST_PRICING_CONFIG || path.join(root, "costs.config.json");
  }
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}
