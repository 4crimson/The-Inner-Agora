import {
  byIssueNumber,
  latestIssueRef,
  latestSynthesisChild,
} from "./issue-utils.mjs";
import {
  normalizedDigestBody,
  synthesisComment,
} from "./digest-utils.mjs";

export async function latestSynthesisForRoot(rootIssue, agora, api) {
  const allIssues = await api(`/companies/${agora.company.id}/issues`);
  const synthesisIssue = latestSynthesisChild(rootIssue, allIssues, agora);
  if (!synthesisIssue) return { synthesisIssue: null, synthesisText: "" };
  const commentsList = await api(`/issues/${synthesisIssue.id}/comments`);
  const comment = synthesisComment(commentsList);
  return {
    synthesisIssue,
    synthesisText: normalizedDigestBody(comment?.body || ""),
  };
}

export async function resolveRootIssue(args, allIssues, api) {
  const explicitRef = latestIssueRef(args);
  if (explicitRef) {
    const issue = await api(`/issues/${explicitRef}`);
    if (!issue.parentId) return issue;
    return api(`/issues/${issue.parentId}`);
  }

  const roots = allIssues
    .filter((issue) => !issue.hiddenAt && !issue.parentId)
    .sort((left, right) => byIssueNumber(right, left));
  if (!roots.length) throw new Error("No root Agora sessions found in Paperclip.");
  return roots[0];
}

export async function resolveTopRootIssue(issue, api) {
  let current = issue;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = await api(`/issues/${current.parentId}`);
  }
  return current;
}
