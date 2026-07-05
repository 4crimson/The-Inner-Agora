import { looseText } from "./text-utils.mjs";

export function wizardInitialSlots() {
  return {
    intent: "new_session",
    chamber: null,
    mode: "balanced",
    topic: null,
    roles: [],
    taskRef: null,
    missingSlots: ["topic"],
    confidence: 0.8,
  };
}

export function chamberChoiceLines(chambers = []) {
  return chambers.map((chamber, index) => `${index + 1}. ${chamber.id} — ${chamber.name}`);
}

export function parseWizardChamber(answer, chambers = [], defaultChamberId = "philosophy") {
  const value = looseText(answer);
  if (value === "1") return chambers[0]?.id || defaultChamberId;
  if (value === "2") return chambers[1]?.id || chambers[0]?.id || defaultChamberId;
  if (value.includes("board") || value.includes("директор") || value.includes("бизнес")) return "board-directors";
  if (value.includes("philosophy") || value.includes("философ") || value.includes("агора")) return "philosophy";
  return chambers.find((chamber) => value.includes(looseText(chamber.id)) || value.includes(looseText(chamber.name)))?.id || "";
}

export function parseWizardMode(answer) {
  const value = looseText(answer);
  if (value === "1" || value.includes("корот") || value.includes("кратк") || value.includes("min")) return "min";
  if (value === "3" || value.includes("глуб") || value.includes("подроб") || value.includes("max")) return "max";
  if (value === "2" || value.includes("обыч") || value.includes("баланс") || value.includes("balanced")) return "balanced";
  return "";
}

export function wizardConfirmed(answer) {
  return /^(да|yes|y|go|ок|окей|запускай|start)$/i.test(looseText(answer));
}

export function wizardCancelled(answer) {
  return /^(нет|no|n|cancel|отмена|стоп)$/i.test(looseText(answer));
}
