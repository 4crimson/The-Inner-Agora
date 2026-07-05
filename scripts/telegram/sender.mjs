export function chunks(text, limit = 3900) {
  let body = String(text || "").trim() || "OK";
  const out = [];
  while (body.length > limit) {
    let splitAt = body.lastIndexOf("\n\n", limit);
    if (splitAt < 1200) splitAt = body.lastIndexOf("\n", limit);
    if (splitAt < 1200) splitAt = limit;
    out.push(body.slice(0, splitAt).trim());
    body = body.slice(splitAt).trim();
  }
  out.push(body);
  return out;
}

export async function sendText({
  chatId = "",
  text = "",
  keyboard = null,
  dryRun = false,
  telegramChat,
  telegramApi,
  log = console.log,
  limit = 3900,
} = {}) {
  if (dryRun) {
    log(JSON.stringify({ chat_id: chatId || "(default)", text, reply_markup: keyboard }, null, 2));
    return;
  }
  const target = telegramChat(chatId);
  if (!target) throw new Error("Telegram chat id is not configured");
  const parts = chunks(text, limit);
  for (let index = 0; index < parts.length; index += 1) {
    await telegramApi("sendMessage", {
      chat_id: target,
      text: parts[index],
      disable_web_page_preview: true,
      ...(index === 0 && keyboard ? { reply_markup: keyboard } : {}),
    });
  }
}
