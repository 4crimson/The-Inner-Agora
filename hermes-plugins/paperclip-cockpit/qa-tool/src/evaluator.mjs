function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function observedReplyText(observed) {
  if (typeof observed.replyText === "string") return observed.replyText;
  const messages = Array.isArray(observed.messages) ? observed.messages : [];
  return messages.map((message) => message.text || message.message || "").join("\n");
}

function hasRawTokens(text) {
  return [
    "<|channel>",
    "<|",
    "▉",
    "Project action exited",
    "stderr:",
  ].some((needle) => text.includes(needle));
}

export const noTechnicalFirstLevelLeakNeedles = [
  "command not found",
  "<|channel>",
  "Project action exited",
  "stderr:",
  "--mode",
  "--min",
  "--max",
  "--all",
  "Маршрут:",
  "model=",
  "http://127.0.0.1",
  "http://localhost",
  "Открыть:",
  "wake=queued",
  "wake=failed",
  "wake=",
  "Голоса:",
  "Active Agents & Tasks",
  "terminated ancestor",
  "reports through",
];

function technicalFirstLevelLeaks(text) {
  return noTechnicalFirstLevelLeakNeedles.filter((needle) => text.includes(needle));
}

function rootsCreated(observed) {
  if (typeof observed.paperclipRootsCreated === "number") return observed.paperclipRootsCreated;
  if (Array.isArray(observed.paperclip?.rootsCreated)) return observed.paperclip.rootsCreated.length;
  if (Array.isArray(observed.rootsCreated)) return observed.rootsCreated.length;
  return 0;
}

function buttons(observed) {
  const raw = Array.isArray(observed.buttons)
    ? observed.buttons
    : Array.isArray(observed.telegram?.buttons)
      ? observed.telegram.buttons
      : [];
  return raw.flatMap((item) => Array.isArray(item) ? item : [item]);
}

function addCheck(checks, name, ok, details = {}) {
  checks.push({ name, ok: Boolean(ok), ...details });
}

export function evaluateTest({ test, observed = {} }) {
  const expect = test?.expect || {};
  const checks = [];
  const replyText = observedReplyText(observed);

  if (Object.hasOwn(expect, "ok")) {
    addCheck(checks, "ok", Boolean(observed.ok) === Boolean(expect.ok), {
      expected: Boolean(expect.ok),
      actual: Boolean(observed.ok),
    });
  }

  if (Object.hasOwn(expect, "replyContains")) {
    const expected = asList(expect.replyContains);
    addCheck(checks, "replyContains", expected.every((needle) => replyText.includes(String(needle))), {
      expected,
      actual: replyText,
    });
  }

  if (Object.hasOwn(expect, "replyNotContains")) {
    const forbidden = asList(expect.replyNotContains);
    addCheck(checks, "replyNotContains", forbidden.every((needle) => !replyText.includes(String(needle))), {
      expected: forbidden,
      actual: replyText,
    });
  }

  if (Object.hasOwn(expect, "paperclipRootsCreated")) {
    const actual = rootsCreated(observed);
    addCheck(checks, "paperclipRootsCreated", actual === Number(expect.paperclipRootsCreated), {
      expected: Number(expect.paperclipRootsCreated),
      actual,
    });
  }

  if (Object.hasOwn(expect, "paperclipRootsCreatedAtLeast")) {
    const actual = rootsCreated(observed);
    addCheck(checks, "paperclipRootsCreatedAtLeast", actual >= Number(expect.paperclipRootsCreatedAtLeast), {
      expected: Number(expect.paperclipRootsCreatedAtLeast),
      actual,
    });
  }

  if (expect.noRawTokens) {
    addCheck(checks, "noRawTokens", !hasRawTokens(replyText), {
      actual: replyText,
    });
  }

  if (expect.noTechnicalFirstLevelLeak) {
    const actualLeaks = technicalFirstLevelLeaks(replyText);
    addCheck(checks, "noTechnicalFirstLevelLeak", actualLeaks.length === 0, {
      expected: noTechnicalFirstLevelLeakNeedles,
      actualLeaks,
      actual: replyText,
    });
  }

  if (Object.hasOwn(expect, "localRouteContains")) {
    const route = String(observed.localRoute || observed.route || replyText || "");
    addCheck(checks, "localRouteContains", route.includes(String(expect.localRouteContains)), {
      expected: String(expect.localRouteContains),
      actual: route,
    });
  }

  if (Object.hasOwn(expect, "buttonsPresent")) {
    const actual = buttons(observed).length > 0;
    addCheck(checks, "buttonsPresent", actual === Boolean(expect.buttonsPresent), {
      expected: Boolean(expect.buttonsPresent),
      actual,
    });
  }

  if (Object.hasOwn(expect, "buttonsContain")) {
    const expected = asList(expect.buttonsContain).map(String);
    const labels = buttons(observed)
      .map((button) => String(button?.text || button?.label || button?.title || ""))
      .filter(Boolean);
    addCheck(checks, "buttonsContain", expected.every((needle) => labels.some((label) => label.includes(needle))), {
      expected,
      actual: labels,
    });
  }

  return {
    testId: test?.id || "",
    status: checks.every((check) => check.ok) ? "pass" : "fail",
    checks,
  };
}
