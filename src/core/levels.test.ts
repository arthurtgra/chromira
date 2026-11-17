import { describe, expect, it } from 'vitest';
import levelsJson from '../levels/levels.json';
import { planBeams, segLen } from '../render/beams.ts';
import { solve } from './solver.ts';
import { mulberry32 } from './generate.ts';
import { pieceStates, pieces, startRots, trace } from './trace.ts';
import type { Level, Rots, Segment } from './types.ts';

const levels = levelsJson as unknown as Level[];

// Rastro da luz: todo trecho começa onde a própria luz já chegou — na fonte (d0 = 0, num lançador) ou no fim
// de outro trecho cuja distância acumulada bate exatamente com a dele. Sem isso a animação faz a luz
// "nascer" num espelho antes de chegar nele.
function checkTrail(level: Level, rots: Rots): void {
  const { segments } = trace(level, rots);
  const emitters = new Set(level.cells.filter((c) => c.t === 'emitter').map((c) => `${c.x},${c.y}`));
  for (const s of segments) {
    expect(s.d0).toBeDefined();
    if (s.d0 === 0) {
      expect(emitters.has(`${s.x1},${s.y1}`)).toBe(true);
      continue;
    }
    // Portal: o trecho que sai continua o que entrou no outro portal do par.
    const pair = (x: number, y: number): string | undefined => {
      const c = level.cells.find((q) => q.t === 'portal' && q.x === x && q.y === y);
      const q = c?.t === 'portal' ? level.cells.find((o) => o !== c && o.t === 'portal' && o.pair === c.pair) : undefined;
      return q && `${q.x},${q.y}`;
    };
    const prev = segments.some(
      (p: Segment) =>
        ((p.x2 === s.x1 && p.y2 === s.y1) || pair(p.x2, p.y2) === `${s.x1},${s.y1}`) &&
        Math.abs(p.d0! + segLen(p) - s.d0!) < 1e-9,
    );
    expect(prev, `trecho de ${s.x1},${s.y1} (d0 ${s.d0}) sem origem`).toBe(true);
  }
  // A animação usa a distância do trace.
  const plan = planBeams([], segments);
  plan.pieces.forEach((p, i) => expect(p.d0).toBe(segments[i]!.d0));
}

describe('beam trail in every level', () => {
  it.each(levels.map((l, i) => [i + 1, l] as const))('level %i', (_, level) => {
    const start = startRots(level);
    const states = pieces(level).map(pieceStates);
    const variants: Rots[] = [start];
    const sol = solve(level);
    if (sol) variants.push(sol);
    // Cada peça girada/movida uma vez a partir do início, e alguns estados aleatórios.
    states.forEach((n, i) => {
      for (let v = 1; v < n; v++) variants.push(start.map((s, j) => (j === i ? (s + v) % n : s)));
    });
    const r = mulberry32(level.id);
    for (let k = 0; k < 20; k++) variants.push(states.map((n) => Math.floor(r() * n)));
    for (const rots of variants) checkTrail(level, rots);
  });
});
