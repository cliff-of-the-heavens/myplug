// Generates the PWA PNG icons (brand gradient + "M") with no dependencies.
// Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// "M" glyph as a polygon in unit coordinates
const M = [
  [0.27, 0.7], [0.27, 0.3], [0.375, 0.3], [0.5, 0.48], [0.625, 0.3], [0.73, 0.3],
  [0.73, 0.7], [0.635, 0.7], [0.635, 0.46], [0.5, 0.64], [0.365, 0.46], [0.365, 0.7],
];
const STOPS = [
  [0, [242, 100, 58]], // coral
  [0.45, [236, 72, 110]], // pink
  [1, [143, 76, 230]], // violet
];

function inside(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function gradient(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, n) => v + (c1[n] - v) * k);
    }
  }
  return STOPS.at(-1)[1];
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param scale glyph scale: maskable icons keep content inside the central safe zone */
function png(size, scale = 1) {
  const SS = 4; // supersampling for anti-aliasing
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size - 0.5) / scale + 0.5;
          const v = ((y + (sy + 0.5) / SS) / size - 0.5) / scale + 0.5;
          if (inside(u, v, M)) cover++;
        }
      const a = cover / (SS * SS);
      const bg = gradient((x + y) / (2 * size));
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let n = 0; n < 3; n++) raw[o + n] = Math.round(bg[n] * (1 - a) + 255 * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL("icon-192.png", OUT), png(192));
writeFileSync(new URL("icon-512.png", OUT), png(512));
writeFileSync(new URL("icon-maskable-512.png", OUT), png(512, 0.75));
writeFileSync(new URL("apple-touch-icon.png", OUT), png(180));
console.log("Icons written to public/icons/");
