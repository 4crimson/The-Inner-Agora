import { rootQuestion } from "./digest-utils.mjs";
import { clip } from "./text-utils.mjs";

const DEFAULT_PHILOSOPHY_CHAMBER = { id: "philosophy", name: "The Inner Agora" };

function chamberOrDefault(chamber) {
  return chamber || DEFAULT_PHILOSOPHY_CHAMBER;
}

export function isPhilosophyChamber(chamber = DEFAULT_PHILOSOPHY_CHAMBER) {
  return chamberOrDefault(chamber).id === "philosophy";
}

export function modePolicy(mode, chamber = DEFAULT_PHILOSOPHY_CHAMBER) {
  if (!isPhilosophyChamber(chamber)) {
    if (mode === "all") return "Режим all: участвуют все роли из текущей палаты.";
    if (mode === "max") return "Режим max: широкий совет ролей для выявления конфликтов, рисков и условий решения.";
    if (mode === "balanced") return "Режим balanced: 5-7 релевантных ролей, достаточно глубоко без расползания.";
    if (mode === "local") return "Режим local: короткий совет без внешней проверки; полезен для быстрых локальных запусков.";
    return "Режим min: 3 роли, быстрый первый разбор.";
  }
  if (mode === "all") return "Режим all: участвуют все философские машины из текущего состава.";
  if (mode === "max") return "Режим max: широкий совет, но не обязательно весь пантеон; цель — сильный конфликт перспектив.";
  if (mode === "balanced") return "Режим balanced: 5-7 релевантных голосов, достаточно глубоко без расползания.";
  if (mode === "local") return "Режим local: короткий совет без внешней проверки; полезен для быстрых локальных запусков.";
  return "Режим min: 3 голоса, быстрый первый разбор.";
}

export function roleLine(item) {
  const architect = item.architect ? " architect" : "";
  return `- ${item.name}${architect}: ${item.title}`;
}

export function buildRootDescription({ request, mode, selected, chamber = DEFAULT_PHILOSOPHY_CHAMBER }) {
  const currentChamber = chamberOrDefault(chamber);
  if (!isPhilosophyChamber(currentChamber)) {
    const agentLabel = currentChamber.labels?.agents || "roles";
    const taskLabel = currentChamber.labels?.task || "task";
    return [
      `Запрос пользователя для ${currentChamber.name}.`,
      "",
      modePolicy(mode, currentChamber),
      "",
      `Выбранные участники (${agentLabel}):`,
      selected.map(roleLine).join("\n"),
      "",
      "Исходный вопрос:",
      request,
      "",
      "Как работать с этой задачей:",
      `- Тип корневой задачи: ${taskLabel}.`,
      `- Child-задачи создаются отдельно и назначаются выбранным участникам (${agentLabel}).`,
      "- Участники дают собственные advisory-позиции и не финализируют общий вывод.",
      "- После ответов запусти синтез: `node scripts/agora.mjs synthesize ISSUE_ID_OR_KEY`.",
      "- Итоговый memo должен сохранить расхождения, условия решения, риски и следующий шаг.",
    ].join("\n");
  }

  return [
    "Запрос пользователя для The Inner Agora.",
    "",
    modePolicy(mode, currentChamber),
    "",
    "Выбранные философские машины:",
    selected.map(roleLine).join("\n"),
    "",
    "Исходный вопрос:",
    request,
    "",
    "Как работать с этой задачей:",
    "- Это корневой протокол сессии.",
    "- Child-задачи создаются отдельно и назначаются философам.",
    "- Философы не должны изображать общий итог; они дают собственную позицию.",
    "- После ответов запусти синтез: `node scripts/agora.mjs synthesize ISSUE_ID_OR_KEY`.",
    "- Итоговый Agora Assistant memo должен сохранить конфликт, а не сгладить его.",
  ].join("\n");
}

