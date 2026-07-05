export function parseNaturalArgs(args = [], env = process.env) {
  const options = {
    routingMode: env.ROUTING_MODE || "regex",
    json: false,
    dryRun: false,
    text: "",
  };
  const textParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--routing-mode") {
      options.routingMode = args[++index] || options.routingMode;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      textParts.push(arg);
    }
  }
  options.text = textParts.join(" ").trim();
  if (!options.text) throw new Error('Usage: node scripts/agora.mjs natural "human text"');
  return options;
}

export function naturalCommandPayload(command, extra = {}) {
  const text = command.join(" ");
  return {
    action: "rewrite",
    text,
    plan: { action: "command", command, text, ...(extra.plan || {}) },
    ...extra,
  };
}

export function naturalWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function naturalFollowUpRequested(text) {
  const value = naturalWords(text);
  return /уточн|продолж|спроси еще|по этой сессии|а что если/.test(value);
}

export function naturalNewTopicRequested(text) {
  const value = naturalWords(text);
  return /нов(ый|ая)\s+(вопрос|тема)|отдельн(ый|ая)\s+(вопрос|тема)|с нуля/.test(value);
}

export function naturalNewSessionRequested(text) {
  const value = naturalWords(text);
  return /спрос|задай|поставь|исслед|разобраться|собери|создай|консилиум|совет|запуст|запуск|начать|хочу\s+запустить/.test(value);
}

export function naturalReadOnlyRequested(text) {
  const value = naturalWords(text);
  return (
    /помощь|help|команды|как пользоваться|что доступно|возможности|готов|статус|что там|выжим|результат|итог|синтез|покажи|посмотри|таск|задач|issue|task|что сказал|подробнее|голос|позици|ответ/.test(
      value,
    ) || /(^|\s)(что|чем)\s+(ты\s+)?(умеешь|можешь)(\s|$)/u.test(value)
  );
}

export function stateTimestamp(state = {}) {
  return state.lastSynthesisSeenAt || state.lastIssueSeenAt || state.updatedAt || "";
}

export function lastSynthesisIsFresh(state = {}, now = new Date(), env = process.env) {
  if (!state.lastSynthesisRef) return false;
  const raw = stateTimestamp(state);
  if (!raw) return false;
  const timestamp = new Date(raw);
  if (Number.isNaN(timestamp.getTime())) return false;
  const hours = Number(env.INNER_AGORA_FOLLOWUP_WINDOW_HOURS || 24);
  const ageMs = now.getTime() - timestamp.getTime();
  return ageMs >= 0 && ageMs <= hours * 60 * 60 * 1000;
}

export function naturalContextFromState(text, state = {}, options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const lastRootIssueRef = state.lastRootIssueRef || "";
  const explicitFollowUp = Boolean(lastRootIssueRef && naturalFollowUpRequested(text));
  const implicitFollowUp = Boolean(
    lastRootIssueRef &&
      lastSynthesisIsFresh(state, now, env) &&
      !explicitFollowUp &&
      !naturalNewTopicRequested(text) &&
      !naturalNewSessionRequested(text) &&
      !naturalReadOnlyRequested(text),
  );
  return {
    lastRootIssueRef,
    lastSynthesisRef: state.lastSynthesisRef || "",
    isFollowUp: explicitFollowUp || implicitFollowUp,
    explicitFollowUp,
    implicitFollowUp,
  };
}
