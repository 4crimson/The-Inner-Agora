export function startExampleForChamber(chamber) {
  if (chamber.id === "board-directors") {
    return {
      chamber: chamber.id,
      text: "совет директоров, нужен go/no-go по найму CTO",
    };
  }
  return {
    chamber: chamber.id,
    text: "давай спросим агору про свободу ребенка и власть родителей",
  };
}

export function buildStartExamples(chambers = []) {
  return chambers.map(startExampleForChamber);
}

export function startOnboardingLines(payload = {}) {
  const lines = [
    payload.title,
    "",
    "Пиши обычным языком: я пойму вопрос, выберу палату и создам задачи в Paperclip.",
    `Понимание текста: ${payload.routingMode === "llm" ? "локальная модель" : "детерминированный fallback"}.`,
    "",
    "Палаты:",
  ];
  for (const chamber of payload.chambers || []) {
    const marker = chamber.id === payload.activeChamberId ? "*" : "-";
    lines.push(`${marker} ${chamber.id}: ${chamber.name}`);
  }
  lines.push("", "Можно начать так:");
  for (const example of payload.examples || []) lines.push(`- ${example.text}`);
  return lines;
}
