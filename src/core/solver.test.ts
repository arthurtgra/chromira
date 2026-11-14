import { describe, expect, it } from 'vitest';
import { generate } from './generate.ts';
import { countSolutions, solve } from './solver.ts';
import { mirrorCount, startRots, trace } from './trace.ts';
import type { Level } from './types.ts';

const simple: Level = {
  id: 1,
  w: 6,
  h: 8,
  cells: [
    { x: 0, y: 3, t: 'emitter', dir: 'E', color: 7 },
    { x: 3, y: 3, t: 'mirror' },
    { x: 3, y: 0, t: 'target', color: 7 },
  ],
};

describe('solver', () => {
  it('finds the solution', () => {
    expect(solve(simple)).toEqual([0]);
  });

  it('returns null when unsolvable', () => {
    expect(solve({ ...simple, cells: [...simple.cells, { x: 3, y: 1, t: 'wall' }] })).toBeNull();
  });

  it('counts solutions', () => {
    expect(countSolutions(simple).count).toBe(1);
  });
});

describe('generate', () => {
  it.each([3, 5, 8, 10])('builds a valid level with %i mirrors', (n) => {
    const lv = generate(1000 + n, n);
    expect(mirrorCount(lv)).toBe(n);
    expect(countSolutions(lv, 2).count).toBe(1);
    const sol = solve(lv)!;
    const start = startRots(lv);
    expect(trace(lv, start).solved).toBe(false);
    expect(start.filter((v, i) => v !== sol[i]).length).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic for a seed', () => {
    expect(generate(42, 4)).toEqual(generate(42, 4));
  });
});
