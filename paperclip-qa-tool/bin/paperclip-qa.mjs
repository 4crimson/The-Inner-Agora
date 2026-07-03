#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANONICAL_CLI = path.join(
  ROOT,
  "hermes-plugins",
  "paperclip-cockpit",
  "qa-tool",
  "bin",
  "paperclip-qa.mjs",
);

await import(pathToFileURL(CANONICAL_CLI).href);
