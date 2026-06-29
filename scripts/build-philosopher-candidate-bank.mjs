#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES_PATH = path.join(ROOT, "data", "philosopher-candidates.json");
const ACTIVE_PATH = path.join(ROOT, "data", "philosophers.json");
const CANDIDATE_DIR = path.join(ROOT, "philosophers", "candidates");
const CANDIDATE_PROMPTS_DIR = path.join(CANDIDATE_DIR, "prompts");
const ACTIVE_PROMPTS_DIR = path.join(ROOT, "philosophers", "prompts");
const ACTIVE_RESEARCH_DIR = path.join(ROOT, "philosophers", "research");
const ACTIVE_ROSTER_PATH = path.join(ROOT, "philosophers", "active-roster.md");
const PROMPT_START = "<!-- INNER_AGORA_PROMPT_START -->";
const PROMPT_END = "<!-- INNER_AGORA_PROMPT_END -->";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.replace(/\s+$/u, "")}\n`, "utf8");
}

function languagePolicy() {
  return [
    "ОБЯЗАТЕЛЬНАЯ ЯЗЫКОВАЯ ПОЛИТИКА:",
    "- По умолчанию отвечай по-русски.",
    "- Английский оставляй только для имен, терминов, команд, названий книг или точных понятий.",
    "- Если пользователь просит другой язык, следуй просьбе.",
    "- Не выдавай длинные англоязычные разделы без явного запроса.",
  ].join("\n");
}

function transparencyPolicy() {
  return [
    "ПРОТОКОЛ ПРОЗРАЧНОСТИ:",
    "- По возможности помечай ключевые утверждения: [источник], [реконструкция], [имитация], [современный перенос].",
    "- [источник] ставь там, где мысль опирается на конкретный текст, работу, фрагмент или устойчиво известную позицию; называй источник настолько точно, насколько уверен.",
    "- [реконструкция] ставь там, где ты выводишь позицию из общей философской оптики, но не даешь прямую цитату.",
    "- [имитация] ставь там, где это стилистическое разыгрывание голоса, темперамента или манеры.",
    "- [современный перенос] ставь там, где применяешь философа к теме, которой исторически не было в его горизонте.",
    "- Не выдумывай точные цитаты, страницы, ссылки и названия. Если не уверен, пиши: нужна проверка источника.",
    "- В конце ответа обязательно добавляй короткий блок `Пометки:` с пунктами: Источники, Реконструкция, Имитация голоса, Современный перенос, Требует проверки.",
  ].join("\n");
}

function safePublicFigureNote(item) {
  if (!item.safetyCare) return "";
  return [
    "",
    "ВАЖНО ПРО ЧУВСТВИТЕЛЬНУЮ ИЛИ СОВРЕМЕННУЮ ФИГУРУ:",
    "Не заявляй, что являешься этим человеком или передаешь его настоящую волю. Работай как реконструкция публичной, текстовой или традиционной оптики. Держи критическую дистанцию и не превращай ответ в агитацию, проповедь или политический призыв.",
  ].join("\n");
}

function sourceCaution(item) {
  const base = item.existingActive
    ? "У этого философа уже есть активное research-досье и Paperclip-промпт в основном составе."
    : "Это черновой портрет из большого канона. Перед глубокой имитацией нужен source spine: первичные тексты, надежные справочные источники и проверка терминов.";
  return [
    "ИСТОЧНИКОВАЯ ОСТОРОЖНОСТЬ:",
    `- ${base}`,
    `- Стартовая опора из intake-списка: ${item.sourceLine || item.description}.`,
    "- Если точный текст, термин, школа, дата или цитата не проверены, пиши `нужна проверка источника`.",
  ].join("\n");
}

function promptBody(item) {
  const activeDraft = item.existingActive
    ? "Это активная машина The Inner Agora. Основной, более детальный промпт уже лежит в `philosophers/prompts/`; этот candidate-файл служит индексом и рейтинговой карточкой."
    : item.paperclipActive
      ? "Это выбранная для Paperclip машина расширения. Промпт является рабочим draft v0: достаточно живым для запуска, но требует дальнейшего research-досье."
      : "Это candidate-only машина. Не включай ее в Paperclip без отдельной ручной проверки и усиления источников.";

  return [
    languagePolicy(),
    "",
    `Ты — философская машина "${item.name}" в The Inner Agora.`,
    "",
    promptActiveLine(item),
    "",
    activeDraft,
    "",
    "Ты не справочная статья и не современный консультант в маске философа. Ты реконструируешь интеллектуальную оптику: что этот мыслитель считает реальным, чего боится, что подозревает, как ломает вопрос и с кем спорит.",
    "",
    "Не утверждай, что ты настоящий исторический человек. Говори изнутри философской оптики, но отмечай границу реконструкции.",
    safePublicFigureNote(item),
    "",
    sourceCaution(item),
    "",
    transparencyPolicy(),
    "",
    "ЖЕСТ МЫШЛЕНИЯ:",
    item.centralGesture,
    "",
    "ВНУТРЕННИЙ ДВИГАТЕЛЬ:",
    `- Главная оптика: ${item.description}.`,
    `- Вопрос нужно пересобрать через этот жест: ${item.centralGesture}.`,
    "- Не отвечай универсальным философским голосом; удерживай конкретную форму мысли.",
    "- Если знания о корпусе неполны, честно снижай уверенность и помечай реконструкцию.",
    "",
    "ЧТО ТЫ ПОДОЗРЕВАЕШЬ:",
    `- Все ответы, которые обходят центральное напряжение: ${item.tension}.`,
    "- Плоскую модернизацию, где исторический мыслитель говорит как сегодняшний эксперт.",
    "- Цитаты без проверки и точные ссылки, которых нет в источниковой базе.",
    "",
    "КАК ВЕСТИ ДИАЛОГ:",
    "- Сначала пересобери вопрос в собственных понятиях.",
    "- Покажи, какое скрытое допущение вопрос становится видимым из твоей оптики.",
    "- Дай позицию, но отдели источник от реконструкции и стилистической имитации.",
    "- Назови, с кем из совета ты бы спорил.",
    "- Не говори за весь совет и не финализируй общий синтез.",
    "",
    "ТИПИЧНЫЕ ОШИБКИ ИМИТАЦИИ:",
    `- ${item.tension}.`,
    "- Делать из мыслителя безличный набор тезисов.",
    "- Убирать историческую дистанцию.",
    "- Выдавать черновую реконструкцию за прямой источник.",
    "",
    "ФОРМАТ ОТВЕТА В ЗАДАЧАХ PAPERCLIP:",
    "1. Как я пересобираю вопрос в своих понятиях.",
    "2. Моя позиция.",
    "3. Что в вопросе скрыто или неверно предполагается.",
    "4. С кем из других философов я бы спорил и почему.",
    "5. Что Agora Assistant должен забрать для синтеза.",
    "6. Пометки: источники, реконструкция, имитация голоса, современный перенос, что требует проверки.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}

function promptActiveLine(item) {
  if (item.existingActive) return "Статус: `active` — уже есть в основном составе Paperclip.";
  if (item.paperclipActive) return "Статус: `paperclip-selected` — добавляется в основной состав Paperclip.";
  return "Статус: `candidate-only` — хранится в банке портретов, но не импортируется в Paperclip.";
}

function candidateMarkdown(item) {
  const promptPath = item.existingActive || item.paperclipActive ? `../../prompts/${item.key}.md` : "";
  const researchPath = item.existingActive || item.paperclipActive ? `../../research/${item.key}.md` : "";
  return [
    `# ${item.name}`,
    "",
    `- Key: \`${item.key}\``,
    `- English name: ${item.englishName || item.name}`,
    `- Tradition / era: ${item.tradition || item.era}`,
    `- Candidate status: \`${item.status}\``,
    `- Paperclip active: ${item.paperclipActive ? "yes" : "no"}`,
    `- Rating: ${item.score}/100`,
    `- Knowledge level: \`${item.knowledgeLevel}\``,
    `- Tags: ${(item.tags || []).map((tag) => `\`${tag}\``).join(", ")}`,
    promptPath ? `- Active prompt: [${item.key}](${promptPath})` : "",
    researchPath ? `- Research stub/dossier: [${item.key}](${researchPath})` : "",
    "",
    "## Portrait",
    "",
    `**Gesture:** ${item.centralGesture}`,
    "",
    `**Voice:** ${item.voice}`,
    "",
    `**Tension / risk:** ${item.tension}`,
    "",
    `**Source intake line:** ${item.sourceLine || item.description}`,
    "",
    "## Draft Prompt",
    "",
    PROMPT_START,
    promptBody(item),
    PROMPT_END,
    "",
    "## Next Research",
    "",
    "- Собрать первичные тексты и надежные справочные источники.",
    "- Уточнить ключевые понятия на языке традиции.",
    "- Сделать 3-5 voice tests, чтобы голос узнавался без имени.",
    "- Решить, нужен ли Paperclip-агент или достаточно reference-only узла.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}

function activePromptMarkdown(item) {
  return [
    `# ${item.name}`,
    "",
    `- Key: \`${item.key}\``,
    `- English name: ${item.englishName || item.name}`,
    "- Роль: Философская машина The Inner Agora",
    `- Эпоха: ${item.era}`,
    `- Оптика: ${item.title}`,
    `- Алиасы: ${(item.aliases || [item.key]).map((alias) => `\`${alias}\``).join(", ")}`,
    `- Теги: ${(item.tags || []).map((tag) => `\`${tag}\``).join(", ")}`,
    "",
    "## Рабочий Paperclip-промпт",
    "",
    "Draft v0 из candidate bank. Редактируй текст между маркерами; `scripts/import-inner-agora.mjs` синхронизирует именно этот блок.",
    "",
    PROMPT_START,
    promptBody(item),
    PROMPT_END,
    "",
    "## Заметки для дальнейшей проработки",
    "",
    `- Candidate rating: ${item.score}/100.`,
    `- Knowledge level: \`${item.knowledgeLevel}\`.`,
    `- Source intake line: ${item.sourceLine || item.description}.`,
    "- Следующий шаг: заменить draft source caution полноценным research spine.",
  ].join("\n");
}

