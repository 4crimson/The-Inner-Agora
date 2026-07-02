#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { migrateLegacyState } from "./state-manager.mjs";

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseArgs(args = []) {
  const options = { json: false, chatId: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--chat") options.chatId = args[++index] || "";
    else throw new Error(`Unknown migrate-state argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = migrateLegacyState({ chatId: options.chatId || "default", stateMode: "per-chat" });
  const payload = {
    chatId: result.chatId,
    statePath: result.statePath,
    migrated: result.migrated,
  };
  if (options.json) process.stdout.write(stableJson(payload));
  else console.log(`chatId=${payload.chatId}\nstate=${payload.statePath}\nmigrated=${payload.migrated}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
  }
}
