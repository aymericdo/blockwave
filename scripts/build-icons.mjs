/* Blockwave — génération des icônes de l'extension.
 *
 * Aucune dépendance : décode le PNG source, le redimensionne par moyenne de
 * surface (le bon algorithme pour réduire fortement une image), applique un
 * masque de coins arrondis avec anti-aliasing, puis ré-encode en RGBA.
 *
 *   node scripts/build-icons.mjs [source]
 *
 * Sortie : icons/icon{16,32,48,128,512}.png
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 32, 48, 128, 512];
const CORNER_RATIO = 0.22; // même proportion que les icônes système macOS / Chrome

const source = process.argv[2] ?? 'assets/icon-source.png';
const outDir = 'icons';

/* ------------------------------------------------------------------ */
/* Décodage PNG                                                       */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    raw.copy(out, y * stride, pos, pos + stride);
    pos += stride;

    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const x = cur[i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;

      switch (filter) {
        case 0:
          break;
        case 1:
          cur[i] = (x + a) & 0xff;
          break;
        case 2:
          cur[i] = (x + b) & 0xff;
          break;
        case 3:
          cur[i] = (x + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          cur[i] = (x + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Filtre PNG non géré : ${filter}`);
      }
    }
  }

  return out;
}

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error("Ce n'est pas un PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`Profondeur ${bitDepth} non gérée (8 attendu)`);
  if (interlace !== 0) throw new Error('PNG entrelacé non géré');

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`colorType ${colorType} non géré`);

  const pixels = unfilter(
    zlib.inflateSync(Buffer.concat(idat)),
    width,
    height,
    channels,
  );

  // On normalise en RGB pour la suite.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    if (channels === 1) {
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = pixels[j];
    } else if (channels === 2) {
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = pixels[j];
    } else {
      rgb[i * 3] = pixels[j];
      rgb[i * 3 + 1] = pixels[j + 1];
      rgb[i * 3 + 2] = pixels[j + 2];
    }
  }

  return { width, height, rgb };
}

/* ------------------------------------------------------------------ */
/* Redimensionnement par moyenne de surface                           */
/* ------------------------------------------------------------------ */

function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh * 3);
  const xRatio = sw / dw;
  const yRatio = sh / dh;

  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * yRatio;
    const y1 = y0 + yRatio;

    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * xRatio;
      const x1 = x0 + xRatio;

      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;

      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;

        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;

          const w = wx * wy;
          const i = (sy * sw + sx) * 3;
          r += src[i] * w;
          g += src[i + 1] * w;
          b += src[i + 2] * w;
          weight += w;
        }
      }

      const o = (dy * dw + dx) * 3;
      out[o] = r / weight;
      out[o + 1] = g / weight;
      out[o + 2] = b / weight;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Masque de coins arrondis (suréchantillonné)                        */
/* ------------------------------------------------------------------ */

function roundedAlpha(size, radius) {
  const alpha = new Float32Array(size * size);
  const half = size / 2;
  const inner = half - radius;
  const samples = 4;
  const step = 1 / samples;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) * step - half;
          const py = y + (sy + 0.5) * step - half;

          const qx = Math.max(Math.abs(px) - inner, 0);
          const qy = Math.max(Math.abs(py) - inner, 0);

          if (Math.hypot(qx, qy) <= radius) inside++;
        }
      }

      alpha[y * size + x] = inside / (samples * samples);
    }
  }

  return alpha;
}

/* ------------------------------------------------------------------ */
/* Encodage PNG (RGBA 8 bits)                                         */
/* ------------------------------------------------------------------ */

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));

  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePNG(rgb, alpha, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;

  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filtre None : le compresseur suffit sur une icône
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      raw[p++] = Math.round(rgb[i]);
      raw[p++] = Math.round(rgb[i + 1]);
      raw[p++] = Math.round(rgb[i + 2]);
      raw[p++] = Math.round(alpha[y * size + x] * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */

const { width, height, rgb } = decodePNG(source);
console.log(`source : ${path.basename(source)} — ${width}×${height}`);

fs.mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const scaled = resample(rgb, width, height, size, size);
  const alpha = roundedAlpha(size, size * CORNER_RATIO);
  const png = encodePNG(scaled, alpha, size);

  const target = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(target, png);
  console.log(`  ${target.padEnd(30)} ${(png.length / 1024).toFixed(1)} Ko`);
}

/* Favicon de la console de modération : produit ici pour qu'il n'existe qu'une
 * seule source d'icônes (assets/icon-source.png). Vite sert admin/public/ tel
 * quel, en dev comme au build. */
const FAVICONS = [
  { size: 32, target: 'admin/public/favicon-32.png' },
  { size: 180, target: 'admin/public/apple-touch-icon.png' },
];

for (const { size, target } of FAVICONS) {
  const scaled = resample(rgb, width, height, size, size);
  const alpha = roundedAlpha(size, size * CORNER_RATIO);
  const png = encodePNG(scaled, alpha, size);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, png);
  console.log(`  ${target.padEnd(30)} ${(png.length / 1024).toFixed(1)} Ko`);
}

console.log('terminé.');