function researchMarkdown(item) {
  return [
    `# ${item.name}: research stub`,
    "",
    "## Status",
    "",
    "Черновое досье создано из большого candidate bank. Оно достаточно для честного draft-промпта, но не заменяет полноценный research pass.",
    "",
    "## Source spine to build",
    "",
    `- Intake line: ${item.sourceLine || item.description}.`,
    "- Primary texts: нужна ручная проверка и перечисление конкретных работ.",
    "- Reference sources: SEP/IEP/энциклопедии/академические издания по необходимости.",
    "",
    "## Gesture of thought",
    "",
    item.centralGesture,
    "",
    "## Inner engine",
    "",
    `- ${item.description}.`,
    "- Держать историческую дистанцию и маркировать реконструкцию.",
    "- Не выдавать непроверенные цитаты или страницы.",
    "",
    "## Common imitation failures",
    "",
    `- ${item.tension}.`,
    "- Универсальный философский голос вместо отличимой личности.",
    "- Современный перенос без пометки.",
    "",
    "## Activation note",
    "",
    item.paperclipActive
      ? "Выбран для Paperclip как интересный имитатор личности. Требует дальнейшей ручной детализации."
      : "Не выбран для Paperclip на текущем этапе.",
  ].join("\n");
}

function activeDataItem(item) {
  return {
    key: item.key,
    name: item.name,
    englishName: item.englishName || item.name,
    era: item.era || item.tradition,
    title: item.title,
    aliases: item.aliases || [item.key, item.name.toLowerCase()],
    tags: [...new Set([...(item.tags || []).filter((tag) => tag !== "candidate"), "expanded"])],
    centralIntuition: item.centralGesture,
    voice: item.voice,
    tension: item.tension,
    candidateGenerated: true,
    candidateScore: item.score,
    safetyCare: Boolean(item.safetyCare),
  };
}

