#!/usr/bin/env node
// Generates the extension icon set (icons/icon{16,32,48,128}.png) with zero
// dependencies: shapes are rasterized into an RGBA buffer (3x3 supersampled)
// and encoded as PNG by hand via zlib. Design: rounded square with a diagonal
// indigo→magenta gradient and a white checkmark ("clean up your feeds").
// Re-run after changing: node scripts/gen-icons.js
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---- tiny PNG encoder -------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- rasterizer -------------------------------------------------------------

// Signed distance to a rounded rectangle centered at (cx,cy).
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    r
  );
}

// Distance from point to segment AB.
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby))
  );
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

const lerp = (a, b, t) => a + (b - a) * t;
// 0→1 coverage from a signed distance, ~1px anti-aliasing band.
const coverage = (sd) => Math.max(0, Math.min(1, 0.5 - sd));

// `pad` is transparent padding per side, in px. The toolbar icons fill their
// canvas (pad 0); the Chrome Web Store LISTING icon must be a 96x96 glyph
// centered in a 128x128 canvas — i.e. 16px padding per side — or it renders
// oversized next to other listings.
function renderIcon(size, pad = 0) {
  const SS = 3; // supersampling
  const rgba = Buffer.alloc(size * size * 4);
  const c1 = [99, 102, 241]; // indigo
  const c2 = [236, 72, 153]; // magenta
  const art = size - 2 * pad; // side length of the drawn square
  const margin = 0.02 * art;
  const half = art / 2 - margin;
  const radius = 0.24 * art;
  // Checkmark in unit coords, scaled to the drawn square and offset by `pad`.
  const A = [pad + 0.27 * art, pad + 0.53 * art];
  const B = [pad + 0.44 * art, pad + 0.70 * art];
  const C = [pad + 0.74 * art, pad + 0.34 * art];
  const stroke = Math.max(0.055 * art, 1.1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const bgCov = coverage(
            sdRoundRect(px, py, size / 2, size / 2, half, half, radius)
          );
          if (bgCov <= 0) continue;
          // Diagonal gradient across the drawn square.
          const t = Math.max(0, Math.min(1, (px + py - 2 * pad) / (2 * art)));
          let cr = lerp(c1[0], c2[0], t);
          let cg = lerp(c1[1], c2[1], t);
          let cb = lerp(c1[2], c2[2], t);
          // White checkmark (two capsule strokes).
          const d = Math.min(
            sdSegment(px, py, A[0], A[1], B[0], B[1]),
            sdSegment(px, py, B[0], B[1], C[0], C[1])
          );
          const ckCov = coverage(d - stroke);
          cr = lerp(cr, 255, ckCov);
          cg = lerp(cg, 255, ckCov);
          cb = lerp(cb, 255, ckCov);
          r += cr * bgCov;
          g += cg * bgCov;
          b += cb * bgCov;
          a += bgCov;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      // Straight (non-premultiplied) alpha, as PNG expects.
      rgba[i] = alpha > 0 ? Math.round(r / a) : 0;
      rgba[i + 1] = alpha > 0 ? Math.round(g / a) : 0;
      rgba[i + 2] = alpha > 0 ? Math.round(b / a) : 0;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log("wrote", file);
}

// Store-listing icon: 96x96 glyph + 16px transparent padding per side.
const storeDir = path.join(__dirname, "..", "store-assets");
fs.mkdirSync(storeDir, { recursive: true });
const storeFile = path.join(storeDir, "store-icon-128.png");
fs.writeFileSync(storeFile, renderIcon(128, 16));
console.log("wrote", storeFile);
