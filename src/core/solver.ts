import { mirrorCount, trace } from './trace.ts';
import type { Level, Rots } from './types.ts';

const MAX_MIRRORS = 16;

function rotsFromMask(mask: number, n: number): Rots {
  const rots: Rots = [];
  for (let i = 0; i < n; i++) rots.push(((mask >> i) & 1) as 0 | 1);
  return rots;
}

export function countSolutions(level: Level, limit: number = Infinity): { count: number; first: Rots | null } {
  const n = mirrorCount(level);
  if (n > MAX_MIRRORS) throw new Error(`solver: ${n} espelhos é demais para força bruta`);
  let count = 0;
  let first: Rots | null = null;
  for (let mask = 0; mask < 1 << n && count < limit; mask++) {
    const rots = rotsFromMask(mask, n);
    if (trace(level, rots).solved) {
      count++;
      first ??= rots;
    }
  }
  return { count, first };
}

export function solve(level: Level): Rots | null {
  return countSolutions(level, 1).first;
}
