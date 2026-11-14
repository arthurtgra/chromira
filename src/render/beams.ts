import type { Cell, Segment } from '../core/types.ts';

// Plano de animação do feixe: cada segmento sabe a que distância da fonte começa (d0)
// e quanto dele já estava aceso antes do toque (known). A frente de luz parte de `from`
// e cresce até `to`; o que deixou de existir vai para `fading`.
export interface BeamPiece extends Segment {
  d0: number;
  len: number;
  known: number;
}

export interface BeamPlan {
  pieces: BeamPiece[];
  fading: Segment[];
  from: number;
  to: number;
}

export const segLen = (s: Segment): number => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
const pkey = (x: number, y: number): string => `${x},${y}`;

// Trecho comum a dois segmentos que saem do mesmo ponto, na mesma direção e com a mesma cor.
function overlap(a: Segment, b: Segment): number {
  if (a.x1 !== b.x1 || a.y1 !== b.y1 || a.color !== b.color) return 0;
  if (Math.sign(a.x2 - a.x1) !== Math.sign(b.x2 - b.x1)) return 0;
  if (Math.sign(a.y2 - a.y1) !== Math.sign(b.y2 - b.y1)) return 0;
  return Math.min(segLen(a), segLen(b));
}

const covered = (s: Segment, others: Segment[]): number => others.reduce((m, o) => Math.max(m, overlap(s, o)), 0);

export function cut(s: Segment, a: number, b: number): Segment {
  const n = segLen(s) || 1;
  const ux = (s.x2 - s.x1) / n;
  const uy = (s.y2 - s.y1) / n;
  return { x1: s.x1 + ux * a, y1: s.y1 + uy * a, x2: s.x1 + ux * b, y2: s.y1 + uy * b, color: s.color };
}

export function planBeams(prev: Segment[], next: Segment[]): BeamPlan {
  const reach = new Map<string, number>();
  let from = Infinity;
  let to = 0;
  const pieces = next.map((s): BeamPiece => {
    const d0 = reach.get(pkey(s.x1, s.y1)) ?? 0;
    const len = segLen(s);
    const known = covered(s, prev);
    const end = pkey(s.x2, s.y2);
    if (!reach.has(end)) reach.set(end, d0 + len);
    if (known < len) from = Math.min(from, d0 + known);
    to = Math.max(to, d0 + len);
    return { ...s, d0, len, known };
  });
  const fading = prev.flatMap((s) => {
    const k = covered(s, next);
    const len = segLen(s);
    return k < len ? [cut(s, k, len)] : [];
  });
  return { pieces, fading, from: Math.min(from, to), to };
}

export const visibleLength = (p: BeamPiece, front: number): number =>
  Math.max(p.known, Math.min(p.len, front - p.d0));

export function visibleSegments(plan: BeamPlan, front: number): Segment[] {
  return plan.pieces.flatMap((p) => {
    const v = visibleLength(p, front);
    return v > 0 ? [cut(p, 0, v)] : [];
  });
}

// O trace corta o feixe na borda da célula do obstáculo (±0.5). Para a luz encostar no obstáculo de verdade,
// estica até a face dele: parede e corpo do lançador são menores que a célula. hit = bateu em algo.
export function extendToObstacles(
  segs: Segment[],
  cells: Cell[],
  half: (c: Cell) => number,
): { segs: Segment[]; hits: boolean[] } {
  const at = new Map(cells.map((c) => [pkey(c.x, c.y), c]));
  const hits: boolean[] = [];
  const out = segs.map((s) => {
    if (Number.isInteger(s.x2) && Number.isInteger(s.y2)) {
      hits.push(false);
      return s;
    }
    const dx = Math.sign(s.x2 - s.x1);
    const dy = Math.sign(s.y2 - s.y1);
    const c = at.get(pkey(s.x2 + dx * 0.5, s.y2 + dy * 0.5));
    hits.push(c !== undefined);
    if (!c) return s;
    const ext = 0.5 - half(c);
    return { ...s, x2: s.x2 + dx * ext, y2: s.y2 + dy * ext };
  });
  return { segs: out, hits };
}

// Trecho aceso até o fim: a frente passou dele ou ele já estava aceso antes do toque.
export const reachedEnd = (p: BeamPiece, front: number): boolean => visibleLength(p, front) >= p.len;

// OR das cores que já chegaram em cada ponto final.
export function arrived(plan: BeamPlan, front: number): Record<string, number> {
  const got: Record<string, number> = {};
  for (const p of plan.pieces) {
    if (!reachedEnd(p, front)) continue;
    const k = pkey(p.x2, p.y2);
    got[k] = (got[k] ?? 0) | p.color;
  }
  return got;
}
