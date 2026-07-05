import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const IGNORED_DIRS = new Set([".git", "__pycache__"]);
const IGNORED_FILES = new Set([".DS_Store"]);
const IGNORED_EXTENSIONS = new Set([".pyc", ".pyo"]);

function shouldIgnoreFile(filePath) {
  const base = path.basename(filePath);
  return IGNORED_FILES.has(base) || IGNORED_EXTENSIONS.has(path.extname(base));
}

function shouldIgnoreDir(dirPath) {
  return IGNORED_DIRS.has(path.basename(dirPath));
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(fullPath)) walkFiles(root, fullPath, files);
      continue;
    }
    if (!entry.isFile() || shouldIgnoreFile(fullPath)) continue;
    files.push(path.relative(root, fullPath).split(path.sep).join("/"));
  }
  return files;
}

function directoryDigest(dir) {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return {
      dir: resolved,
      exists: false,
      sha256: "",
      fileCount: 0,
      files: {},
    };
  }

  const fileEntries = {};
  for (const relativePath of walkFiles(resolved).sort()) {
    fileEntries[relativePath] = fileSha256(path.join(resolved, relativePath));
  }
  const hash = crypto.createHash("sha256");
  for (const [relativePath, sha256] of Object.entries(fileEntries)) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(sha256);
    hash.update("\0");
  }
  return {
    dir: resolved,
    exists: true,
    sha256: hash.digest("hex"),
    fileCount: Object.keys(fileEntries).length,
    files: fileEntries,
  };
}

function compareFiles(repoFiles, profileFiles) {
  const repoSet = new Set(Object.keys(repoFiles));
  const profileSet = new Set(Object.keys(profileFiles));
  const missing = [...repoSet].filter((file) => !profileSet.has(file)).sort();
  const extra = [...profileSet].filter((file) => !repoSet.has(file)).sort();
  const changed = [...repoSet]
    .filter((file) => profileSet.has(file) && repoFiles[file] !== profileFiles[file])
    .sort();
  return { missing, extra, changed };
}

export function checkProfilePluginSync({ repoPluginDir, profilePluginDir, plugin = "paperclip-cockpit" }) {
  const repo = directoryDigest(repoPluginDir);
  const profile = directoryDigest(profilePluginDir);
  const diff = compareFiles(repo.files, profile.files);
  const reasons = [];

  if (!repo.exists) reasons.push("repo-plugin-missing");
  if (!profile.exists) reasons.push("profile-plugin-missing");
  if (repo.exists && profile.exists && repo.sha256 !== profile.sha256) {
    reasons.push("profile-plugin-digest-mismatch");
  }

  const ok = reasons.length === 0;
  return {
    ok,
    status: ok ? "ok" : "blocked",
    profilePluginSync: ok ? "ok" : "blocked",
    plugin,
    reasons,
    repo: {
      dir: repo.dir,
      exists: repo.exists,
      sha256: repo.sha256,
      fileCount: repo.fileCount,
    },
    profile: {
      dir: profile.dir,
      exists: profile.exists,
      sha256: profile.sha256,
      fileCount: profile.fileCount,
    },
    diff,
  };
}
