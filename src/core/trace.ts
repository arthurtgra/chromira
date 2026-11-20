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
  c.t === 'bender' ||
  c.t === 'combiner' ||
  (c.t === 'prism' && c.rail !== undefined);
// Estados de rotação (sem contar o trilho).
export const baseStates = (c: Cell): number =>
  c.t === 'filter' ? 3 : c.t === 'prism' ? 1 : c.t === 'combiner' ? 4 : 2;
export const COMBINER_DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];
// Cristal: cada componente vira a seguinte (R→G→B→R).
export const shiftColor = (c: Color): Color => (((c << 1) | (c >> 2)) & 7) as Color;
export const railOf = (c: Cell): Rail | undefined => (c.t === 'mirror' || c.t === 'prism' ? c.rail : undefined);
export const pieceStates = (c: Cell): number => baseStates(c) * (railOf(c)?.len ?? 1);
export const linkOf = (c: Cell): number | undefined =>
  c.t === 'mirror' || c.t === 'splitter' || c.t === 'dichroic' ? c.link : undefined;
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
  d: number; // distância percorrida desde o lançador até (x, y)
}

// Sensores abrem portas, portas abertas deixam a luz chegar a outros sensores: repete até estabilizar.
// Abrir uma porta só acrescenta luz, então o conjunto de portas abertas só cresce e termina.
export function trace(level: Level, rots: Rots, maxSteps: number = MAX_STEPS): TraceResult {
  const sensors = level.cells.filter((c): c is Extract<Cell, { t: 'sensor' }> => c.t === 'sensor');
  let open = new Set<number>();
  for (;;) {
    const r = traceOnce(level, rots, maxSteps, open);
    const next = new Set(sensors.filter((s) => ((r.received[key(s.x, s.y)] ?? 0) & s.color) === s.color).map((s) => s.gate));
    if (next.size === open.size) return r;
    open = next;
  }
}

