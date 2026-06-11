// Genera assets/iconTemplate.png (16x16) y @2x (32x32) para el tray de macOS.
// Imagen "template": píxeles negros + alfa, macOS la tinta según el tema.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

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

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtro none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Icono: tres barras apiladas (stack de servidores/contenedores)
const ART = [
  '................',
  '................',
  '..############..',
  '..############..',
  '..############..',
  '................',
  '..############..',
  '..############..',
  '..############..',
  '................',
  '..############..',
  '..############..',
  '..############..',
  '................',
  '................',
  '................',
];

function rgbaFromArt(art, scale) {
  const size = art.length * scale;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = art[Math.floor(y / scale)][Math.floor(x / scale)] === '#';
      const i = (y * size + x) * 4;
      buf[i + 3] = on ? 255 : 0; // negro + alfa
    }
  }
  return buf;
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'iconTemplate.png'), png(16, 16, rgbaFromArt(ART, 1)));
fs.writeFileSync(path.join(outDir, 'iconTemplate@2x.png'), png(32, 32, rgbaFromArt(ART, 2)));
console.log('Iconos generados en assets/');
