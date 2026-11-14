// Gera public/icon-192.png, public/icon-512.png e public/logo.svg a partir do logo (triângulo de Penrose RGB).
// PNG escrito à mão, sem dependências: polígonos rasterizados com 4x4 amostras por pixel.
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { logoSvg, penrose } from '../src/logo.ts';

const BG: [number, number, number] = [22, 22, 27];
const SCALE = 0.62; // largura do logo em fração do ícone (cabe na zona segura do ícone "maskable")
const SS = 4;

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

function inside(pts: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function icon(size: number): Buffer {
  const { polys, h } = penrose();
  const w = size * SCALE;
  const ox = (size - w) / 2;
  const oy = (size - w * h) / 2;
  // Polígonos em pixels; o último pintado ganha (mesma ordem do SVG).
  const shapes = polys.map((p) => ({ rgb: hex(p.fill), pts: p.pts.map(([x, y]) => [ox + x * w, oy + y * w] as [number, number]) }));
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let c = BG;
          for (const s of shapes) if (inside(s.pts, px, py)) c = s.rgb;
          for (let k = 0; k < 3; k++) acc[k]! += c[k]!;
        }
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k]! / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = (f: string): URL => new URL(`../public/${f}`, import.meta.url);
for (const size of [192, 512]) writeFileSync(out(`icon-${size}.png`), icon(size));
writeFileSync(out('logo.svg'), logoSvg() + '\n');
process.stdout.write('ícones e logo.svg escritos em public/\n');
