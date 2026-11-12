// T015: writes the PWA icons (src/client/public/icon-*.png) as plain PNGs with node:zlib, no image dependency.
// Colors are read from src/client/tokens.css (--color-accent background, --color-accent-text ladder), so the icons
// follow the theme and no color literal lives outside the tokens file. Run: bun scripts/make-icons.ts
import { deflateSync } from "node:zlib";

const tokens = await Bun.file("src/client/tokens.css").text();
const hex = (name: string): [number, number, number] => {
  const m = tokens.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
  if (!m?.[1]) throw new Error(`token ${name} not found as a 6-digit hex value`);
  const v = Number.parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const BG = hex("--color-accent");
const FG = hex("--color-accent-text");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

/** A ladder (two rails, four rungs) inside the central 50%, so it stays in the maskable safe zone (80%). */
function isLadder(x: number, y: number, size: number) {
  const u = size / 100;
  const inBox = y >= 25 * u && y < 75 * u;
  const rail = (x >= 33 * u && x < 39 * u) || (x >= 61 * u && x < 67 * u);
  const rungX = x >= 39 * u && x < 61 * u;
  const rung = [32, 44, 56, 68].some((r) => y >= r * u - 2.5 * u && y < r * u + 2.5 * u);
  return inBox && (rail || (rungX && rung));
}

function png(size: number) {
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) raw.set(isLadder(x, y, size) ? FG : BG, row + 1 + x * 3);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
] as const) {
  await Bun.write(`src/client/public/${name}`, png(size));
  console.log(`wrote src/client/public/${name} (${size}x${size})`);
}
