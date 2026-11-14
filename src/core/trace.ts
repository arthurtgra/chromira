import type { Cell, Color, Dir, Level, Rots, Segment, TraceResult } from './types.ts';

export const MAX_STEPS = 200;
const MAX_BEAMS = 64;

export const DELTA: Record<Dir, readonly [number, number]> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
};
const SLASH: Record<Dir, Dir> = { E: 'N', W: 'S', N: 'E', S: 'W' };
const BACKSLASH: Record<Dir, Dir> = { E: 'S', W: 'N', N: 'W', S: 'E' };
export const LEFT: Record<Dir, Dir> = { E: 'N', N: 'W', W: 'S', S: 'E' };
export const RIGHT: Record<Dir, Dir> = { E: 'S', S: 'W', W: 'N', N: 'E' };

export const key = (x: number, y: number): string => `${x},${y}`;

export function reflect(dir: Dir, rot: 0 | 1): Dir {
  return rot === 0 ? SLASH[dir] : BACKSLASH[dir];
}

export function mirrorCount(level: Level): number {
  return level.cells.filter((c) => c.t === 'mirror').length;
}

export function startRots(level: Level): Rots {
  return level.start ? [...level.start] : new Array<0 | 1>(mirrorCount(level)).fill(0);
}

interface Beam {
  x: number;
  y: number;
  dir: Dir;
  color: Color;
}

export function trace(level: Level, rots: Rots, maxSteps: number = MAX_STEPS): TraceResult {
  const grid = new Map<string, Cell>();
  const mirrorIdx = new Map<string, number>();
  const received: Record<string, number> = {};
  const queue: Beam[] = [];
  let mi = 0;
  for (const c of level.cells) {
    const k = key(c.x, c.y);
    grid.set(k, c);
    if (c.t === 'mirror') mirrorIdx.set(k, mi++);
    else if (c.t === 'target') received[k] = 0;
    else if (c.t === 'emitter') queue.push({ x: c.x, y: c.y, dir: c.dir, color: c.color });
  }

  const segments: Segment[] = [];
  const seen = new Set<string>();
  let beams = 0;

  while (queue.length > 0 && beams < MAX_BEAMS) {
    const b = queue.shift()!;
    const sig = `${b.x},${b.y},${b.dir},${b.color}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    beams++;

    let { x, y, dir } = b;
    let sx = x;
    let sy = y;
    const push = (ex: number, ey: number): void => {
      if (ex !== sx || ey !== sy) segments.push({ x1: sx, y1: sy, x2: ex, y2: ey, color: b.color });
      sx = ex;
      sy = ey;
    };

    let ended = false;
    for (let step = 0; step < maxSteps && !ended; step++) {
      const [dx, dy] = DELTA[dir];
      x += dx;
      y += dy;
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) {
        push(x - dx * 0.5, y - dy * 0.5);
        ended = true;
        break;
      }
      const k = key(x, y);
      const c = grid.get(k);
      if (!c) continue;
      switch (c.t) {
        case 'mirror':
          push(x, y);
          dir = reflect(dir, rots[mirrorIdx.get(k)!] ?? 0);
          break;
        case 'target':
          push(x, y);
          received[k] = (received[k] ?? 0) | b.color;
          ended = true;
          break;
        case 'prism':
          push(x, y);
          if (b.color & 1) queue.push({ x, y, dir: LEFT[dir], color: 1 });
          if (b.color & 2) queue.push({ x, y, dir, color: 2 });
          if (b.color & 4) queue.push({ x, y, dir: RIGHT[dir], color: 4 });
          ended = true;
          break;
        default:
          push(x - dx * 0.5, y - dy * 0.5);
          ended = true;
      }
    }
    if (!ended) push(x, y);
  }

  const targets = level.cells.filter((c) => c.t === 'target');
  const solved =
    targets.length > 0 && targets.every((t) => t.t === 'target' && received[key(t.x, t.y)] === t.color);
  return { segments, received, solved };
}
