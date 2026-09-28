// Renders the shield icon to PNGs without any dependencies.
// Usage: node scripts/make-icons.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const RED = [192, 57, 43];
const WHITE = [255, 255, 255];

// Shield outline in a 0..1 unit square: flat top, straight sides, pointed bottom.
function inShield(x, y) {
  if (y < 0.08 || y > 0.95 || x < 0.12 || x > 0.88) return false;
  if (y <= 0.55) return true;
  const half = 0.38 * Math.sqrt(1 - ((y - 0.55) / 0.4) ** 2); // elliptical taper to the tip
  return Math.abs(x - 0.5) <= half;
}

// White diagonal slash (the "blocked" mark) inside a ring.
function inMark(x, y) {
  const r = Math.hypot(x - 0.5, y - 0.46);
  const ring = r > 0.17 && r < 0.24;
  const slash = r < 0.2 && Math.abs((x - 0.5) + (y - 0.46)) < 0.045;
  return ring || slash;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size) {
  const SS = 4; // supersampling for anti-aliased edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let shield = 0;
      let mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (inShield(x, y)) {
            shield++;
            if (inMark(x, y)) mark++;
          }
        }
      }
      const n = SS * SS;
      const m = shield ? mark / shield : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(RED[c] * (1 - m) + WHITE[c] * m);
      raw[o + 3] = Math.round((255 * shield) / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir('icons', { recursive: true });
for (const size of [16, 32, 48, 128]) await writeFile(`icons/icon${size}.png`, render(size));
console.log('Icons written to icons/');
