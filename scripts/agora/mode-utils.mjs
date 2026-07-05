export function normalizeMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["min", "minimum", "минимум", "мин"].includes(normalized)) return "min";
  if (["local", "локально", "локальный"].includes(normalized)) return "local";
  if (["balanced", "balance", "умный", "средний"].includes(normalized)) return "balanced";
  if (["max", "maximum", "макс", "максимум"].includes(normalized)) return "max";
  if (["all", "все", "всё"].includes(normalized)) return "all";
  throw new Error(`Unknown mode: ${value}`);
}

export function detectMode(request, fallback) {
  if (/всех|все философы|full agora|all voices/i.test(request)) return "all";
  if (/максимальн|макс|deep|глубок/i.test(request)) return "max";
  if (/быстро|коротко|мин/i.test(request)) return "min";
  return fallback;
}

export function requestedVoiceLimit(request) {
  const text = request.toLowerCase();
  const countContext = /философ|голос|участ|подход|сильн|выбор|voices|thinkers|participants/.test(text);
  if (!countContext) return null;

  if (/(?:пар[уыа]?|двух|двум|два)\s*(?:философ|голос|участ|подход|voices|thinkers|participants)/.test(text)) return 2;
  if (/(?:одному|один|1)\s*[-–—]?\s*(?:двум|два|2)\s*(?:философ|голос|участ|подход|voices|thinkers|participants)/.test(text)) return 2;

  const range = text.match(/\b([2-9]|1[0-9])\s*[-–—]\s*([2-9]|1[0-9])\b/);
  if (range) return Math.max(Number(range[1]), Number(range[2]));

  const single = text.match(/\b([2-9]|1[0-9])\s*(?:философ|голос|участ|подход|сильн|voices|thinkers|participants)\b/);
  return single ? Number(single[1]) : null;
}

export function selectedRoleLimit(request, mode) {
  const limits = {
    min: 3,
    local: 5,
    balanced: 7,
    max: 12,
  };
  const modeLimit = limits[mode] || limits.balanced;
  const requestedLimit = requestedVoiceLimit(request);
  return requestedLimit ? Math.min(modeLimit, requestedLimit) : modeLimit;
}
