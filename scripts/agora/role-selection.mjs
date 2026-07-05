import { selectedRoleLimit } from "./mode-utils.mjs";
import {
  genericRoleScore,
  roleByToken,
  roleScoreInText,
  uniqueRoles,
} from "./role-search.mjs";

function roleMap(roles) {
  return new Map(roles.map((item) => [item.key, item]));
}

function addRolesByKey(selected, byKey, keys) {
  for (const key of keys) selected.push(byKey.get(key));
}

export function selectPhilosophyRoles({ roles, request, mode, options = {}, byKey = roleMap(roles) }) {
  const text = request.toLowerCase();
  const selected = [];
  const add = (...keys) => addRolesByKey(selected, byKey, keys);

  if (/врем|темпорал|длит|dur[eé]e|duration|uji|аничч|anicca|момент|мгновен|вечност|циклич|прошл|будущ|настоящ/.test(text)) {
    add("buddha", "dogen", "laozi", "bergson", "heidegger", "augustine", "nagarjuna");
  }

  if (!options.noArchitects) add("plato", "descartes", "heidegger");
  add("socrates");

  if (/морал|этик|добродетел|долг|вина|счаст|жизнь|страдан|выбор|ценност/.test(text)) {
    add(
      "buddha",
      "confucius",
      "schopenhauer",
      "kierkegaard",
      "levinas",
      "tolstoy",
      "aristotle",
      "diogenes",
      "kant",
      "epictetus",
      "marcus-aurelius",
      "epicurus",
      "augustine",
      "nietzsche",
    );
  }
  if (/свобод|условн|обыча|стыд|роскош|аскез|циник|киник|провокац|простот/.test(text)) {
    add("sartre", "beauvoir", "camus", "berdyaev", "diogenes", "epictetus", "epicurus", "nietzsche", "rousseau");
  }
  if (/быт|существ|реальн|метафиз|бог|единое|душ|субстанц|природ/.test(text)) {
    add(
      "laozi",
      "nagarjuna",
      "shankara",
      "avicenna",
      "ibn-arabi",
      "leibniz",
      "dogen",
      "parmenides",
      "plotinus",
      "spinoza",
      "aquinas",
      "cusanus",
    );
  }
  if (/знан|истин|метод|сомнен|доказ|разум|субъект|позна/.test(text)) {
    add("hume", "montaigne", "pascal", "husserl", "wittgenstein", "al-ghazali", "averroes", "maimonides", "pyrrho", "kant", "spinoza", "aquinas");
  }
  if (/истор|обще|полит|государ|власт|культур|цивилизац|либерал|модерн|традиц/.test(text)) {
    add(
      "machiavelli",
      "hobbes",
      "marx",
      "arendt",
      "fanon",
      "said",
      "freire",
      "ibn-khaldun",
      "diogenes",
      "rousseau",
      "hegel",
      "nietzsche",
      "foucault",
      "dugin",
    );
  }
  if (/язык|текст|знак|медиа|симулякр|постмодерн|дискурс|нарратив|культура/.test(text)) {
    add("wittgenstein", "derrida", "bakhtin", "said", "barthes", "baudrillard", "deleuze", "foucault");
  }
  if (/желан|тело|станов|различ|машин|ризом|поток/.test(text)) {
    add("bergson", "merleau-ponty", "zhuangzi", "deleuze", "nietzsche", "spinoza");
  }

  add("aristotle", "diogenes", "nietzsche", "foucault");

  return uniqueRoles(selected).slice(0, selectedRoleLimit(request, mode));
}

export function selectChamberRoles({ roles, request, mode, mvpRoleKeys = [], byKey = roleMap(roles) }) {
  const selected = roles
    .map((item) => ({ item, score: roleScoreInText(item, request) + genericRoleScore(item, request) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key))
    .map((entry) => entry.item);

  addRolesByKey(selected, byKey, mvpRoleKeys);
  for (const role of roles) selected.push(role);

  return uniqueRoles(selected).slice(0, selectedRoleLimit(request, mode));
}

export function selectRoles({
  roles,
  request,
  mode,
  roleList = null,
  options = {},
  activeChamberId = "philosophy",
  mvpRoleKeys = [],
  byKey = roleMap(roles),
}) {
  if (roleList) {
    const selected = roleList
      .split(",")
      .map((token) => roleByToken(roles, token))
      .filter(Boolean);
    if (!selected.length) throw new Error(`No known philosophers in --philosophers ${roleList}`);
    return uniqueRoles(selected);
  }

  if (mode === "all" || options.all) return roles;

  if (activeChamberId !== "philosophy") {
    return selectChamberRoles({ roles, request, mode, mvpRoleKeys, byKey });
  }

  return selectPhilosophyRoles({ roles, request, mode, options, byKey });
}
