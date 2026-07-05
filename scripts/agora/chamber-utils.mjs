import path from "node:path";

export function normalizeChamberMode(value) {
  const normalized = String(value || "legacy").trim().toLowerCase();
  if (["legacy", "chambers"].includes(normalized)) return normalized;
  throw new Error(`Unsupported CHAMBER_MODE=${value}. Use legacy or chambers.`);
}

export function activeChamberIdFromState({
  env = process.env,
  state = {},
  profile = {},
  defaultChamberId = "philosophy",
} = {}) {
  return String(
    env.INNER_AGORA_ACTIVE_CHAMBER ||
      state.activeChamberId ||
      profile.preferredChamberId ||
      defaultChamberId,
  ).trim();
}

export function shouldUseActiveChamberRoles({
  chamberMode = "legacy",
  env = process.env,
  activeChamberId = "",
  defaultChamberId = "philosophy",
} = {}) {
  return (
    chamberMode === "chambers" ||
    Boolean(env.INNER_AGORA_ACTIVE_CHAMBER) ||
    activeChamberId !== defaultChamberId
  );
}

export function chamberRelativePath(chambersDir, chamber, relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(chambersDir, chamber.id, relativePath);
}

export function resolveRoleSourcePath({
  chamberMode = "legacy",
  env = process.env,
  activeChamberId = "philosophy",
  defaultChamberId = "philosophy",
  legacyRolesPath,
  chambersDir,
  chamber,
} = {}) {
  if (!shouldUseActiveChamberRoles({ chamberMode, env, activeChamberId, defaultChamberId })) {
    return legacyRolesPath;
  }
  return chamberRelativePath(chambersDir, chamber, chamber.roles[0]);
}

export function resolveMvpPresetPath({
  chamberMode = "legacy",
  env = process.env,
  activeChamberId = "philosophy",
  defaultChamberId = "philosophy",
  defaultMvpPresetPath,
  chambersDir,
  chamber,
} = {}) {
  if (env.INNER_AGORA_MVP_PRESET_PATH) return path.resolve(env.INNER_AGORA_MVP_PRESET_PATH);
  if (!shouldUseActiveChamberRoles({ chamberMode, env, activeChamberId, defaultChamberId })) {
    return defaultMvpPresetPath;
  }
  return chamberRelativePath(chambersDir, chamber, chamber.presets[0]);
}

export function activeChamberCompanyConfigFromChamber(chamber, env = process.env) {
  const company = chamber.company || {};
  return {
    chamber,
    companyId: String(env.INNER_AGORA_COMPANY_ID || company.companyId || "").trim(),
    companyName: String(env.INNER_AGORA_COMPANY_NAME || company.name || "").trim(),
    projectName: String(env.INNER_AGORA_PROJECT_NAME || company.projectName || "").trim(),
    goalTitle: String(env.INNER_AGORA_GOAL_TITLE || company.goalTitle || "").trim(),
  };
}
