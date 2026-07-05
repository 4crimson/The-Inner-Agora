import path from "node:path";
import { slugify } from "./text-utils.mjs";

export function memoryExportFileName(issue = {}) {
  return `${issue.identifier || issue.id}-${slugify(issue.title)}.md`;
}

export function memoryExportPath(memoryDir, issue = {}) {
  return path.join(memoryDir, memoryExportFileName(issue));
}

export function memoryExportMarkdown(issue = {}, commentsList = []) {
  const comments = Array.isArray(commentsList) ? commentsList : [];
  const body = [
    "---",
    `paperclip_id: ${JSON.stringify(issue.id)}`,
    `identifier: ${JSON.stringify(issue.identifier || "")}`,
    `status: ${JSON.stringify(issue.status || "")}`,
    `created: ${JSON.stringify(issue.createdAt || "")}`,
    `updated: ${JSON.stringify(issue.updatedAt || "")}`,
    "source: paperclip",
    "---",
    "",
    `# ${issue.identifier || issue.id}: ${issue.title}`,
    "",
    `Paperclip: http://127.0.0.1:3100/issues/${issue.id}`,
    "",
    "## Description",
    "",
    issue.description || "",
    "",
    "## Comments",
    "",
    comments.length
      ? comments
          .map((comment) => `### ${comment.authorType || "unknown"} ${comment.createdAt || ""}\n\n${comment.body || ""}`)
          .join("\n\n")
      : "No comments.",
    "",
  ].join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}