function ratingMarkdown(candidates) {
  const rows = candidates
    .slice()
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .map((item) =>
      [
        `| ${item.score} | \`${item.key}\` | ${item.name} | ${item.status} | ${item.paperclipActive ? "yes" : "no"} | ${item.centralGesture.replace(/\|/g, "/")} |`,
      ].join(""),
    );
  return [
    "# Candidate Rating",
    "",
    "Рейтинг отвечает не на вопрос `кто важнее в истории философии`, а на вопрос `кто даст интересную, отличимую и полезную машину личности для The Inner Agora`.",
    "",
    "| Score | Key | Name | Status | Paperclip | Why interesting |",
    "|-------|-----|------|--------|-----------|-----------------|",
    ...rows,
  ].join("\n");
}

function activationMarkdown(candidates) {
  const active = candidates.filter((item) => item.paperclipActive);
  const candidateOnly = candidates.filter((item) => !item.paperclipActive);
  return [
    "# Paperclip Activation",
    "",
    "В Paperclip импортируется только `data/philosophers.json`. Этот файл фиксирует, кто из большого банка туда добавлен.",
    "",
    `- Total candidates: ${candidates.length}`,
    `- Paperclip active after expansion: ${active.length}`,
    `- Candidate-only / reference pool: ${candidateOnly.length}`,
    "",
    "## Active",
    "",
    "| Key | Name | Score | Status |",
    "|-----|------|-------|--------|",
    ...active.map((item) => `| \`${item.key}\` | ${item.name} | ${item.score} | ${item.status} |`),
    "",
    "## Candidate-only",
    "",
    "| Key | Name | Score | Status |",
    "|-----|------|-------|--------|",
    ...candidateOnly.map((item) => `| \`${item.key}\` | ${item.name} | ${item.score} | ${item.status} |`),
  ].join("\n");
}

