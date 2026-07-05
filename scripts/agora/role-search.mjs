import { editDistance, looseStem, looseText, searchStem } from "./text-utils.mjs";

export function roleAliases(item) {
  return [item.key, item.name, item.englishName, ...(item.aliases || [])].filter(Boolean);
}

export function roleByToken(roles, token) {
  const normalized = String(token || "").trim().toLowerCase();
  const normalizedLoose = looseText(normalized);
  const normalizedStem = looseStem(normalized);
  return roles.find((item) => {
    return roleAliases(item).some((alias) => {
      const aliasText = String(alias || "").trim().toLowerCase();
      const aliasLoose = looseText(aliasText);
      return (
        aliasText === normalized ||
        aliasLoose === normalizedLoose ||
        (normalizedLoose.length >= 4 && aliasLoose.includes(normalizedLoose)) ||
        (normalizedStem.length >= 4 && looseStem(aliasText) === normalizedStem)
      );
    });
  });
}

export function roleSearchEntry(item, query) {
  const queryText = String(query || "").trim();
  const queryLoose = looseText(queryText);
  const queryStem = searchStem(queryText);
  if (!queryLoose) return null;

  let best = null;
  for (const alias of roleAliases(item)) {
    const aliasText = String(alias || "").trim();
    const aliasLoose = looseText(aliasText);
    const aliasStem = searchStem(aliasText);
    if (!aliasLoose) continue;

    const exact = aliasLoose === queryLoose;
    const caseMatch = queryStem.length >= 4 && aliasStem === queryStem;
    const startsWith = queryStem.length >= 3 && aliasStem.startsWith(queryStem);
    const contains = queryStem.length >= 4 && aliasStem.includes(queryStem);
    const distance = queryStem && aliasStem ? editDistance(queryStem, aliasStem) : 999;
    const maxLength = Math.max(queryStem.length, aliasStem.length, 1);
    const close = distance <= Math.max(2, Math.floor(maxLength * 0.28));
    let score = 0;
    if (exact) score = 10000 + aliasLoose.length;
    else if (caseMatch) score = 9000 + aliasStem.length;
    else if (startsWith) score = 8000 + queryStem.length;
    else if (contains) score = 7000 + queryStem.length;
    else if (close) score = 6000 - distance * 100 + aliasStem.length;
    else score = Math.max(0, 1000 - distance * 20);

    const candidate = { item, alias: aliasText, exact, caseMatch, distance, score };
    if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.distance < best.distance)) {
      best = candidate;
    }
  }
  return best;
}

export function roleSearchSummary(entry) {
  return {
    key: entry.item.key,
    name: entry.item.name,
    englishName: entry.item.englishName,
    alias: entry.alias,
    score: entry.score,
    distance: entry.distance,
  };
}

export function searchRoles(roles, query, limit = 3) {
  const matches = roles
    .map((item) => roleSearchEntry(item, query))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.distance - right.distance || left.item.key.localeCompare(right.item.key));
  const selected = matches.find((entry) => entry.exact || entry.caseMatch) || null;
  const relevant = matches.filter((entry) => entry.exact || entry.caseMatch || entry.score >= 5000);
  return {
    query: String(query || "").trim(),
    selected: selected ? roleSearchSummary(selected) : null,
    matches: relevant.slice(0, limit).map(roleSearchSummary),
  };
}

export function roleScoreInText(item, text) {
  const haystack = looseText(text);
  if (!haystack) return 0;
  let score = 0;
  for (const alias of roleAliases(item)) {
    const exact = looseText(alias);
    const stem = looseStem(alias);
    if (exact && haystack.includes(exact)) score = Math.max(score, exact.length + 20);
    if (stem && stem.length >= 4 && haystack.includes(stem)) score = Math.max(score, stem.length + 10);
  }
  return score;
}

export function roleFromText(roles, text) {
  const exact = roleByToken(roles, String(text || "").replace(/[^\p{L}\p{N}_ -]+/gu, "").trim());
  if (exact) return exact;
  return roles
    .map((item) => ({ item, score: roleScoreInText(item, text) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key))[0]?.item || null;
}

export function uniqueRoles(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function genericRoleScore(item, request) {
  const haystack = looseText(
    [
      item.key,
      item.name,
      item.englishName,
      item.title,
      item.centralIntuition,
      ...(item.aliases || []),
      ...(item.tags || []),
    ].join(" "),
  );
  return looseText(request)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}
