import { describe, expect, it } from 'vitest';
import { generate, type GenOptions } from './generate.ts';
import { countSolutions, difficultyScore, searchSpace, solve } from './solver.ts';
import { mirrorCount, startRots, trace } from './trace.ts';
import type { Level } from './types.ts';

const simple: Level = {
  id: 1,
  w: 7,
  h: 9,
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

  it('handles filters with 3 states', () => {
    const lv: Level = {
      id: 2,
      w: 7,
      h: 9,
      cells: [
        { x: 0, y: 3, t: 'emitter', dir: 'E', color: 7 },
        { x: 1, y: 3, t: 'filter' },
        { x: 3, y: 3, t: 'mirror' },
        { x: 3, y: 0, t: 'target', color: 4 },
      ],
    };
    expect(searchSpace(lv)).toBe(6);
    expect(solve(lv)).toEqual([2, 0]);
  });

  it('scores harder levels higher', () => {
    expect(difficultyScore(generate(5, { mirrors: 8, filters: 1 }))).toBeGreaterThan(
      difficultyScore({ ...simple, start: [1] }),
    );
  });
});

describe('generate', () => {
  it.each<GenOptions>([
    { mirrors: 3 },
    { mirrors: 5 },
    { mirrors: 8 },
    { mirrors: 10 },
    { mirrors: 4, filters: 1 },
    { mirrors: 5, prism: true },
    { mirrors: 7, prism: true, filters: 1, beams: 2 },
  ])('builds a valid level with %o', (o) => {
    const lv = generate(1000 + o.mirrors, o);
    expect(mirrorCount(lv)).toBe(o.mirrors);
    expect(lv.cells.filter((c) => c.t === 'filter')).toHaveLength(o.filters ?? 0);
    expect(lv.cells.some((c) => c.t === 'prism')).toBe(o.prism === true);
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