function candidatesReadme(candidates) {
  return [
    "# Philosopher Candidate Bank",
    "",
    "Здесь лежит широкий банк философских портретов. Каждый файл в `prompts/` содержит короткий портрет и draft-промпт.",
    "",
    "Важно: не все кандидаты являются Paperclip-агентами. Paperclip импортирует только основной `data/philosophers.json`.",
    "",
    "- [rating.md](rating.md) — общий рейтинг интересности как имитаторов личности.",
    "- [activation-paperclip.md](activation-paperclip.md) — кто реально добавлен в Paperclip.",
    "- [prompts/](prompts/) — портреты и draft-промпты для всех кандидатов.",
    "",
    `Всего кандидатов: ${candidates.length}.`,
  ].join("\n");
}

function activeRosterMarkdown(active) {
  return [
    "# Active Paperclip Roster",
    "",
    "Этот список генерируется из `data/philosophers.json`. Именно эти машины импортируются в Paperclip при `node scripts/agora.mjs prepare`.",
    "",
    "| Key | Name | Era | Score | Prompt | Research |",
    "|-----|------|-----|-------|--------|----------|",
    ...active.map((item) => {
      const score = item.candidateScore || 100;
      return `| \`${item.key}\` | ${item.name} | ${item.era} | ${score} | [prompt](prompts/${item.key}.md) | [research](research/${item.key}.md) |`;
    }),
  ].join("\n");
}

function main() {
  const candidates = readJson(CANDIDATES_PATH);
  const existingActive = readJson(ACTIVE_PATH);
  const activeByKey = new Map(existingActive.map((item) => [item.key, item]));
  const selected = candidates.filter((item) => item.paperclipActive);

  fs.mkdirSync(CANDIDATE_PROMPTS_DIR, { recursive: true });
  for (const item of candidates) {
    writeFile(path.join(CANDIDATE_PROMPTS_DIR, `${item.key}.md`), candidateMarkdown(item));
  }

  const mergedActive = [...existingActive];
  for (const item of selected) {
    const existing = activeByKey.get(item.key);
    if (!existing) {
      const dataItem = activeDataItem(item);
      mergedActive.push(dataItem);
      activeByKey.set(item.key, dataItem);
      writeFile(path.join(ACTIVE_PROMPTS_DIR, `${item.key}.md`), activePromptMarkdown(item));
      writeFile(path.join(ACTIVE_RESEARCH_DIR, `${item.key}.md`), researchMarkdown(item));
      continue;
    }

    if (existing.candidateGenerated) {
      writeFile(path.join(ACTIVE_PROMPTS_DIR, `${item.key}.md`), activePromptMarkdown(item));
      writeFile(path.join(ACTIVE_RESEARCH_DIR, `${item.key}.md`), researchMarkdown(item));
    }
  }

  writeFile(ACTIVE_PATH, JSON.stringify(mergedActive, null, 2));
  writeFile(path.join(CANDIDATE_DIR, "README.md"), candidatesReadme(candidates));
  writeFile(path.join(CANDIDATE_DIR, "rating.md"), ratingMarkdown(candidates));
  writeFile(path.join(CANDIDATE_DIR, "activation-paperclip.md"), activationMarkdown(candidates));
  writeFile(ACTIVE_ROSTER_PATH, activeRosterMarkdown(mergedActive));

  console.log(
    JSON.stringify(
      {
        candidates: candidates.length,
        paperclipActive: selected.length,
        newPaperclipAgents: mergedActive.length - existingActive.length,
        activeTotal: mergedActive.length,
      },
      null,
      2,
    ),
  );
}

main();
