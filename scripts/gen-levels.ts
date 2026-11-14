// Gera src/levels/levels.json: fases feitas à mão + faixas geradas, cada faixa ordenada por dificuldade.
import { readFileSync, writeFileSync } from 'node:fs';
import { generate, type GenOptions } from '../src/core/generate.ts';
import { difficultyScore } from '../src/core/solver.ts';
import type { Level } from '../src/core/types.ts';

interface Tier {
  count: number;
  options: (k: number) => GenOptions; // k = 0..1 dentro da faixa
}

const lerp = (a: number, b: number, k: number): number => Math.round(a + (b - a) * k);

const TIERS: Tier[] = [
  { count: 10, options: (k) => ({ mirrors: lerp(3, 7, k), minMoves: lerp(3, 5, k) }) },
  { count: 9, options: (k) => ({ mirrors: lerp(4, 7, k), filters: 1, prism: k > 0.3, beams: 2, minMoves: 4 }) },
  {
    count: 8,
    options: (k) => ({ mirrors: lerp(6, 9, k), filters: k > 0.5 ? 2 : 1, prism: true, beams: 3, minMoves: lerp(5, 7, k) }),
  },
];
const SEED_BASE = 9100;

// Pontuação → 1..5 marcadores no topo da tela.
const THRESHOLDS = [4.5, 8, 12, 16];
const pips = (score: number): number => 1 + THRESHOLDS.filter((t) => score >= t).length;

const dir = new URL('../src/levels/', import.meta.url);
const handmade = JSON.parse(readFileSync(new URL('handmade.json', dir), 'utf8')) as Level[];
const levels: Level[] = [...handmade];
let seed = SEED_BASE;
for (const [t, tier] of TIERS.entries()) {
  const batch: { level: Level; score: number }[] = [];
  for (let i = 0; i < tier.count; i++) {
    const level = generate(seed++, tier.options(tier.count === 1 ? 0 : i / (tier.count - 1)));
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
