import path from "node:path";

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

export function chamberRelativePath(chambersDir, chamber, relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(chambersDir, chamber.id, relativePath);
}

export function resolveRoleSourcePath({
  chambersDir,
  chamber,
} = {}) {
  return chamberRelativePath(chambersDir, chamber, chamber.roles[0]);
}

export function resolveMvpPresetPath({
  env = process.env,
  chambersDir,
  chamber,
} = {}) {
  if (env.INNER_AGORA_MVP_PRESET_PATH) return path.resolve(env.INNER_AGORA_MVP_PRESET_PATH);
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
