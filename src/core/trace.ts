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
  const prismIn = new Map<string, { x: number; y: number; by: Map<Dir, { color: number; d: number }> }>();
  const prismOut = new Map<string, number>(); // "x,y,dir" (ou "x,y,white") -> cor já solta

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
          const a = p.by.get(dir) ?? { color: 0, d: 0 };
          a.color |= color;
          a.d = Math.max(a.d, dist);
          p.by.set(dir, a);
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
    const sides = [...p.by];
    const all = sides.reduce((m, [, a]) => m | a.color, 0);
    // Três cores entrando por três lados (nenhum já branco): saem juntas, brancas, pelo lado livre.
    if (sides.length === 3 && all === 7 && sides.every(([, a]) => a.color !== 7)) {
      const out = COMBINER_DIRS.find((side) => !sides.some(([d]) => OPP[d] === side))!;
      prismOut.set(`${k},white`, 7);
      queue.push({ x: p.x, y: p.y, dir: out, color: 7, d: Math.max(...sides.map(([, a]) => a.d)) });
      more = true;
      continue;
    }
    for (const [dir, a] of sides) {
      const ok = `${k},${dir}`;
      if (prismOut.get(ok) === a.color) continue;
      prismOut.set(ok, a.color);
      more = true;
      // Só a luz branca se abre nas três cores; luz colorida atravessa reto, sem mudar.
      if (a.color !== 7) {
        queue.push({ x: p.x, y: p.y, dir, color: a.color as Color, d: a.d });
        continue;
      }
      queue.push({ x: p.x, y: p.y, dir: LEFT[dir], color: 1, d: a.d });
      queue.push({ x: p.x, y: p.y, dir, color: 2, d: a.d });
      queue.push({ x: p.x, y: p.y, dir: RIGHT[dir], color: 4, d: a.d });
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
  const stops = new Set(level.cells.filter((c) => c.t === 'prism').map((c) => key(c.x, c.y)));
  for (const c of placeCells(level, rots)) if (c.t === 'prism') stops.add(key(c.x, c.y));
  const jumps = new Map<string, string>();
  for (const g of [...portals.values(), ...fibers.values()]) {
    const [a, b] = g;
    if (a && b) {
      jumps.set(key(a.x, a.y), key(b.x, b.y));
      jumps.set(key(b.x, b.y), key(a.x, a.y));
    }
  }
  return { segments: mergeSegments(segments, stops, jumps), received, solved, open: [...open], dark };
}

// Luzes que andam pelo mesmo caminho, no mesmo sentido, viram uma luz só com as cores somadas: os trechos
// são quebrados em passos de uma célula, somados por passo e emendados de novo onde a cor continua igual.
// Prismas (stops) sempre quebram o trecho, para o desenho saber que a luz chega neles.
export function mergeSegments(
  segments: Segment[],
  stops: Set<string> = new Set(),
  jumps: Map<string, string> = new Map(), // portal/fibra: célula de saída -> célula de entrada do par
): Segment[] {
  interface Step { x: number; y: number; dir: Dir; len: number; color: number; d: number }
  const steps = new Map<string, Step>();
  const dirOf = (dx: number, dy: number): Dir => (dx > 0 ? 'E' : dx < 0 ? 'W' : dy > 0 ? 'S' : 'N');
  const lenOf = (sg: Segment): number => Math.abs(sg.x2 - sg.x1) + Math.abs(sg.y2 - sg.y1);
  const own: Step[][] = []; // passos (já somados) de cada trecho original
  for (const sg of segments) {
    const len = lenOf(sg);
    const dir = dirOf(sg.x2 - sg.x1, sg.y2 - sg.y1);
    const [dx, dy] = DELTA[dir];
    const list: Step[] = [];
    for (let t = 0; t < len; t++) {
      const x = sg.x1 + dx * t;
      const y = sg.y1 + dy * t;
      const sl = Math.min(1, len - t);
      const k = `${x},${y},${dir},${sl}`;
      const d = (sg.d0 ?? 0) + t;
      let st = steps.get(k);
      if (st) {
        st.color |= sg.color;
        st.d = Math.min(st.d, d);
      } else steps.set(k, (st = { x, y, dir, len: sl, color: sg.color, d }));
      list.push(st);
    }
    own.push(list);
  }
  // De onde vem cada passo, pelo caminho da própria luz: o passo anterior do mesmo trecho, ou o último
  // passo do trecho que terminou onde este começa (ou no outro portal do par) na mesma distância.
  const prev = new Map<Step, Set<Step>>();
  const succ = new Map<Step, Set<Step>>();
  const link = (from: Step, to: Step): void => {
    if (from === to) return;
    prev.set(to, (prev.get(to) ?? new Set()).add(from));
    succ.set(from, (succ.get(from) ?? new Set()).add(to));
  };
  const endAt = new Map<string, number[]>();
  segments.forEach((sg, i) => {
    const k = key(sg.x2, sg.y2);
    endAt.set(k, [...(endAt.get(k) ?? []), i]);
  });
  segments.forEach((sg, i) => {
    const list = own[i]!;
    for (let t = 1; t < list.length; t++) link(list[t - 1]!, list[t]!);
    if (list.length === 0) return;
    const k = key(sg.x1, sg.y1);
    const j = jumps.get(k);
    for (const pi of [...(endAt.get(k) ?? []), ...(j ? (endAt.get(j) ?? []) : [])]) {
      const p = segments[pi]!;
      if (Math.abs((p.d0 ?? 0) + lenOf(p) - (sg.d0 ?? 0)) < 1e-9 && own[pi]!.length > 0) link(own[pi]!.at(-1)!, list[0]!);
    }
  });
  // Somados, a distância de cada passo volta a ser contínua com o passo de onde ele vem (a mais curta).
  for (let it = 0, changed = true; changed && it < 500; it++) {
    changed = false;
    for (const [st, ps] of prev) {
      const m = Math.min(...[...ps].map((q) => q.d + q.len));
      if (m < st.d) {
        st.d = m;
        changed = true;
      }
    }
  }
  const next = (st: Step): Step | undefined => {
    const [dx, dy] = DELTA[st.dir];
    const x = st.x + dx;
    const y = st.y + dy;
    // Onde a luz se divide (parte segue, parte desvia), o trecho acaba: o ramo precisa de um fim para começar.
    if (st.len !== 1 || stops.has(key(x, y)) || (succ.get(st)?.size ?? 0) > 1) return undefined;
    for (const len of [1, 0.5]) {
      const n = steps.get(`${x},${y},${st.dir},${len}`);
      if (n && n.color === st.color && n.d === st.d + 1 && prev.get(n)?.has(st)) return n;
    }
    return undefined;
  };
  const hasPrev = new Set<Step>();
  for (const st of steps.values()) {
    const n = next(st);
    if (n) hasPrev.add(n);
  }
  const out: Segment[] = [];
  const done = new Set<Step>();
  const chain = (st: Step): void => {
    let end: Step = st;
    done.add(st);
    for (let n = next(end); n && !done.has(n); n = next(end)) {
      done.add(n);
      end = n;
    }
    const [dx, dy] = DELTA[st.dir];
    out.push({ x1: st.x, y1: st.y, x2: end.x + dx * end.len, y2: end.y + dy * end.len, color: st.color as Color, d0: st.d });
  };
  for (const st of steps.values()) if (!hasPrev.has(st)) chain(st);
  for (const st of steps.values()) if (!done.has(st)) chain(st); // voltas fechadas
  return out.sort((a, b) => (a.d0 ?? 0) - (b.d0 ?? 0));
}
