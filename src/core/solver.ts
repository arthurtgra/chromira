import { isPiece, key, pieceStates, pieces, placeCells, trace } from './trace.ts';
import type { Level, Rots } from './types.ts';

export const MAX_SPACE = 1 << 16;

export function searchSpace(level: Level): number {
  return pieces(level).reduce((a, c) => a * pieceStates(c), 1);
}

export function countSolutions(level: Level, limit: number = Infinity): { count: number; first: Rots | null } {
  const radix = pieces(level).map(pieceStates);
  const space = searchSpace(level);
  if (space > MAX_SPACE) throw new Error(`solver: ${space} combinações é demais para força bruta`);
  let count = 0;
  let first: Rots | null = null;
  const rots: Rots = radix.map(() => 0);
  for (let n = 0; n < space && count < limit; n++) {
    if (trace(level, rots).solved) {
      count++;
      first ??= [...rots];
    }
    for (let i = 0; i < rots.length; i++) {
      rots[i]! += 1;
      if (rots[i]! < radix[i]!) break;
      rots[i] = 0;
    }
  }
  return { count, first };
}

// Células por onde a luz passa (pontas incluídas). Peça fora delas não muda nada na solução.
export function litCells(level: Level, rots: Rots): Set<string> {
  const lit = new Set<string>();
  for (const s of trace(level, rots).segments) {
    const len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    const ux = len ? (s.x2 - s.x1) / len : 0;
    const uy = len ? (s.y2 - s.y1) / len : 0;
    for (let t = 0; t <= len + 1e-9; t++) {
      const x = s.x1 + ux * t;
      const y = s.y1 + uy * t;
      if (Number.isInteger(x) && Number.isInteger(y)) lit.add(key(x, y));
    }
  }
  return lit;
}

// Solução sem as peças apagadas (distratoras): o estado delas não conta.
export function essentialKey(level: Level, rots: Rots): string {
  const lit = litCells(level, rots);
  const placed = placeCells(level, rots).filter(isPiece);
  return rots.map((v, i) => (lit.has(key(placed[i]!.x, placed[i]!.y)) ? v : '*')).join(',');
}

// Soluções diferentes de verdade: duas que só mudam peças distratoras (fora da luz) contam como uma.
export function countEssential(level: Level, limit: number = Infinity): number {
  const keys = new Set<string>();
  const radix = pieces(level).map(pieceStates);
  const space = searchSpace(level);
  if (space > MAX_SPACE) throw new Error(`solver: ${space} combinações é demais para força bruta`);
  const rots: Rots = radix.map(() => 0);
  for (let n = 0; n < space && keys.size < limit; n++) {
    if (trace(level, rots).solved) keys.add(essentialKey(level, rots));
    for (let i = 0; i < rots.length; i++) {
      rots[i]! += 1;
      if (rots[i]! < radix[i]!) break;
      rots[i] = 0;
    }
  }
  return keys.size;
}

export function solve(level: Level): Rots | null {
  return countSolutions(level, 1).first;
}

// Nota de dificuldade: toques necessários, tamanho da busca, alvos e peças especiais.
export function difficultyScore(level: Level): number {
  const sol = solve(level);
  if (!sol) return Infinity;
  const start = level.start ?? sol.map(() => 0);
  // Só conta peças acesas na solução: girar uma distratora não é um toque necessário.
  const need = essentialKey(level, sol).split(',');
  const moves = start.filter((v, i) => need[i] !== '*' && v !== sol[i]).length;
  const count = (t: string): number => level.cells.filter((c) => c.t === t).length;
  return moves + 0.6 * Math.log2(searchSpace(level)) + 0.5 * count('target') + 1.2 * count('filter') + count('prism') + 1.3 * count('splitter') + 1.3 * count('dichroic');
}
