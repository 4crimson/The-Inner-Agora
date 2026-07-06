export function roleRiskTier(role = {}) {
  return role?.riskTier || "reflective";
}

export function chamberRiskTier(chamber = {}) {
  return chamber?.riskTier || "reflective";
}

export function transparencyPolicyText({
  chamberOrPolicyId,
  activeChamber = () => ({}),
  skillsDir = "",
  loadSkillPrompt = () => {
    throw new Error("loadSkillPrompt is not configured");
  },
  composeChamberPolicy = () => "",
  fallbackTransparencyPolicy = (policyId, error) => {
    throw error;
  },
} = {}) {
  if (typeof chamberOrPolicyId !== "string") {
    return composeChamberPolicy(chamberOrPolicyId, { skillsDir });
  }

  const policyId = chamberOrPolicyId || activeChamber().transparencyPolicy;
  try {
    return loadSkillPrompt(skillsDir, policyId);
  } catch (error) {
    return fallbackTransparencyPolicy(policyId, error);
  }
}
