// Gera public/icon-192.png e public/icon-512.png sem dependências (PNG escrito à mão).
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const BG = [11, 11, 18];
const BEAMS: [number, number, number, number][] = [
  // cor RGB + ângulo do feixe que sai do centro
  [255, 42, 58, -Math.PI / 2],
  [42, 255, 90, 0],
  [58, 106, 255, Math.PI / 2],
];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function icon(size: number): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  const width = size * 0.035;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = [...BG];
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      // feixe branco entrando pela esquerda
      const glow = (d: number): number => Math.exp(-((d / width) ** 2)) + 0.25 * Math.exp(-((d / (width * 4)) ** 2));
      if (dx < 0) for (let k = 0; k < 3; k++) px[k] += 255 * glow(Math.abs(dy));
      for (const [r, g, b, a] of BEAMS) {
        const along = dx * Math.cos(a) + dy * Math.sin(a);
        if (along < 0) continue;
        const perp = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
        const f = glow(perp);
        px[0] += r * f;
        px[1] += g * f;
        px[2] += b * f;
      }
      // prisma: triângulo de contorno branco
      const s = size * 0.16;
      const inTri = (sc: number): boolean => {
        const ty = dy + s * sc * 0.25;
        return ty <= s * sc * 0.75 && ty >= -s * sc * 0.75 && Math.abs(dx) <= ((s * sc * 0.75 - ty) / (1.5 * s * sc)) * s * sc * 0.87 * 2 * 0.5 * 2;
      };
      if (inTri(1) && !inTri(0.8)) for (let k = 0; k < 3; k++) px[k] = 255;
      else if (inTri(0.8)) for (let k = 0; k < 3; k++) px[k] = BG[k]!;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.min(255, Math.round(px[k]!));
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

for (const size of [192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), icon(size));
process.stdout.write('ícones escritos em public/\n');
