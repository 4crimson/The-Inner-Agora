import { cleanupPaperclipIssues, cleanupTelegramMessages } from "./cleanup-engine.mjs";
import { readManifest, writeManifest } from "./manifest.mjs";

export async function cleanupRun({ manifestPath, client, userbot, mode = "hard", dryRun = false, now = new Date() }) {
  const manifest = readManifest(manifestPath);
  const telegramResult = cleanupTelegramMessages({ userbot, manifest, mode, dryRun });
  const paperclipResult = await cleanupPaperclipIssues({ client, manifest, mode, dryRun, now });
  const residuals = [...telegramResult.residuals, ...paperclipResult.residuals];

  manifest.cleanup = {
    ...(manifest.cleanup || {}),
    mode,
    attemptedAt: now.toISOString(),
    telegram: [...(manifest.cleanup?.telegram || []), ...telegramResult.actions],
    paperclip: [...(manifest.cleanup?.paperclip || []), ...paperclipResult.actions],
    residuals: [...(manifest.cleanup?.residuals || []), ...residuals],
  };
  writeManifest(manifestPath, manifest);

  return {
    ok: residuals.length === 0,
    cleanup: manifest.cleanup,
    residuals,
  };
}
