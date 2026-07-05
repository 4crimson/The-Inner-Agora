import { extractHereDocBody, oneLine } from "./text-utils.mjs";

export function meaningfulBody(text) {
  let body = String(text || "").trim();
  const hereDoc = extractHereDocBody(body);
  if (hereDoc) body = hereDoc;
  body = body.split(/⚠️\s*File-mutation verifier:/i)[0].trim();
  body = body.replace(/```(?:bash|sh|zsh|shell)\s*[\s\S]*?```\s*/gi, "").trim();
  return body;
}

export function normalizedDigestBody(text) {
  return meaningfulBody(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\*\*(\d+\.\s*[^*\n]+)\*\*\s*$/gm, "$1")
    .replace(/^\*\*(\d+\.\s*[^*\n]+)\*\*\s+(.+)$/gm, "$1\n$2")
    .trim();
}

export function hasSynthesisShape(text) {
  return /Реальный вопрос|Какой вопрос реально исследовался|Участники и их позиции|Карта позиций|Главные линии конфликта|Черновая матрица/i.test(
    normalizedDigestBody(text),
  );
}

export function rootQuestion(issue) {
  const body = String(issue.description || "");
  const match = body.match(/Исходный вопрос:\s*\n([\s\S]*?)(?:\n\n|$)/);
  return oneLine(match ? match[1] : issue.title, 900);
}

export function sectionBody(text, number) {
  const pattern = new RegExp(`(?:^|\\n)${number}\\.\\s+[^\\n]*\\n+([\\s\\S]*?)(?=\\n\\d+\\.\\s+|\\nПометки:|$)`);
  const match = normalizedDigestBody(text).match(pattern);
  return match ? match[1].trim() : "";
}

export function bulletLines(text, limit = 5) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .slice(0, limit)
    .map((line) => oneLine(line.replace(/^\*\s+/, "- "), 520));
}

export function paragraphLines(text, limit = 2) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((line) => oneLine(line, 620))
    .filter(Boolean)
    .slice(0, limit);
}

export function synthesisComment(commentsList) {
  const visible = commentsList.filter((item) => !item.deletedAt && String(item.body || "").trim());
  const scored = visible
    .map((comment) => {
      const rawBody = String(comment.body || "");
      const body = normalizedDigestBody(rawBody);
      let score = body.length;
      if (/Реальный вопрос|Какой вопрос реально исследовался|Участники и их позиции|Карта позиций|Главные линии конфликта/i.test(body)) score += 100000;
      if (comment.authorType === "agent") score += 1000;
      if (/PAPERCLIP_API|curl\s+-|jq\s|X-Paperclip-Run-Id|```bash/i.test(rawBody) && !extractHereDocBody(rawBody)) score -= 50000;
      if (/Задача .* завершена|SYNTHESIS VERIFIED|Final disposition|already marked as done/i.test(body)) score -= 50000;
      if (/Paperclip needs a disposition|Автоматически закрыто через Paperclip cockpit monitor/i.test(body)) score -= 50000;
      return { comment, score };
    })
    .sort((left, right) => right.score - left.score);
  return scored[0]?.comment || null;
}

export function printSynthesisDigest(comment) {
  const body = normalizedDigestBody(comment?.body || "");
  if (!body) {
    console.log("- Содержательного синтеза пока нет.");
    return false;
  }

  let printed = false;
  const positionsSection = /(?:^|\n)2\.\s+[^\n]*(участник|позици)/i.test(body) ? 2 : 3;
  const conflictsSection = positionsSection === 2 ? 3 : 4;
  const question = paragraphLines(sectionBody(body, 1), 1);
  const positions = bulletLines(sectionBody(body, positionsSection), 6);
  const positionParagraphs = positions.length ? [] : paragraphLines(sectionBody(body, positionsSection), 5);
  const conflicts = bulletLines(sectionBody(body, conflictsSection), 5);
  const unresolved = bulletLines(sectionBody(body, 6), 3);
  const next = paragraphLines(sectionBody(body, 7), 1);
  const notes = body.match(/Пометки:\s*([\s\S]*)$/)?.[1] || "";
  const noteLines = bulletLines(notes, 5);

  if (question.length) {
    console.log("Реальный вопрос:");
    for (const line of question) console.log(`- ${line}`);
    console.log("");
    printed = true;
  }

  if (positions.length) {
    console.log("Позиции:");
    for (const line of positions) console.log(line);
    console.log("");
    printed = true;
  }

  if (positionParagraphs.length) {
    console.log("Позиции:");
    for (const line of positionParagraphs) console.log(`- ${line}`);
    console.log("");
    printed = true;
  }

  if (conflicts.length) {
    console.log("Линии конфликта:");
    for (const line of conflicts) console.log(line);
    console.log("");
    printed = true;
  }

  if (unresolved.length) {
    console.log("Осталось нерешенным:");
    for (const line of unresolved) console.log(line);
    console.log("");
    printed = true;
  }

  if (next.length) {
    console.log("Следующий шаг:");
    for (const line of next) console.log(`- ${line}`);
    console.log("");
    printed = true;
  }

  if (noteLines.length) {
    console.log("Пометки:");
    for (const line of noteLines) console.log(line);
    printed = true;
  }
  return printed;
}

export function printVoiceDigest(comment) {
  const body = normalizedDigestBody(comment?.body || "");
  if (!body) {
    console.log("- Содержательного ответа пока нет.");
    return false;
  }

  const sections = [
    ["Как он понял вопрос", sectionBody(body, 1)],
    ["Позиция", sectionBody(body, 2)],
    ["Что скрыто в вопросе", sectionBody(body, 3)],
  ]
    .map(([title, section]) => [title, paragraphLines(section, 1)])
    .filter(([, lines]) => lines.length);

  if (!sections.length) return false;
  for (const [title, lines] of sections) {
    console.log(`${title}:`);
    for (const line of lines) console.log(`- ${line}`);
    console.log("");
  }
  return true;
}

export function printFallbackDigest(comment) {
  const body = normalizedDigestBody(comment?.body || "");
  if (!body) {
    console.log("- Содержательного результата пока нет.");
    return;
  }
  for (const line of paragraphLines(body, 6)) console.log(`- ${line}`);
}
