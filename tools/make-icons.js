#!/usr/bin/env node
/* Generates the PWA PNG icons (no dependencies): node tools/make-icons.js */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { crc32 } = require("../lib/zip");

const OUT = path.join(__dirname, "..", "app", "icons");
fs.mkdirSync(OUT, { recursive: true });

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const C = { bgA: hex("#2f6b22"), bgB: hex("#6aa84c"), win: hex("#ffffff"), band: hex("#e3efd8"), dot: hex("#4c8a37"), line: hex("#cfe0c2") };

// Signed distance to a rounded rectangle centred at (cx,cy) with half-size (hx,hy) and radius r.
function sdRoundRect(x, y, cx, cy, hx, hy, r) {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Colour at unit coords (x,y) or null for transparent. */
function sample(x, y, maskable) {
  if (!maskable && sdRoundRect(x, y, .5, .5, .5, .5, .22) > 0) return null;
  const t = (x + y) / 2;
  let col = C.bgA.map((a, i) => a + (C.bgB[i] - a) * (1 - t));

  // Glyph: a browser window holding page lines. Shrunk for the maskable safe zone.
  const k = maskable ? .78 : 1;
  const gx = (x - .5) / k + .5, gy = (y - .5) / k + .5;
  if (sdRoundRect(gx, gy, .5, .53, .31, .25, .06) <= 0) {
    col = C.win;
    if (gy < .39) col = C.band;
    for (const dx of [.28, .345, .41]) if (Math.hypot(gx - dx, gy - .335) < .022) col = C.dot;
    for (const [cy, hw, cx] of [[.49, .2, .5], [.585, .13, .43], [.68, .17, .47]]) {
      if (sdRoundRect(gx, gy, cx, cy, hw, .022, .022) <= 0) col = C.line;
    }
  }
  return col;
}

function render(size, maskable) {
  const SS = 4, px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = sample((x + (sx + .5) / SS) / size, (y + (sy + .5) / SS) / size, maskable);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const i = (y * size + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
    px[i + 3] = Math.round((a / (SS * SS)) * 255);
  }
  return encodePng(size, size, px);
}

function encodePng(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size, maskable] of [
  ["icon-192.png", 192, false], ["icon-512.png", 512, false],
  ["maskable-192.png", 192, true], ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
]) {
  fs.writeFileSync(path.join(OUT, name), render(size, maskable));
  console.log("wrote", name);
}
