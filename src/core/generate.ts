import { MAX_SPACE, countEssential, litCells, searchSpace } from './solver.ts';
import { DELTA, FILTER_COLORS, LEFT, OPP, RIGHT, isPiece, key, pieceStates, placeCells, posOf, reflect, trace } from './trace.ts';
import type { Cell, Color, Dir, Level, Rots } from './types.ts';
import { expand, GRID } from './grid.ts';

// O gerador monta as fases numa área 6x8 (as mesmas fases de antes da grade 7x9) e no fim
// abre uma coluna e uma linha no meio (expand) para ocupar a grade GRID.
const W = 6;
const H = 8;
const MAX_ATTEMPTS = 20000;
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const COLORS: Color[] = [7, 1, 2, 4, 3, 5, 6];
const MULTI: Color[] = [7, 7, 3, 5, 6];
const MERGED: Color[] = [3, 5, 6, 3, 5, 6, 7];

export interface GenOptions {
  mirrors: number;
  beams?: number;
  filters?: number; // feixes que terminam num alvo de uma cor só, escolhida por um filtro
  prism?: boolean; // o primeiro feixe é branco e passa por um prisma
  prisms?: number; // quantos feixes (os primeiros) são brancos e passam por um prisma; substitui prism
  decoys?: number; // peças distratoras: fora da luz na solução, perto do caminho, só para confundir
  portals?: number; // feixes que atravessam um par de portais (no lugar de uma curva)
  gates?: number; // feixe extra até um sensor que abre uma porta no caminho de outro feixe
  darks?: number; // anti-alvos: perto do caminho ou nele, com cor que não passa ali
  links?: number; // pares de espelhos ligados (giram juntos)
  merge?: number; // alvos de cor combinada, cada um alimentado por um lançador por componente
  mergeMirrors?: number; // máximo de espelhos no caminho de cada componente até o alvo combinado
  splitters?: number; // feixes que passam por um divisor e se ramificam em dois alvos
  dichroics?: number; // feixes de várias cores que passam por um espelho dicroico: uma cor reflete, o resto segue
  slider?: 'mirror' | 'prism'; // uma peça desse tipo vai para um trilho e precisa ser arrastada
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

// Caminha um feixe: espelho em cada curva, prisma opcional, divisor opcional, filtro opcional, alvo no fim.
// end = 'emitter': caminhada reversa, sai de um alvo e termina num lançador apontado de volta
// (o caminho da luz é reversível, então a solução dos espelhos é a mesma).
function walk(
  d: Draft,
  x: number,
  y: number,
  dir: Dir,
  color: Color,
  mirrors: number,
  prismAt: number,
  filter: boolean,
  end: 'target' | 'emitter' = 'target',
  splitAt = -1,
  dichroic = false,
  portalAt = -1,
  sensorGate = -1, // >= 0: o feixe termina num sensor que abre a porta desse número
): boolean {
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

    if (m === portalAt && m < mirrors) {
      // Portal no lugar desta curva: a luz salta para o outro portal, numa célula livre, e segue reto.
      const [ddx, ddy] = DELTA[dir];
      const free: [number, number][] = [];
      for (let by = 0; by < H; by++) {
        for (let bx = 0; bx < W; bx++) {
          const k = key(bx, by);
          if (d.used.has(k) || d.path.has(k) || !inside(bx + ddx, by + ddy) || d.used.has(key(bx + ddx, by + ddy))) continue;
          if (Math.abs(bx - x) + Math.abs(by - y) < 3) continue;
          free.push([bx, by]);
        }
      }
      if (free.length === 0) return false;
      const [bx, by] = pick(d.r, free);
      const pair = d.cells.filter((c) => c.t === 'portal').length / 2;
      d.cells.push({ x, y, t: 'portal', pair }, { x: bx, y: by, t: 'portal', pair });
      d.used.add(key(bx, by));
      x = bx;
      y = by;
      continue;
    }
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
    if (m === mirrors && end === 'emitter') {
      d.cells.push({ x, y, t: 'emitter', dir: OPP[dir], color });
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
      if (sensorGate >= 0) d.cells.push({ x, y, t: 'sensor', color: target, gate: sensorGate });
      else d.cells.push({ x, y, t: 'target', color: target });
      return true;
    }
    const next = d.r() < 0.5 ? LEFT[dir] : RIGHT[dir];
    if (m === splitAt && dichroic) {
      // Dicroico: a cor dele reflete e segue um ramo, as outras atravessam e seguem outro.
      const refl = pick(d.r, bits(color));
      d.cells.push({ x, y, t: 'dichroic', color: refl as 1 | 2 | 4 });
      d.sol.push(reflect(dir, 0) === next ? 0 : 1);
      const left = mirrors - m - 1;
      const k = int(d.r, 0, left);
      return (
        walk(d, x, y, dir, (color & ~refl) as Color, k, -1, false) &&
        walk(d, x, y, next, refl, left - k, -1, false)
      );
    }
    if (m === splitAt) {
      // Divisor: o reflexo segue um ramo, a parte que atravessa segue outro, cada um até seu alvo.
      d.cells.push({ x, y, t: 'splitter' });
      d.sol.push(reflect(dir, 0) === next ? 0 : 1);
      const left = mirrors - m - 1;
      const k = int(d.r, 0, left);
      return walk(d, x, y, dir, color, k, -1, false) && walk(d, x, y, next, color, left - k, -1, false);
    }
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
  let splitters = o.splitters ?? 0;
  let dichroics = o.dichroics ?? 0;
  let portals = o.portals ?? 0;

  // Alvos combinados primeiro: cada componente sai do alvo por um lado diferente até seu lançador.
  for (let i = 0; i < (o.merge ?? 0); i++) {
    let tx: number;
    let ty: number;
    do {
      tx = int(r, 0, W - 1);
      ty = int(r, 0, H - 1);
    } while (d.used.has(key(tx, ty)) || d.path.has(key(tx, ty)));
    const color = pick(r, MERGED);
    d.cells.push({ x: tx, y: ty, t: 'target', color });
    d.used.add(key(tx, ty));
    const sides = [...DIRS].sort(() => r() - 0.5);
    for (const [j, comp] of bits(color).entries()) {
      if (!walk(d, tx, ty, sides[j]!, comp, int(r, 1, o.mergeMirrors ?? 2), -1, false, 'emitter')) return null;
    }
  }
  for (let b = 0; b < nBeams; b++) {
    const k = b === nBeams - 1 ? left : Math.max(1, Math.round(o.mirrors / nBeams) + int(r, -1, 1));
    left -= k;
    if (k < 0) return null;
    const prism = b < (o.prisms ?? (o.prism ? 1 : 0));
    const filter = !prism && filters > 0;
    if (filter) filters--;
    let x: number;
    let y: number;
    do {
      x = int(r, 0, W - 1);
      y = int(r, 0, H - 1);
    } while (d.used.has(key(x, y)) || d.path.has(key(x, y)));
    const dich = !prism && !filter && dichroics > 0 && k >= 2;
    if (dich) dichroics--;
    const color: Color = prism ? 7 : filter || dich ? pick(r, MULTI) : pick(r, COLORS);
    d.cells.push({ x, y, t: 'emitter', dir: pick(r, DIRS), color });
    d.used.add(key(x, y));
    const prismAt = prism ? int(r, 0, Math.min(2, k)) : -1;
    const split = dich || (!prism && !filter && splitters > 0 && k >= 2);
    if (split && !dich) splitters--;
    const splitAt = split ? int(r, 0, Math.min(2, k - 2)) : -1;
    const cell = d.cells.at(-1) as Extract<Cell, { t: 'emitter' }>;
    const portal = !prism && portals > 0 && k >= 2;
    if (portal) portals--;
    const portalAt = portal ? int(r, 0, k - 1) : -1;
    if (!walk(d, x, y, cell.dir, color, k, prismAt, filter, 'target', splitAt, dich, portalAt)) return null;
  }
  if (filters > 0 || splitters > 0 || dichroics > 0 || portals > 0) return null;

  // Sensor e porta: um feixe extra acende um sensor; a porta dele fica num trecho reto de outro feixe.
  for (let g = 0; g < (o.gates ?? 0); g++) {
    const before = new Set(d.path);
    let x: number;
    let y: number;
    do {
      x = int(r, 0, W - 1);
      y = int(r, 0, H - 1);
    } while (d.used.has(key(x, y)) || d.path.has(key(x, y)));
    const color = pick(r, [1, 2, 4, 3, 5, 6] as Color[]);
    const dir = pick(r, DIRS);
    d.cells.push({ x, y, t: 'emitter', dir, color });
    d.used.add(key(x, y));
    if (!walk(d, x, y, dir, color, int(r, 1, 3), -1, false, 'target', -1, false, -1, g)) return null;
    const spots = [...before].filter((k) => !d.used.has(k));
    if (spots.length === 0) return null;
    const [gx, gy] = pick(r, spots).split(',').map(Number) as [number, number];
    d.cells.push({ x: gx, y: gy, t: 'gate', id: g });
    d.used.add(key(gx, gy));
  }

  const walls = int(r, 1, 4);
  for (let i = 0; i < walls * 4 && d.cells.filter((c) => c.t === 'wall').length < walls; i++) {
    const x = int(r, 0, W - 1);
    const y = int(r, 0, H - 1);
    if (d.used.has(key(x, y)) || d.path.has(key(x, y))) continue;
    d.used.add(key(x, y));
    d.cells.push({ x, y, t: 'wall' });
  }

  // Trilho: a peça escolhida ganha 3-4 posições livres em linha passando pela posição da solução.
  let slider: { cell: Extract<Cell, { t: 'mirror' | 'prism' }>; pos: number } | null = null;
  if (o.slider) {
    const cands = d.cells.filter((c): c is Extract<Cell, { t: 'mirror' | 'prism' }> => c.t === o.slider);
    if (cands.length === 0) return null;
    const c = pick(r, cands);
    const axis = r() < 0.5 ? 'x' : 'y';
    const [dx, dy] = axis === 'x' ? [1, 0] : [0, 1];
    const free = (x: number, y: number): boolean => inside(x, y) && !d.cells.some((q) => q !== c && q.x === x && q.y === y);
    let lo = 0;
    while (free(c.x - (lo + 1) * dx, c.y - (lo + 1) * dy)) lo++;
    let hi = 0;
    while (free(c.x + (hi + 1) * dx, c.y + (hi + 1) * dy)) hi++;
    const len = Math.min(int(r, 3, 4), lo + hi + 1);
    if (len < 3) return null;
    const before = int(r, Math.max(0, len - 1 - hi), Math.min(lo, len - 1));
    c.x -= before * dx;
    c.y -= before * dy;
    c.rail = { axis, len };
    slider = { cell: c, pos: before };
    for (let p = 0; p < len; p++) d.used.add(key(c.x + p * dx, c.y + p * dy));
  }

  // Distratoras: espelhos, divisores, dicroicos e prismas fixos ao lado do caminho, mas fora da luz.
  // O estado delas não importa (a unicidade ignora peças apagadas); só não podem abrir outra solução.
  const decoys = new Set<Cell>();
  const near = (x: number, y: number): boolean =>
    DIRS.some((dd) => {
      const k = key(x + DELTA[dd][0], y + DELTA[dd][1]);
      return d.path.has(k) || d.used.has(k);
    });
  for (let i = 0; i < (o.decoys ?? 0); i++) {
    const free: [number, number][] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (!d.used.has(key(x, y)) && !d.path.has(key(x, y)) && near(x, y)) free.push([x, y]);
    }
    if (free.length === 0) return null;
    const [x, y] = pick(r, free);
    const roll = r();
    const c: Cell =
      roll < 0.5
        ? { x, y, t: 'mirror' }
        : roll < 0.7
          ? { x, y, t: 'splitter' }
          : roll < 0.85
            ? { x, y, t: 'dichroic', color: pick(r, [1, 2, 4] as const) }
            : { x, y, t: 'prism' };
    d.cells.push(c);
    d.used.add(key(x, y));
    decoys.add(c);
    if (c.t !== 'prism') d.sol.push(int(r, 0, 1));
  }

