import { byIssueNumber } from "./issue-utils.mjs";

export function collectSubtree(root, allIssues = []) {
  const byParent = new Map();
  for (const issue of allIssues.filter((item) => !item.hiddenAt)) {
    if (!issue.parentId) continue;
    const items = byParent.get(issue.parentId) || [];
    items.push(issue);
    byParent.set(issue.parentId, items);
  }

  const items = [];
  function visit(issue, depth) {
    for (const child of visibleChildren(issue, byParent)) {
      items.push({ issue: child, depth });
      visit(child, depth + 1);
    }
  }
  visit(root, 1);
  return { items, byParent };
}

export function visibleChildren(issue, byParent = new Map()) {
  return (byParent.get(issue.id) || []).filter((child) => !child.hiddenAt).sort(byIssueNumber);
}
