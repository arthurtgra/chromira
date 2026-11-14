import { countSolutions } from './solver.ts';
import { DELTA, FILTER_COLORS, LEFT, RIGHT, key, reflect, trace } from './trace.ts';
import type { Cell, Color, Dir, Level, Rots } from './types.ts';

const W = 6;
const H = 8;
const MAX_ATTEMPTS = 20000;
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const COLORS: Color[] = [7, 1, 2, 4, 3, 5, 6];
const MULTI: Color[] = [7, 7, 3, 5, 6];

export interface GenOptions {
  mirrors: number;
  beams?: number;
  filters?: number; // feixes que terminam num alvo de uma cor só, escolhida por um filtro
  prism?: boolean; // o primeiro feixe é branco e passa por um prisma
  minMoves?: number;
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
const bits = (c: number): Color[] => ([1, 2, 4] as Color[]).filter((b) => c & b);

interface Draft {
  r: Rng;
  cells: Cell[];
  sol: Rots;
  used: Set<string>;
  path: Set<string>;
}

// Caminha um feixe: espelho em cada curva, prisma opcional, filtro opcional, alvo no fim.
function walk(d: Draft, x: number, y: number, dir: Dir, color: Color, mirrors: number, prismAt: number, filter: boolean): boolean {
  const fresh: string[] = [];
  for (let m = 0; m <= mirrors; m++) {
    const [dx, dy] = DELTA[dir];
    const runs: number[] = [];
    for (let run = 1; run <= 5; run++) {
      const ex = x + dx * run;
      const ey = y + dy * run;
      if (!inside(ex, ey) || d.used.has(key(ex, ey))) break;
      if (!d.path.has(key(ex, ey))) runs.push(run);
    }
    if (runs.length === 0) return false;
    const run = pick(d.r, runs);
    for (let s = 1; s < run; s++) {
      const k = key(x + dx * s, y + dy * s);
      if (!d.path.has(k)) fresh.push(k);
      d.path.add(k);
    }
    x += dx * run;
    y += dy * run;
    d.used.add(key(x, y));

    if (m === prismAt) {
      d.cells.push({ x, y, t: 'prism' });
      const comps = bits(color);
      let left = mirrors - m;
      for (const [i, comp] of comps.entries()) {
        const k = i === comps.length - 1 ? left : int(d.r, 0, left);
        left -= k;
        const out = comp === 1 ? LEFT[dir] : comp === 4 ? RIGHT[dir] : dir;
        if (!walk(d, x, y, out, comp, k, -1, false)) return false;
      }
      return true;
    }
    if (m === mirrors) {
      let target = color;
      if (filter) {
        if (fresh.length === 0 || bits(color).length < 2) return false;
        target = pick(d.r, bits(color));
        const [fx, fy] = pick(d.r, fresh).split(',').map(Number) as [number, number];
        d.cells.push({ x: fx, y: fy, t: 'filter' });
        d.sol.push(FILTER_COLORS.indexOf(target));
        d.used.add(key(fx, fy));
      }
      d.cells.push({ x, y, t: 'target', color: target });
      return true;
    }
    const next = d.r() < 0.5 ? LEFT[dir] : RIGHT[dir];
    d.cells.push({ x, y, t: 'mirror' });
    d.sol.push(reflect(dir, 0) === next ? 0 : 1);
    dir = next;
  }
  return true;
}

function tryBuild(r: Rng, id: number, o: GenOptions): Level | null {
  const nBeams = o.beams ?? (o.mirrors >= 9 ? 3 : o.mirrors >= 6 ? 2 : 1);
  const d: Draft = { r, cells: [], sol: [], used: new Set(), path: new Set() };
  let left = o.mirrors;
  let filters = o.filters ?? 0;
  for (let b = 0; b < nBeams; b++) {
    const k = b === nBeams - 1 ? left : Math.max(1, Math.round(o.mirrors / nBeams) + int(r, -1, 1));
    left -= k;
    if (k < 0) return null;
    const prism = b === 0 && o.prism === true;
    const filter = !prism && filters > 0;
    if (filter) filters--;
    let x: number;
    let y: number;
    do {
      x = int(r, 0, W - 1);
      y = int(r, 0, H - 1);
    } while (d.used.has(key(x, y)) || d.path.has(key(x, y)));
    const color: Color = prism ? 7 : filter ? pick(r, MULTI) : pick(r, COLORS);
    d.cells.push({ x, y, t: 'emitter', dir: pick(r, DIRS), color });
    d.used.add(key(x, y));
    const prismAt = prism ? int(r, 0, Math.min(2, k)) : -1;
    const cell = d.cells.at(-1) as Extract<Cell, { t: 'emitter' }>;
    if (!walk(d, x, y, cell.dir, color, k, prismAt, filter)) return null;
  }
  if (filters > 0) return null;

  const walls = int(r, 1, 4);
  for (let i = 0; i < walls * 4 && d.cells.filter((c) => c.t === 'wall').length < walls; i++) {
    const x = int(r, 0, W - 1);
    const y = int(r, 0, H - 1);
    if (d.used.has(key(x, y)) || d.path.has(key(x, y))) continue;
    d.used.add(key(x, y));
    d.cells.push({ x, y, t: 'wall' });
  }

  // d.sol está na ordem de colocação; a ordem de rots é a de level.cells.
  const order = d.cells.filter((c) => c.t === 'mirror' || c.t === 'filter');
  const sol = order.map((_, i) => d.sol[i]!);
  const states = order.map((c) => (c.t === 'filter' ? 3 : 2));
  const minMoves = Math.min(o.minMoves ?? 3, sol.length);
  let start: Rots;
  do {
    start = sol.map((v, i) => (r() < 0.6 ? (v + int(r, 1, states[i]! - 1)) % states[i]! : v));
  } while (start.filter((v, i) => v !== sol[i]).length < minMoves);

  const level: Level = { id, w: W, h: H, cells: d.cells, start };
  if (!trace(level, sol).solved || trace(level, start).solved) return null;
  if (countSolutions(level, 2).count !== 1) return null;
  const ends = new Set(trace(level, sol).segments.map((s) => key(s.x2, s.y2)));
  if (!d.cells.every((c) => c.t !== 'mirror' || ends.has(key(c.x, c.y)))) return null;
  return level;
}

export function generate(seed: number, opts: GenOptions | number, id: number = seed): Level {
  const o: GenOptions = typeof opts === 'number' ? { mirrors: opts } : opts;
  if (o.mirrors < 0) throw new Error('generate: espelhos negativos');
  const r = mulberry32(seed);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const level = tryBuild(r, id, o);
    if (level) return level;
  }
  throw new Error(`generate: nenhuma fase válida (seed ${seed}, ${JSON.stringify(o)})`);
}
