/**
 * User rules loader — reads .cursor/rules/**\/*.md and .cursorrules.
 * Mirrors byok UserRuleStore behavior (reads from workspace root).
 */
const fs = require("fs");
const path = require("path");

function readFileSafe(p) {
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch {
    /* ignore */
  }
  return null;
}

function listMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...listMdFiles(p));
      } else if (e.isFile() && e.name.endsWith(".md")) {
        results.push(p);
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

/**
 * Load user rules for a workspace root path.
 * Returns combined text suitable for system prompt injection, or "" if none.
 */
function loadUserRules(workspaceRoot) {
  if (!workspaceRoot) return "";
  const root = String(workspaceRoot).trim();
  const parts = [];

  // .cursorrules (legacy flat file)
  const legacy = readFileSafe(path.join(root, ".cursorrules"));
  if (legacy) parts.push(legacy);

  // .cursor/rules/**/*.md
  const rulesDir = path.join(root, ".cursor", "rules");
  const mdFiles = listMdFiles(rulesDir);
  for (const f of mdFiles.slice(0, 20)) {
    const content = readFileSafe(f);
    if (content) parts.push(content);
  }

  if (!parts.length) return "";
  return parts.join("\n\n");
}

module.exports = { loadUserRules };
