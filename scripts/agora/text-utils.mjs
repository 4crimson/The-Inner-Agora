export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function clip(text, limit = 7000) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[... clipped ${value.length - limit} chars ...]`;
}

export function cleanTitle(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 96) || "Agora request";
}

export function looseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, "");
}

export function looseStem(value) {
  const text = looseText(value);
  const suffixes = ["ами", "ями", "ого", "ему", "ому", "ыми", "ими", "ий", "ый", "ая", "ое", "ее", "ой", "ей", "ым", "им", "ом", "ем", "ах", "ях", "у", "ю", "е", "а", "я", "ы", "и"];
  for (const suffix of suffixes) {
    if (text.length - suffix.length >= 4 && text.endsWith(suffix)) return text.slice(0, -suffix.length);
  }
  return text;
}

export function searchStem(value) {
  return looseStem(value).replace(/ь$/u, "");
}

export function editDistance(left, right) {
  const a = Array.from(String(left || ""));
  const b = Array.from(String(right || ""));
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let row = 0; row <= a.length; row += 1) rows[row][0] = row;
  for (let column = 0; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost,
      );
    }
  }
  return rows[a.length][b.length];
}

export function oneLine(text, limit = 420) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 15)).trim()} ... [clipped]`;
}

export function extractHereDocBody(text) {
  const value = String(text || "");
  const match = value.match(/cat\s+<<['"]?([A-Za-z0-9_-]+)['"]?\s*\n([\s\S]*?)\n\1(?:\s|\)|$)/);
  if (match) return match[2].trim();
  const start = value.match(/cat\s+<<['"]?[A-Za-z0-9_-]+['"]?\s*\n/);
  return start ? value.slice((start.index || 0) + start[0].length).trim() : "";
}

export function slugify(text, fallback = "session") {
  const slug = String(text || "")
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 100)
    .trim()
    .replace(/\s/g, "-");
  return slug || fallback;
}
