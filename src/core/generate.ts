import { countSolutions } from './solver.ts';
import { DELTA, LEFT, RIGHT, key, reflect, trace } from './trace.ts';
import type { Cell, Color, Dir, Level, Rots } from './types.ts';

const W = 6;
const H = 8;
const MAX_ATTEMPTS = 20000;
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const COLORS: Color[] = [7, 1, 2, 4, 3, 5, 6];

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

interface Draft {
  cells: Cell[];
  sol: Rots;
}

// Caminha um feixe a partir do emissor, colocando um espelho em cada curva e o alvo no fim.
function walkBeam(r: Rng, d: Draft, used: Set<string>, path: Set<string>, mirrors: number): boolean {
  const free = (x: number, y: number): boolean => inside(x, y) && !used.has(key(x, y)) && !path.has(key(x, y));
  let x: number;
  let y: number;
  let dir: Dir;
  do {
    x = int(r, 0, W - 1);
    y = int(r, 0, H - 1);
    dir = pick(r, DIRS);
  } while (!free(x, y));
  const color = pick(r, COLORS);
  d.cells.push({ x, y, t: 'emitter', dir, color });
  used.add(key(x, y));

  for (let m = 0; m <= mirrors; m++) {
    const [dx, dy] = DELTA[dir];
    const runs: number[] = [];
    for (let run = 1; run <= 5; run++) {
      const ex = x + dx * run;
      const ey = y + dy * run;
      if (!inside(ex, ey) || used.has(key(ex, ey))) break;
      if (!path.has(key(ex, ey))) runs.push(run);
    }
    if (runs.length === 0) return false;
    const run = pick(r, runs);
    for (let s = 1; s < run; s++) path.add(key(x + dx * s, y + dy * s));
    x += dx * run;
    y += dy * run;
    used.add(key(x, y));
    if (m === mirrors) {
      d.cells.push({ x, y, t: 'target', color });
      return true;
    }
    const next = r() < 0.5 ? LEFT[dir] : RIGHT[dir];
    const rot: 0 | 1 = reflect(dir, 0) === next ? 0 : 1;
    d.cells.push({ x, y, t: 'mirror' });
    d.sol.push(rot);
    dir = next;
  }
  return true;
}

function touchesAllMirrors(level: Level, sol: Rots): boolean {
  const ends = new Set<string>();
  for (const s of trace(level, sol).segments) ends.add(key(s.x2, s.y2));
  return level.cells.every((c) => c.t !== 'mirror' || ends.has(key(c.x, c.y)));
}

function tryBuild(r: Rng, id: number, nMirrors: number): Level | null {
  const nBeams = nMirrors >= 9 ? 3 : nMirrors >= 6 ? 2 : 1;
  const d: Draft = { cells: [], sol: [] };
  const used = new Set<string>();
  const path = new Set<string>();
  let left = nMirrors;
  for (let b = 0; b < nBeams; b++) {
    const k = b === nBeams - 1 ? left : Math.max(1, Math.round(nMirrors / nBeams) + int(r, -1, 1));
    left -= k;
    if (k < 1 || !walkBeam(r, d, used, path, k)) return null;
  }

  const walls = int(r, 1, 4);
  for (let i = 0; i < walls * 4 && d.cells.filter((c) => c.t === 'wall').length < walls; i++) {
    const x = int(r, 0, W - 1);
    const y = int(r, 0, H - 1);
    if (used.has(key(x, y)) || path.has(key(x, y))) continue;
    used.add(key(x, y));
    d.cells.push({ x, y, t: 'wall' });
  }

  let start: Rots;
  let flips: number;
  do {
    start = d.sol.map((v) => (r() < 0.6 ? ((1 - v) as 0 | 1) : v));
    flips = start.filter((v, i) => v !== d.sol[i]).length;
  } while (flips < 3);

  const level: Level = { id, w: W, h: H, cells: d.cells, start };
  if (!trace(level, d.sol).solved || trace(level, start).solved) return null;
  if (countSolutions(level, 2).count !== 1) return null;
  if (!touchesAllMirrors(level, d.sol)) return null;
  return level;
}

export function generate(seed: number, nMirrors: number, id: number = seed): Level {
  if (nMirrors < 3) throw new Error('generate: mínimo de 3 espelhos');
  const r = mulberry32(seed);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const level = tryBuild(r, id, nMirrors);
    if (level) return level;
  }
  throw new Error(`generate: nenhuma fase válida (seed ${seed}, ${nMirrors} espelhos)`);
}
