import { pieceStates, pieces, trace } from './trace.ts';
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

export function solve(level: Level): Rots | null {
  return countSolutions(level, 1).first;
}

// Nota de dificuldade: toques necessários, tamanho da busca, alvos e peças especiais.
export function difficultyScore(level: Level): number {
  const sol = solve(level);
  if (!sol) return Infinity;
  const start = level.start ?? sol.map(() => 0);
  const moves = start.filter((v, i) => v !== sol[i]).length;
  const count = (t: string): number => level.cells.filter((c) => c.t === t).length;
  return moves + 0.6 * Math.log2(searchSpace(level)) + 0.5 * count('target') + 1.2 * count('filter') + count('prism') + 1.3 * count('splitter');
}
