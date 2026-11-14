import type { Cell, Color, Dir, Level, Rail, Rots, Segment, TraceResult } from './types.ts';

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
export const OPP: Record<Dir, Dir> = { E: 'W', W: 'E', N: 'S', S: 'N' };
export const LEFT: Record<Dir, Dir> = { E: 'N', N: 'W', W: 'S', S: 'E' };
export const RIGHT: Record<Dir, Dir> = { E: 'S', S: 'W', W: 'N', N: 'E' };
export const FILTER_COLORS: readonly Color[] = [1, 2, 4];

export const key = (x: number, y: number): string => `${x},${y}`;

export function reflect(dir: Dir, rot: number): Dir {
  return rot === 0 ? SLASH[dir] : BACKSLASH[dir];
}

export const isPiece = (c: Cell): boolean =>
  c.t === 'mirror' ||
  c.t === 'filter' ||
  c.t === 'splitter' ||
  c.t === 'dichroic' ||
  (c.t === 'prism' && c.rail !== undefined);
// Estados de rotação (sem contar o trilho).
export const baseStates = (c: Cell): number => (c.t === 'filter' ? 3 : c.t === 'prism' ? 1 : 2);
export const railOf = (c: Cell): Rail | undefined => (c.t === 'mirror' || c.t === 'prism' ? c.rail : undefined);
export const pieceStates = (c: Cell): number => baseStates(c) * (railOf(c)?.len ?? 1);
export const rotOf = (c: Cell, state: number): number => state % baseStates(c);
export const posOf = (c: Cell, state: number): number => Math.floor(state / baseStates(c));

// Células na posição atual: peças em trilho saem do início do trilho para a posição do estado.
export function placeCells(level: Level, rots: Rots): Cell[] {
  let pi = 0;
  return level.cells.map((c) => {
    if (!isPiece(c)) return c;
    const s = rots[pi++] ?? 0;
    const rail = railOf(c);
    if (!rail) return c;
    const p = posOf(c, s);
    return { ...c, x: c.x + (rail.axis === 'x' ? p : 0), y: c.y + (rail.axis === 'y' ? p : 0) };
  });
}

export function pieces(level: Level): Cell[] {
  return level.cells.filter(isPiece);
}

export function mirrorCount(level: Level): number {
  return level.cells.filter((c) => c.t === 'mirror').length;
}

export function startRots(level: Level): Rots {
  return level.start ? [...level.start] : new Array<number>(pieces(level).length).fill(0);
}

interface Beam {
  x: number;
  y: number;
  dir: Dir;
  color: Color;
}

export function trace(level: Level, rots: Rots, maxSteps: number = MAX_STEPS): TraceResult {
  const grid = new Map<string, Cell>();
  const pieceIdx = new Map<string, number>();
  const received: Record<string, number> = {};
  const queue: Beam[] = [];
  let pi = 0;
  for (const c of placeCells(level, rots)) {
    const k = key(c.x, c.y);
    grid.set(k, c);
    if (isPiece(c)) pieceIdx.set(k, pi++);
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

    let { x, y, dir, color } = b;
    let sx = x;
    let sy = y;
    const push = (ex: number, ey: number): void => {
      if (ex !== sx || ey !== sy) segments.push({ x1: sx, y1: sy, x2: ex, y2: ey, color });
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
          dir = reflect(dir, (rots[pieceIdx.get(k)!] ?? 0) % 2);
          break;
        case 'dichroic': {
          // Filme fino: a cor do espelho reflete, as outras componentes atravessam reto.
          const refl = color & c.color;
          const pass = color & ~c.color;
          if (refl === 0) break;
          push(x, y);
          if (pass !== 0) queue.push({ x, y, dir, color: pass as Color });
          color = refl as Color;
          dir = reflect(dir, (rots[pieceIdx.get(k)!] ?? 0) % 2);
          break;
        }
        case 'splitter':
          // Metade segue reto (novo feixe na fila), metade reflete como espelho.
          push(x, y);
          queue.push({ x, y, dir, color });
          dir = reflect(dir, rots[pieceIdx.get(k)!] ?? 0);
          break;
        case 'filter': {
          const passed = color & FILTER_COLORS[rots[pieceIdx.get(k)!] ?? 0]!;
          if (passed === color) break;
          push(x, y);
          if (passed === 0) ended = true;
          else color = passed as Color;
          break;
        }
        case 'target':
          push(x, y);
          received[k] = (received[k] ?? 0) | color;
          ended = true;
          break;
        case 'prism':
          push(x, y);
          if (color & 1) queue.push({ x, y, dir: LEFT[dir], color: 1 });
          if (color & 2) queue.push({ x, y, dir, color: 2 });
          if (color & 4) queue.push({ x, y, dir: RIGHT[dir], color: 4 });
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