export function buildRoleDescription({
  rootIssue,
  request,
  mode,
  philosopher,
  chamber = DEFAULT_PHILOSOPHY_CHAMBER,
  transparencyText = "",
}) {
  const currentChamber = chamberOrDefault(chamber);
  if (!isPhilosophyChamber(currentChamber)) {
    const agentLabel = currentChamber.labels?.agent || "role";
    const agentsLabel = currentChamber.labels?.agents || "roles";
    const taskLabel = currentChamber.labels?.task || "task";
    return [
      `Ты выступаешь как ${agentLabel} "${philosopher.name}" в палате "${currentChamber.name}".`,
      "",
      `Корневое ${taskLabel}: ${rootIssue.identifier || rootIssue.id} — ${rootIssue.title}`,
      modePolicy(mode, currentChamber),
      "",
      "Профиль:",
      `- Область: ${philosopher.era}`,
      `- Фокус: ${philosopher.title}`,
      `- Центральная интуиция: ${philosopher.centralIntuition}`,
      `- Манера: ${philosopher.voice}`,
      `- Напряжение / слепая зона: ${philosopher.tension}`,
      "",
      "Вопрос:",
      request,
      "",
      transparencyText,
      "",
      "Формат ответа:",
      "1. Как я пересобираю запрос в своей зоне ответственности.",
      "2. Моя advisory-позиция.",
      "3. Какие предпосылки, данные или проверки отсутствуют.",
      `4. С кем из выбранных ${agentsLabel} я бы спорил и почему.`,
      "5. Что синтезатор должен забрать в итог.",
      "6. Пометки: данные, предположения, риски, условия решения, что требует проверки.",
      "",
      "Ограничения:",
      "- Не говори за всю палату.",
      "- Не финализируй общий вывод.",
      "- Не выдавай профессиональную рекомендацию там, где нужна проверка или профильный специалист.",
      "- Не сглаживай собственную позицию ради согласия.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Ты выступаешь как философская машина "${philosopher.name}" в The Inner Agora.`,
    "",
    `Корневая сессия: ${rootIssue.identifier || rootIssue.id} — ${rootIssue.title}`,
    modePolicy(mode, currentChamber),
    "",
    "Профиль:",
    `- Эпоха: ${philosopher.era}`,
    `- Оптика: ${philosopher.title}`,
    `- Центральная интуиция: ${philosopher.centralIntuition}`,
    `- Манера: ${philosopher.voice}`,
    `- Напряжение / слепая зона: ${philosopher.tension}`,
    philosopher.contemporaryPublicFigure
      ? "- Ограничение: это реконструкция публичной интеллектуальной оптики, а не речь самого человека."
      : "",
    "",
    "Вопрос:",
    request,
    "",
    transparencyText,
    "",
    "Формат ответа:",
    "1. Как я пересобираю вопрос в своих понятиях.",
    "2. Моя позиция.",
    "3. Что в вопросе скрыто или неверно предполагается.",
    "4. С кем из выбранных философов я бы спорил и почему.",
    "5. Что Agora Assistant должен забрать в синтез.",
    "6. Пометки: источники, реконструкция, имитация голоса, современный перенос, что требует проверки.",
    "",
    "Ограничения:",
    "- Не говори за весь совет.",
    "- Не финализируй общий вывод.",
    "- Не притворяйся буквальным историческим лицом.",
    "- Не сглаживай собственную позицию ради согласия.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDialogueDescription({
  request,
  philosopher,
  chamber = DEFAULT_PHILOSOPHY_CHAMBER,
  transparencyText = "",
}) {
  const currentChamber = chamberOrDefault(chamber);
  return [
    isPhilosophyChamber(currentChamber)
      ? `Диалог пользователя с философской машиной "${philosopher.name}" в The Inner Agora.`
      : `Диалог пользователя с ролью "${philosopher.name}" в палате "${currentChamber.name}".`,
    "",
    "Профиль:",
    `- Эпоха: ${philosopher.era}`,
    `- Оптика: ${philosopher.title}`,
    `- Центральная интуиция: ${philosopher.centralIntuition}`,
    `- Манера: ${philosopher.voice}`,
    `- Напряжение / слепая зона: ${philosopher.tension}`,
    philosopher.contemporaryPublicFigure
      ? "- Ограничение: это реконструкция публичной интеллектуальной оптики, а не речь самого человека."
      : "",
    "",
    "Вопрос / начало диалога:",
    request,
    "",
    transparencyText,
    "",
    "Веди живой философский диалог. Если вопрос поставлен поверхностно, сопротивляйся и уточняй. Отвечай по-русски, если пользователь не просит иначе. Даже в диалоге заканчивай содержательные ответы коротким блоком `Пометки:`.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDialogueWithContextDescription({
  rootIssue,
  synthesisIssue,
  synthesisText,
  request,
  philosopher,
  chamber = DEFAULT_PHILOSOPHY_CHAMBER,
  transparencyText = "",
}) {
  const currentChamber = chamberOrDefault(chamber);
  return [
    isPhilosophyChamber(currentChamber)
      ? `Контекстный диалог с философской машиной "${philosopher.name}" в The Inner Agora.`
      : `Контекстный диалог с ролью "${philosopher.name}" в палате "${currentChamber.name}".`,
    "",
    `Корневая сессия: ${rootIssue.identifier || rootIssue.id} — ${rootIssue.title}`,
    "",
    `Корневой вопрос: ${rootQuestion(rootIssue)}`,
    "",
    synthesisIssue ? `Синтез: ${synthesisIssue.identifier || synthesisIssue.id} — ${synthesisIssue.title}` : "Синтез: пока не найден.",
    "",
    "Выжимка синтеза:",
    synthesisText ? clip(synthesisText, 6500) : "Содержательной выжимки пока нет. Ответь осторожно и явно отметь нехватку контекста.",
    "",
    "Вопрос пользователя к роли:",
    request,
    "",
    "Профиль:",
    `- Эпоха: ${philosopher.era}`,
    `- Оптика: ${philosopher.title}`,
    `- Центральная интуиция: ${philosopher.centralIntuition}`,
    `- Манера: ${philosopher.voice}`,
    `- Напряжение / слепая зона: ${philosopher.tension}`,
    "",
    transparencyText,
    "",
    "Ответь именно как продолжение этой сессии. Сначала отреагируй на вопрос пользователя, затем явно свяжи ответ с линиями синтеза. Не создавай новый общий обзор.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildFollowUpDescription({
  rootIssue,
  request,
  philosopher,
  chamber = DEFAULT_PHILOSOPHY_CHAMBER,
  transparencyText = "",
}) {
  return [
    `Follow-up к сессии: ${rootIssue.identifier || rootIssue.id}`,
    "",
    `Корневой вопрос: ${rootQuestion(rootIssue)}`,
    "",
    `Уточнение для роли: ${philosopher.name}`,
    "",
    request,
    "",
    "Ответь как продолжение уже начатой сессии. Не создавай новый общий обзор, а уточни именно этот follow-up.",
    "",
    transparencyText,
  ].join("\n");
}

export function buildSynthesisDescription({ root, childBlocks = [] }) {
  const description = [
    "Agora Assistant: собери синтез философской сессии.",
    "",
    "Не изображай голоса, которых нет в материалах. Если child-задачи еще пустые, явно скажи, что синтез предварительный.",
    "",
    "Формат:",
    "1. Реальный вопрос сессии.",
    "2. Участники и их позиции.",
    "3. Главные линии конфликта.",
    "4. Скрытые предпосылки вопроса.",
    "5. Сильнейшие аргументы.",
    "6. Нерешенные вопросы.",
    "7. Следующий исследовательский или практический шаг.",
    "8. Как использованы пометки: источники, реконструкции, имитации, современные переносы, что требует проверки.",
    "",
    "Ограничения:",
    "- Не стирай пометки философов о типе утверждения.",
    "- Не превращай [имитация] или [реконструкция] в якобы подтвержденный источник.",
    "- Если источник требует проверки, сохрани это как исследовательский долг.",
    "",
    "Корневая сессия:",
    `# ${root.identifier || root.id}: ${root.title}`,
    "",
    clip(root.description || "", 4000),
    "",
    "# Материалы философов",
    "",
    childBlocks.length ? childBlocks.join("\n\n---\n\n") : "Child-задач нет.",
  ].join("\n");

  return clip(description, 24000);
}
