// Gera src/levels/levels.json: fases feitas à mão + faixas geradas, cada faixa ordenada por dificuldade.
import { readFileSync, writeFileSync } from 'node:fs';
import { generate, type GenOptions } from '../src/core/generate.ts';
import { difficultyScore } from '../src/core/solver.ts';
import type { Level } from '../src/core/types.ts';

interface Tier {
  count: number; // fases novas geradas (as mantidas de kept.json entram a mais)
  seed: number; // seed própria: mexer numa faixa não muda as outras
  options: (k: number) => GenOptions; // k = 0..1 dentro da faixa
}

const lerp = (a: number, b: number, k: number): number => Math.round(a + (b - a) * k);

const TIERS: Tier[] = [
  // Playtest: fases de um feixe só foram fracas; agora dois feixes, mais espelhos e metade com alvo misturado.
  {
    count: 11,
    seed: 20000,
    options: (k) =>
      k > 0.45
        ? { mirrors: lerp(5, 7, k), beams: 1, merge: 1, mergeMirrors: 3, minMoves: lerp(5, 7, k) }
        : { mirrors: lerp(5, 7, k), beams: 2, minMoves: lerp(5, 6, k) },
  },
  {
    count: 8,
    seed: 20100,
    options: (k) => ({ mirrors: lerp(6, 9, k), filters: 1, prism: k > 0.3, beams: 2, minMoves: lerp(5, 7, k) }),
  },
  {
    count: 8,
    seed: 9119,
    options: (k) => ({ mirrors: lerp(6, 9, k), filters: k > 0.5 ? 2 : 1, prism: true, beams: 3, minMoves: lerp(5, 7, k) }),
  },
  // 41+: alvos de cor combinada — só acendem quando feixes de lançadores diferentes chegam juntos.
  {
    count: 10,
    seed: 9127,
    options: (k) => ({
      mirrors: lerp(5, 7, k),
      beams: 2,
      merge: k > 0.4 ? 2 : 1,
      mergeMirrors: k > 0.4 ? 2 : 3,
      filters: 1,
      minMoves: lerp(6, 8, k),
    }),
  },
  // 51+: divisor de feixe — reflete e deixa passar ao mesmo tempo; um feixe abastece dois caminhos.
  {
    count: 10,
    seed: 9137,
    options: (k) => ({
      mirrors: lerp(6, 8, k),
      beams: 2,
      splitters: k > 0.4 ? 2 : 1,
      merge: 1,
      mergeMirrors: 2,
      minMoves: lerp(6, 8, k),
    }),
  },
  // 61+: tudo junto — divisor, espelho, filtro e prisma na mesma fase (um feixe para cada peça especial).
  {
    count: 10,
    seed: 9147,
    options: (k) => ({
      mirrors: lerp(6, 7, k),
      beams: 3,
      prism: true,
      filters: 1,
      splitters: 1,
      minMoves: lerp(7, 9, k),
    }),
  },
  // 71+: trilho — um espelho ou o prisma desliza de célula em célula; a luz acompanha enquanto arrasta.
  {
    count: 10,
    seed: 20200,
    options: (k) => {
      const prism = Math.round(k * 9) % 2 === 1;
      return {
        mirrors: lerp(4, 7, k),
        beams: 2,
        prism,
        slider: prism ? ('prism' as const) : ('mirror' as const),
        minMoves: lerp(3, 6, k),
      };
    },
  },
  // 81+: espelho dicroico — reflete só a sua cor e deixa as outras passarem (separa um feixe misturado).
  {
    count: 10,
    seed: 20300,
    options: (k) => ({
      mirrors: lerp(5, 8, k),
      beams: 2,
      dichroics: k > 0.5 ? 2 : 1,
      minMoves: lerp(4, 7, k),
    }),
  },
];

// Pontuação → 1..5 marcadores no topo da tela.
const THRESHOLDS = [4.5, 8, 12, 16];
const pips = (score: number): number => 1 + THRESHOLDS.filter((t) => score >= t).length;

const dir = new URL('../src/levels/', import.meta.url);
const handmade = JSON.parse(readFileSync(new URL('handmade.json', dir), 'utf8')) as Level[];
// Fases geradas aprovadas no playtest: ficam iguais e entram na sua faixa, ordenadas junto com as novas.
const kept = JSON.parse(readFileSync(new URL('kept.json', dir), 'utf8')) as { tier: number; level: Level }[];
const levels: Level[] = [...handmade];
for (const [t, tier] of TIERS.entries()) {
  const batch = kept.filter((k) => k.tier === t).map(({ level }) => ({ level, score: difficultyScore(level) }));
  for (let i = 0; i < tier.count; i++) {
    const level = generate(tier.seed + i, tier.options(tier.count === 1 ? 0 : i / (tier.count - 1)));
    batch.push({ level, score: difficultyScore(level) });
  }
  batch.sort((a, b) => a.score - b.score);
  for (const { level, score } of batch) {
    levels.push(level);
    process.stdout.write(`faixa ${t + 1} fase ${levels.length}: nota ${score.toFixed(1)}\n`);
  }
}
for (const [i, level] of levels.entries()) {
  level.id = i + 1;
  level.difficulty = pips(difficultyScore(level));
}
writeFileSync(new URL('levels.json', dir), JSON.stringify(levels) + '\n');
process.stdout.write(`${levels.length} fases; marcadores: ${levels.map((l) => l.difficulty).join('')}\n`);
