export function adapterMetadata(adapter) {
  return {
    name: adapter.name,
    model: adapter.model,
    reason: adapter.reason,
    riskTier: adapter.riskTier,
  };
}

export function adapterStatePatch(adapter) {
  return {
    lastAdapterName: adapter.name,
    lastAdapterModel: adapter.model,
    lastAdapterReason: adapter.reason,
    lastAdapterRiskTier: adapter.riskTier,
  };
}

export function adapterDisplayLine(adapter) {
  return `adapter=${adapter.name}, model=${adapter.model}, reason=${adapter.reason}, risk=${adapter.riskTier}`;
}

export function adapterFromState(state = {}) {
  if (!state.lastAdapterName) return null;
  return {
    name: state.lastAdapterName,
    model: state.lastAdapterModel || "-",
    reason: state.lastAdapterReason || "-",
    riskTier: state.lastAdapterRiskTier || "-",
  };
}

export function adapterFromIssue(issue) {
  const adapter = issue?.metadata?.innerAgora?.adapter || issue?.metadata?.innerAgoraAdapter || null;
  return adapter?.name ? adapter : null;
}
