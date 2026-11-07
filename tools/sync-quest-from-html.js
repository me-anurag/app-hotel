#!/usr/bin/env node
/* Pulls the generated data out of the single-file builders-quest.html into the modular site:
     - TOOLS_RAW               -> sites/builders-quest/js/data/tools.js
     - DAY / NIGHT base64 webp -> sites/builders-quest/assets/grass-{day,night}.webp
   Usage: node tools/sync-quest-from-html.js [path/to/builders-quest.html] */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.resolve(process.argv[2] || path.join(ROOT, "builders-quest.html"));
const SITE = path.join(ROOT, "sites", "builders-quest");
const html = fs.readFileSync(SRC, "utf8");

/* ---- TOOLS_RAW ---- */
const start = html.indexOf("const TOOLS_RAW = {");
if (start < 0) throw new Error(`No TOOLS_RAW in ${SRC}. Is this the updated file?`);
const end = html.indexOf("\n};", start);
const block = html.slice(start, end + 3);

// Validate: it must evaluate to an object of string arrays.
const raw = new Function(`${block}; return TOOLS_RAW;`)();
const keys = Object.keys(raw);
if (!keys.length || !keys.every((k) => Array.isArray(raw[k]) && raw[k].every((s) => typeof s === "string"))) {
  throw new Error("TOOLS_RAW did not parse as { key: string[] }");
}

const toolsJs = `/* Tool suggestions per task. Key = core item id (e.g. "f4") or "<typeId>-<level>-<index>".
   Each entry is "Name|url|oss" (url and oss optional). Options, not endorsements.
   Generated from builders-quest.html by tools/sync-quest-from-html.js. */
${block}

/** Parsed: { [taskId]: [{ n: name, u: url, oss: boolean }] } */
export const TOOLS = {};
for (const k in TOOLS_RAW) {
  TOOLS[k] = TOOLS_RAW[k].map((s) => { const [n, u, o] = s.split("|"); return { n, u: u || "", oss: o === "oss" }; });
}
`;
fs.writeFileSync(path.join(SITE, "js", "data", "tools.js"), toolsJs);
console.log(`tools.js: ${keys.length} tasks, ${keys.reduce((s, k) => s + raw[k].length, 0)} tools`);

/* ---- grass images ---- */
fs.mkdirSync(path.join(SITE, "assets"), { recursive: true });
for (const [name, file] of [["DAY", "grass-day.webp"], ["NIGHT", "grass-night.webp"]]) {
  const m = new RegExp(`\\b${name}="data:image/webp;base64,([A-Za-z0-9+/=]+)"`).exec(html);
  if (!m) throw new Error(`No ${name} image found`);
  const buf = Buffer.from(m[1], "base64");
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") throw new Error(`${name} is not a valid WebP`);
  fs.writeFileSync(path.join(SITE, "assets", file), buf);
  console.log(`${file}: ${(buf.length / 1024).toFixed(1)} KB`);
}
