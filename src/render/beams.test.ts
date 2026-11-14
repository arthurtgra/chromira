import { describe, expect, it } from 'vitest';
import type { Segment } from '../core/types.ts';
import { arrived, planBeams, visibleSegments } from './beams.ts';

const a: Segment = { x1: 0, y1: 0, x2: 3, y2: 0, color: 7 };
const up: Segment = { x1: 3, y1: 0, x2: 3, y2: -0.5, color: 7 };
const down: Segment = { x1: 3, y1: 0, x2: 3, y2: 7.5, color: 7 };

describe('planBeams', () => {
  it('cresce tudo a partir da fonte quando não havia feixe', () => {
    const p = planBeams([], [a, down]);
    expect(p.from).toBe(0);
    expect(p.to).toBe(10.5);
    expect(p.pieces[1]!.d0).toBe(3);
  });

  it('mantém o trecho comum e só cresce depois do espelho', () => {
    const p = planBeams([a, up], [a, down]);
    expect(p.pieces[0]!.known).toBe(3);
    expect(p.from).toBe(3);
    expect(p.fading).toEqual([up]);
  });

  it('não anima nada quando o feixe não mudou', () => {
    const p = planBeams([a, down], [a, down]);
    expect(p.from).toBe(p.to);
    expect(p.fading).toEqual([]);
  });

  it('segmento encurtado some só na parte que sobrou', () => {
    const short: Segment = { x1: 0, y1: 0, x2: 2, y2: 0, color: 7 };
    const p = planBeams([a], [short]);
    expect(p.fading).toEqual([{ x1: 2, y1: 0, x2: 3, y2: 0, color: 7 }]);
  });

  it('frente de luz revela por distância', () => {
    const p = planBeams([], [a, down]);
    expect(visibleSegments(p, 4)).toEqual([a, { x1: 3, y1: 0, x2: 3, y2: 1, color: 7 }]);
  });

  it('trecho que já estava aceso conta como chegado mesmo com a frente atrás dele', () => {
    // Segundo feixe intacto, mas o primeiro mudou: a frente recomeça antes dele.
    const b: Segment = { x1: 5, y1: 5, x2: 5, y2: 2, color: 2 };
    const p = planBeams([a, b], [{ ...a, x2: 1 }, { x1: 1, y1: 0, x2: 1, y2: 4, color: 7 }, b]);
    expect(p.from).toBe(1);
    expect(arrived(p, p.from)['5,2']).toBe(2);
  });
});
