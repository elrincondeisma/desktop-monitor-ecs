// Genera build/icon.png (1024x1024) — el icono de la app .icns lo deriva electron-builder.
// Dibujo procedural con SDFs y antialiasing: fondo redondeado oscuro + tres barras
// (la central en verde, como "estado OK" del stack).
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Distancia con signo a un rectángulo redondeado centrado en (cx, cy)
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Cobertura del píxel a partir de la distancia (AA de ~1px)
const coverage = (d) => clamp01(0.5 - d);

const BG = [0x23, 0x25, 0x2c];
const BAR = [0xe8, 0xe9, 0xec];
const GREEN = [0x4c, 0xc3, 0x8a];

// Capas: [color, sdf]
const C = SIZE / 2;
const layers = [
  [BG, (x, y) => sdRoundRect(x, y, C, C, 412, 412, 185)],
  [BAR, (x, y) => sdRoundRect(x, y, C, 350, 250, 46, 46)],
  [GREEN, (x, y) => sdRoundRect(x, y, C, 512, 250, 46, 46)],
  [BAR, (x, y) => sdRoundRect(x, y, C, 674, 250, 46, 46)],
];

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [color, sdf] of layers) {
      const cov = coverage(sdf(x + 0.5, y + 0.5));
      if (cov <= 0) continue;
      // alpha-over
      r = color[0] * cov + r * (1 - cov);
      g = color[1] * cov + g * (1 - cov);
      b = color[2] * cov + b * (1 - cov);
      a = cov + a * (1 - cov);
    }
    const i = (y * SIZE + x) * 4;
    rgba[i] = Math.round(r);
    rgba[i + 1] = Math.round(g);
    rgba[i + 2] = Math.round(b);
    rgba[i + 3] = Math.round(a * 255);
  }
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png(SIZE, rgba));
console.log('Icono de app generado en build/icon.png');