  // d.sol está na ordem de colocação; a ordem de rots é a de level.cells. Prisma em trilho não está em d.sol.
  const order = d.cells.filter(isPiece);
  let si = 0;
  const sol = order.map((c) => {
    if (c.t === 'prism') return slider!.pos;
    const v = d.sol[si++]!;
    return c === slider?.cell ? v + 2 * slider.pos : v;
  });
  const states = order.map(pieceStates);
  const sl = slider ? order.indexOf(slider.cell) : -1;
  const real = order.map((c) => !decoys.has(c));
  const minMoves = Math.min(o.minMoves ?? 3, real.filter(Boolean).length);
  let start: Rots;
  do {
    start = sol.map((v, i) => (!real[i] || r() < 0.6 ? (v + int(r, 1, states[i]! - 1)) % states[i]! : v));
  } while (
    start.filter((v, i) => real[i] && v !== sol[i]).length < minMoves ||
    (slider !== null && posOf(slider.cell, start[sl]!) === slider.pos)
  );

  // Espelhos ligados (pares): começam ambos certos ou ambos errados, senão a solução seria inalcançável.
  const free = order.flatMap((c, i) => (c.t === 'mirror' && !c.rail && real[i] ? [i] : []));
  for (let g = 0; g < (o.links ?? 0); g++) {
    if (free.length < 2) return null;
    const a = free.splice(int(r, 0, free.length - 1), 1)[0]!;
    const b = free.splice(int(r, 0, free.length - 1), 1)[0]!;
    const off = g === 0 ? 1 : int(r, 0, 1);
    for (const i of [a, b]) {
      (order[i] as Extract<Cell, { t: 'mirror' }>).link = g;
      start[i] = (sol[i]! + off) % 2;
    }
  }

