import { describe, expect, it } from 'vitest';
import { reflect, trace } from './trace.ts';
import type { Cell, Dir, Level } from './types.ts';

const level = (cells: Cell[]): Level => ({ id: 0, w: 6, h: 8, cells });

describe('reflect', () => {
  const table: [Dir, Dir, Dir][] = [
    ['E', 'N', 'S'],
    ['W', 'S', 'N'],
    ['N', 'E', 'W'],
    ['S', 'W', 'E'],
  ];
  it.each(table)('%s -> / %s, \\ %s', (dir, slash, back) => {
    expect(reflect(dir, 0)).toBe(slash);
    expect(reflect(dir, 1)).toBe(back);
  });
});

describe('trace', () => {
  it('mirror / sends east beam north into target', () => {
    const lv = level([
      { x: 0, y: 3, t: 'emitter', dir: 'E', color: 7 },
      { x: 3, y: 3, t: 'mirror' },
      { x: 3, y: 0, t: 'target', color: 7 },
    ]);
    const r = trace(lv, [0]);
    expect(r.solved).toBe(true);
    expect(r.segments).toEqual([
      { x1: 0, y1: 3, x2: 3, y2: 3, color: 7 },
      { x1: 3, y1: 3, x2: 3, y2: 0, color: 7 },
    ]);
  });

  it('mirror \\ sends east beam south out of the grid', () => {
    const lv = level([
      { x: 0, y: 3, t: 'emitter', dir: 'E', color: 7 },
      { x: 3, y: 3, t: 'mirror' },
      { x: 3, y: 0, t: 'target', color: 7 },
    ]);
    const r = trace(lv, [1]);
    expect(r.solved).toBe(false);
    expect(r.segments.at(-1)).toEqual({ x1: 3, y1: 3, x2: 3, y2: 7.5, color: 7 });
  });

  it.each<[Dir, 0 | 1, Dir]>([
    ['N', 0, 'E'],
    ['N', 1, 'W'],
    ['S', 0, 'W'],
    ['S', 1, 'E'],
    ['W', 0, 'S'],
    ['W', 1, 'N'],
  ])('beam going %s hits mirror %i and leaves %s', (dir, rot, out) => {
    const pos: Record<Dir, [number, number]> = { N: [2, 7], S: [2, 0], W: [5, 3], E: [0, 3] };
    const [ex, ey] = pos[dir];
    const mx = dir === 'N' || dir === 'S' ? ex : 2;
    const my = dir === 'N' || dir === 'S' ? 3 : ey;
    const r = trace(level([{ x: ex, y: ey, t: 'emitter', dir, color: 1 }, { x: mx, y: my, t: 'mirror' }]), [rot]);
    const last = r.segments.at(-1)!;
    const dx = Math.sign(last.x2 - last.x1);
    const dy = Math.sign(last.y2 - last.y1);
    const got: Dir = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
    expect(got).toBe(out);
  });

  it('wall absorbs the beam at its edge', () => {
    const r = trace(
      level([
        { x: 0, y: 0, t: 'emitter', dir: 'E', color: 7 },
        { x: 3, y: 0, t: 'wall' },
        { x: 5, y: 0, t: 'target', color: 7 },
      ]),
      [],
    );
    expect(r.solved).toBe(false);
    expect(r.segments).toEqual([{ x1: 0, y1: 0, x2: 2.5, y2: 0, color: 7 }]);
  });

  it('beam leaves the grid', () => {
    const r = trace(level([{ x: 0, y: 0, t: 'emitter', dir: 'S', color: 2 }]), []);
    expect(r.segments).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 7.5, color: 2 }]);
  });

  it('stops after the step limit', () => {
    const r = trace(level([{ x: 0, y: 0, t: 'emitter', dir: 'S', color: 2 }]), [], 3);
    expect(r.segments).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 3, color: 2 }]);
  });

  it('target with wrong color stays unlit', () => {
    const r = trace(
      level([
        { x: 0, y: 0, t: 'emitter', dir: 'E', color: 1 },
        { x: 4, y: 0, t: 'target', color: 2 },
      ]),
      [],
    );
    expect(r.received['4,0']).toBe(1);
    expect(r.solved).toBe(false);
  });

  it('target sums colors with OR (red + green = yellow)', () => {
    const r = trace(
      level([
        { x: 0, y: 2, t: 'emitter', dir: 'E', color: 1 },
        { x: 3, y: 7, t: 'emitter', dir: 'N', color: 2 },
        { x: 3, y: 2, t: 'target', color: 3 },
      ]),
      [],
    );
    expect(r.received['3,2']).toBe(3);
    expect(r.solved).toBe(true);
  });

  it('crossing beams do not interact', () => {
    const r = trace(
      level([
        { x: 0, y: 2, t: 'emitter', dir: 'E', color: 1 },
        { x: 3, y: 7, t: 'emitter', dir: 'N', color: 4 },
        { x: 5, y: 2, t: 'target', color: 1 },
        { x: 3, y: 0, t: 'target', color: 4 },
      ]),
      [],
    );
    expect(r.solved).toBe(true);
  });

  it('prism splits white: red left, green straight, blue right', () => {
    const r = trace(
      level([
        { x: 0, y: 3, t: 'emitter', dir: 'E', color: 7 },
        { x: 2, y: 3, t: 'prism' },
        { x: 2, y: 0, t: 'target', color: 1 },
        { x: 5, y: 3, t: 'target', color: 2 },
        { x: 2, y: 7, t: 'target', color: 4 },
      ]),
      [],
    );
    expect(r.received).toEqual({ '2,0': 1, '5,3': 2, '2,7': 4 });
    expect(r.solved).toBe(true);
  });

  it('prism only emits components present in the beam', () => {
    const r = trace(
      level([
        { x: 0, y: 3, t: 'emitter', dir: 'E', color: 5 },
        { x: 2, y: 3, t: 'prism' },
      ]),
      [],
    );
    expect(r.segments.map((s) => s.color).sort()).toEqual([1, 4, 5]);
  });
});