function traceOnce(level: Level, rots: Rots, maxSteps: number, open: Set<number>): TraceResult {
  const grid = new Map<string, Cell>();
  const portals = new Map<number, Cell[]>();
  const fibers = new Map<number, Extract<Cell, { t: 'fiber' }>[]>();
  const isWell = (x: number, y: number): boolean => grid.get(key(x, y))?.t === 'well';
  const dark: string[] = [];
  const pieceIdx = new Map<string, number>();
  const received: Record<string, number> = {};
  const queue: Beam[] = [];
  let pi = 0;
  for (const c of placeCells(level, rots)) {
    const k = key(c.x, c.y);
    grid.set(k, c);
    if (isPiece(c)) pieceIdx.set(k, pi++);
    else if (c.t === 'target' || c.t === 'sensor') received[k] = 0;
    else if (c.t === 'portal') portals.set(c.pair, [...(portals.get(c.pair) ?? []), c]);
    else if (c.t === 'fiber') fibers.set(c.pair, [...(fibers.get(c.pair) ?? []), c]);
    else if (c.t === 'emitter') queue.push({ x: c.x, y: c.y, dir: c.dir, color: c.color, d: 0 });
  }

  const segments: Segment[] = [];
  const seen = new Set<string>();
  let beams = 0;
  // Lentes que fundem: juntam o que chega e só soltam o feixe somado depois que todo o resto andou.
  const fused = new Map<string, { x: number; y: number; dir: Dir; color: number; d: number }>();
  const released = new Set<string>();
  // Prismas também esperam: a luz que chega por cada lado se soma antes de decidir (cores que vêm juntas
  // pelo mesmo caminho viram uma luz só; três lados com as três cores saem brancos pelo quarto lado).
  const prismIn = new Map<string, { x: number; y: number; by: Map<Dir, { color: number; d: number }[]> }>();
  const prismOut = new Set<string>(); // luzes já soltas: "x,y,white", "x,y,dir,split" ou "x,y,dir,cor,d"

  for (;;) {
  while (queue.length > 0 && beams < MAX_BEAMS) {
    const b = queue.shift()!;
    const sig = `${b.x},${b.y},${b.dir},${b.color}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    beams++;

    let { x, y, dir, color } = b;
    let sx = x;
    let sy = y;
    let dist = b.d;
    let sd = b.d; // distância no início do trecho atual
    const push = (ex: number, ey: number): void => {
      const ed = dist - Math.abs(x - ex) - Math.abs(y - ey);
      if (ex !== sx || ey !== sy) segments.push({ x1: sx, y1: sy, x2: ex, y2: ey, color, d0: sd });
      sx = ex;
      sy = ey;
      sd = ed;
    };

    let ended = false;
    for (let step = 0; step < maxSteps && !ended; step++) {
      const [dx, dy] = DELTA[dir];
      x += dx;
      y += dy;
      dist += 1;
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) {
        push(x - dx * 0.5, y - dy * 0.5);
        ended = true;
        break;
      }
      const k = key(x, y);
      const c = grid.get(k);
      if (!c) {
        // Lente gravitacional ao lado (de raspão): curva na direção dela. Duas, uma de cada lado, se anulam.
        const l = LEFT[dir];
        const rr = RIGHT[dir];
        const wl = isWell(x + DELTA[l][0], y + DELTA[l][1]);
        const wr = isWell(x + DELTA[rr][0], y + DELTA[rr][1]);
        if (wl !== wr) {
          push(x, y);
          dir = wl ? l : rr;
        }
        continue;
      }
      switch (c.t) {
        case 'well':
          break;
        case 'fiber': {
          const q = fibers.get(c.pair)!.find((p) => p !== c);
          if (dir !== OPP[c.dir] || !q) {
            push(x - dx * 0.5, y - dy * 0.5);
            ended = true;
            break;
          }
          push(x, y);
          x = q.x;
          y = q.y;
          sx = x;
          sy = y;
          sd = dist;
          dir = q.dir;
          break;
        }
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
          if (pass !== 0) queue.push({ x, y, dir, color: pass as Color, d: dist });
          color = refl as Color;
          dir = reflect(dir, (rots[pieceIdx.get(k)!] ?? 0) % 2);
          break;
        }
        case 'splitter':
          // Metade segue reto (novo feixe na fila), metade reflete como espelho.
          push(x, y);
          queue.push({ x, y, dir, color, d: dist });
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
        case 'portal': {
          // Sai pelo outro portal do par, mesma direção, mesma distância (a luz não anda no salto).
          const q = portals.get(c.pair)!.find((p) => p !== c);
          if (!q) break;
          push(x, y);
          x = q.x;
          y = q.y;
          sx = x;
          sy = y;
          sd = dist;
          break;
        }
        case 'bender':
          push(x, y);
          dir = (rots[pieceIdx.get(k)!] ?? 0) === 0 ? LEFT[dir] : RIGHT[dir];
          break;
        case 'combiner': {
          push(x, y);
          ended = true;
          const out = COMBINER_DIRS[rots[pieceIdx.get(k)!] ?? 0]!;
          if (out === OPP[dir]) break; // entrando pela saída: a luz é absorvida
          const f = fused.get(k) ?? { x, y, dir: out, color: 0, d: 0 };
          f.color |= color;
          f.d = Math.max(f.d, dist);
          fused.set(k, f);
          break;
        }
        case 'shifter':
          push(x, y);
          color = shiftColor(color);
          break;
        case 'diode':
          if (dir === c.dir) break;
          push(x - dx * 0.5, y - dy * 0.5);
          ended = true;
          break;
        case 'sensor':
          push(x, y);
          received[k] = (received[k] ?? 0) | color;
          ended = true;
          break;
        case 'dark':
          if (c.color !== undefined && (color & c.color) === 0) break;
          push(x, y);
          dark.push(k);
          ended = true;
          break;
        case 'gate':
          if (open.has(c.id)) break;
          push(x - dx * 0.5, y - dy * 0.5);
          ended = true;
          break;
        case 'prism': {
          push(x, y);
          ended = true;
          const p = prismIn.get(k) ?? { x, y, by: new Map() };
          p.by.set(dir, [...(p.by.get(dir) ?? []), { color, d: dist }]);
          prismIn.set(k, p);
          break;
        }
        default:
          push(x - dx * 0.5, y - dy * 0.5);
          ended = true;
      }
    }
    if (!ended) push(x, y);
  }
  let more = false;
  for (const [k, p] of prismIn) {
    if (prismOut.has(`${k},white`)) continue;
    const sides = [...p.by].map(([dir, list]) => ({
      dir,
      list,
      color: list.reduce((m, a) => m | a.color, 0),
      d: Math.max(...list.map((a) => a.d)), // a mistura só existe quando a última luz chega
    }));
    const all = sides.reduce((m, sd) => m | sd.color, 0);
    // Três cores entrando por três lados (nenhum já branco): saem juntas, brancas, pelo lado livre.
    if (sides.length === 3 && all === 7 && sides.every((sd) => sd.color !== 7)) {
      const out = COMBINER_DIRS.find((side) => !sides.some((sd) => OPP[sd.dir] === side))!;
      prismOut.add(`${k},white`);
      queue.push({ x: p.x, y: p.y, dir: out, color: 7, d: Math.max(...sides.map((sd) => sd.d)) });
      more = true;
      continue;
    }
    for (const sd of sides) {
      // Só a luz branca (vinda junta pelo mesmo lado) se abre nas três cores.
      if (sd.color === 7) {
        if (prismOut.has(`${k},${sd.dir},split`)) continue;
        prismOut.add(`${k},${sd.dir},split`);
        more = true;
        queue.push({ x: p.x, y: p.y, dir: LEFT[sd.dir], color: 1, d: sd.d });
        queue.push({ x: p.x, y: p.y, dir: sd.dir, color: 2, d: sd.d });
        queue.push({ x: p.x, y: p.y, dir: RIGHT[sd.dir], color: 4, d: sd.d });
        continue;
      }
      // Luz colorida atravessa reto, sem mudar, cada uma no seu tempo.
      for (const a of sd.list) {
        const ok = `${k},${sd.dir},${a.color},${a.d}`;
        if (prismOut.has(ok)) continue;
        prismOut.add(ok);
        more = true;
        queue.push({ x: p.x, y: p.y, dir: sd.dir, color: a.color as Color, d: a.d });
      }
    }
  }
  for (const [k, f] of fused) {
    if (released.has(k)) continue;
    released.add(k);
    queue.push({ x: f.x, y: f.y, dir: f.dir, color: f.color as Color, d: f.d });
    more = true;
  }
  if (!more) break;
  }

  const targets = level.cells.filter((c) => c.t === 'target');
  const solved =
    targets.length > 0 &&
    dark.length === 0 &&
    targets.every((t) => t.t === 'target' && received[key(t.x, t.y)] === t.color);
  return { segments, received, solved, open: [...open], dark };
}