  // Anti-alvos: metade numa célula vazia do caminho com uma cor que não passa ali, metade ao lado do caminho.
  if (o.darks) {
    const probe = { id, w: W, h: H, cells: d.cells, start } as unknown as Level;
    const passing = new Map<string, number>();
    for (const sg of trace(probe, sol).segments) {
      const len = Math.abs(sg.x2 - sg.x1) + Math.abs(sg.y2 - sg.y1);
      for (let t = 1; t < len; t++) {
        const k = key(sg.x1 + Math.sign(sg.x2 - sg.x1) * t, sg.y1 + Math.sign(sg.y2 - sg.y1) * t);
        passing.set(k, (passing.get(k) ?? 0) | sg.color);
      }
    }
    for (let i = 0; i < o.darks; i++) {
      const onPath = [...passing].filter(([k, c]) => !d.used.has(k) && c !== 7);
      if (i % 2 === 0 && onPath.length > 0) {
        const [k, c] = pick(r, onPath);
        const [x, y] = k.split(',').map(Number) as [number, number];
        d.cells.push({ x, y, t: 'dark', color: pick(r, bits(7 & ~c)) });
        d.used.add(k);
      } else {
        const near: [number, number][] = [];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const k = key(x, y);
            if (d.used.has(k) || passing.has(k)) continue;
            if (DIRS.some((dd) => passing.has(key(x + DELTA[dd][0], y + DELTA[dd][1])))) near.push([x, y]);
          }
        }
        if (near.length === 0) return null;
        const [x, y] = pick(r, near);
        d.cells.push({ x, y, t: 'dark' });
        d.used.add(key(x, y));
      }
    }
  }

  const level: Level = { id, w: GRID.w, h: GRID.h, cells: d.cells, start };
  if (!trace(level, sol).solved || trace(level, start).solved) return null;
  const ends = new Set(trace(level, sol).segments.map((s) => key(s.x2, s.y2)));
  const placed = placeCells(level, sol);
  const lit = litCells(level, sol);
  const ok = level.cells.every((c, i) => {
    const p = placed[i]!;
    if (decoys.has(c)) return !lit.has(key(p.x, p.y));
    return (c.t !== 'mirror' && c.t !== 'splitter' && c.t !== 'dichroic') || ends.has(key(p.x, p.y));
  });
  if (!ok) return null;
  if (searchSpace(level) > MAX_SPACE || countEssential(level, 2) !== 1) return null;
  return level;
}

export function generate(seed: number, opts: GenOptions | number, id: number = seed): Level {
  const o: GenOptions = typeof opts === 'number' ? { mirrors: opts } : opts;
  if (o.mirrors < 0) throw new Error('generate: espelhos negativos');
  const r = mulberry32(seed);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const level = tryBuild(r, id, o);
    if (level) return expand(level);
  }
  throw new Error(`generate: nenhuma fase válida (seed ${seed}, ${JSON.stringify(o)})`);
}
