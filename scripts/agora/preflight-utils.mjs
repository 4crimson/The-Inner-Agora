export const DEFAULT_ALL_MODE_CONFIRM_THRESHOLD = 12;

function selectedCount(selected) {
  if (Array.isArray(selected)) return selected.length;
  const count = Number(selected);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function quotedRequest(request) {
  const text = String(request || "").trim();
  if (!text) return '"<вопрос>"';
  return JSON.stringify(text);
}

export function allModePreflight({
  mode,
  all = false,
  selected = [],
  request = "",
  dryRun = false,
  confirmAll = false,
  threshold = DEFAULT_ALL_MODE_CONFIRM_THRESHOLD,
} = {}) {
  const roleCount = selectedCount(selected);
  const limit = Math.max(1, Number(threshold) || DEFAULT_ALL_MODE_CONFIRM_THRESHOLD);
  const allMode = mode === "all" || all;
  const requiresConfirmation = allMode && !dryRun && !confirmAll && roleCount >= limit;
  if (!requiresConfirmation) {
    return {
      ok: true,
      requiresConfirmation: false,
      roleCount,
      threshold: limit,
      message: "",
    };
  }

  const requestArg = quotedRequest(request);
  const lines = [
    "# Нужна проверка",
    `ask --all выберет ${roleCount} голосов и создаст ${roleCount} child-задач.`,
    `Сначала можно посмотреть состав: node scripts/agora.mjs ask --all --dry-run ${requestArg}`,
    `Если это намеренно, запусти: node scripts/agora.mjs ask --all --confirm-all ${requestArg}`,
  ];
  return {
    ok: false,
    requiresConfirmation: true,
    roleCount,
    threshold: limit,
    message: lines.join("\n"),
  };
}

export function allModePreflightLines(preflight) {
  if (!preflight || preflight.ok) return [];
  return String(preflight.message || "").split("\n").filter(Boolean);
}
