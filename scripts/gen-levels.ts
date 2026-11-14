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
  // 41+: trilho — um espelho ou o prisma desliza de célula em célula; a luz acompanha enquanto arrasta.
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
  // 61+: espelho dicroico — reflete só a sua cor e deixa as outras passarem (separa um feixe misturado).
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
  // 71+: alvos de cor combinada — só acendem quando feixes de lançadores diferentes chegam juntos.
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
  // 81+: tudo junto — divisor, espelho, filtro e prisma na mesma fase (um feixe para cada peça especial).
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
];

// Pontuação → 1..5 marcadores no topo da tela.
const THRESHOLDS = [4.5, 8, 12, 16];
const pips = (score: number): number => 1 + THRESHOLDS.filter((t) => score >= t).length;

const dir = new URL('../src/levels/', import.meta.url);
const handmade = JSON.parse(readFileSync(new URL('handmade.json', dir), 'utf8')) as Level[];
// Fases geradas aprovadas no playtest: ficam iguais e entram na sua faixa, ordenadas junto com as novas.
const kept = JSON.parse(readFileSync(new URL('kept.json', dir), 'utf8')) as { tier: number; level: Level }[];
const levels: Level[] = [...handmade];
type Scored = { level: Level; score: number; tier: number };
const tiers: Scored[][] = TIERS.map((tier, t) => {
  const batch: Scored[] = kept.filter((k) => k.tier === t).map(({ level }) => ({ level, score: difficultyScore(level), tier: t }));
  for (let i = 0; i < tier.count; i++) {
    const level = generate(tier.seed + i, tier.options(tier.count === 1 ? 0 : i / (tier.count - 1)));
    batch.push({ level, score: difficultyScore(level), tier: t });
  }
  return batch.sort((a, b) => a.score - b.score);
});

// Ordem: cada mecânica nova entra com suas INTRO fases mais fáceis (o jogador vê a novidade num bloco).
// Entre uma introdução e a próxima vão as demais fases já liberadas, em ordem de dificuldade, até a nota
// da próxima introdução; o que sobra no fim entra em ordem crescente. Assim a dificuldade sobe de forma
// contínua sem que uma faixa inteira fácil caia depois de outra difícil.
const INTRO = 2;
const pool: Scored[] = [];
const emit = (x: Scored, tag: string): void => {
  levels.push(x.level);
  process.stdout.write(`fase ${levels.length}: faixa ${x.tier + 1} nota ${x.score.toFixed(1)}${tag}
`);
};
// Mecânicas na ordem da dificuldade média das suas fases (índices de TIERS): misturas, trilho, dicroico,
// filtro+prisma, divisor, prismas com 3 feixes, alvos combinados, tudo junto.
const FEATURE_ORDER = [0, 3, 5, 1, 6, 2, 4, 7];
for (const [n, t] of FEATURE_ORDER.entries()) {
  const batch = tiers[t]!;
  batch.slice(0, INTRO).forEach((x, i) => emit(x, i === 0 ? '  <- nova mecânica' : ''));
  pool.push(...batch.slice(INTRO));
  pool.sort((a, b) => a.score - b.score);
  const nt = FEATURE_ORDER[n + 1];
  const next = nt === undefined ? Infinity : tiers[nt]!.slice(0, INTRO).reduce((m, x) => Math.max(m, x.score), 0);
  while (pool.length > 0 && pool[0]!.score <= next) emit(pool.shift()!, '');
}
for (const [i, level] of levels.entries()) {
  level.id = i + 1;
  level.difficulty = pips(difficultyScore(level));
}
writeFileSync(new URL('levels.json', dir), JSON.stringify(levels) + '\n');
process.stdout.write(`${levels.length} fases; marcadores: ${levels.map((l) => l.difficulty).join('')}\n`);
