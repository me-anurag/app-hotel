/* Shared helpers for collecting site files from disk (used by the server seeder and the CLI). */
const fs = require("node:fs");
const path = require("node:path");

const IGNORE_DIRS = new Set(["node_modules", ".git", ".vscode", ".idea", "__MACOSX", ".sitebox"]);
const IGNORE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "sitebox.json"]);

function isIgnored(rel) {
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  if (IGNORE_FILES.has(base)) return true;
  return parts.slice(0, -1).some((d) => IGNORE_DIRS.has(d) || (d.startsWith(".") && d !== ".well-known"));
}

/** Recursively read a folder into [{ path, data }] with forward-slash relative paths. */
function readDir(root) {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (ent.isDirectory()) {
        if (!IGNORE_DIRS.has(ent.name) && !(ent.name.startsWith(".") && ent.name !== ".well-known")) walk(abs);
      } else if (ent.isFile() && !isIgnored(rel)) {
        out.push({ path: rel, data: fs.readFileSync(abs) });
      }
    }
  })(root);
  return out;
}

module.exports = { readDir, isIgnored };
