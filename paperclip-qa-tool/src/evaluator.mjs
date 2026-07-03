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

function rootsCreated(observed) {
  if (typeof observed.paperclipRootsCreated === "number") return observed.paperclipRootsCreated;
  if (Array.isArray(observed.paperclip?.rootsCreated)) return observed.paperclip.rootsCreated.length;
  if (Array.isArray(observed.rootsCreated)) return observed.rootsCreated.length;
  return 0;
}

function buttons(observed) {
  if (Array.isArray(observed.buttons)) return observed.buttons;
  if (Array.isArray(observed.telegram?.buttons)) return observed.telegram.buttons;
  return [];
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

  if (Object.hasOwn(expect, "localRouteContains")) {
    const route = String(observed.localRoute || observed.route || "");
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

  return {
    testId: test?.id || "",
    status: checks.every((check) => check.ok) ? "pass" : "fail",
    checks,
  };
}
