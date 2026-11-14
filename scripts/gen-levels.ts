// Gera src/levels/levels.json: 10 fases feitas à mão + 20 geradas (3 a 10 espelhos).
import { readFileSync, writeFileSync } from 'node:fs';
import { generate } from '../src/core/generate.ts';
import type { Level } from '../src/core/types.ts';

const GENERATED = 20;
const SEED_BASE = 7000;

const dir = new URL('../src/levels/', import.meta.url);
const handmade = JSON.parse(readFileSync(new URL('handmade.json', dir), 'utf8')) as Level[];
const levels: Level[] = [...handmade];
for (let i = 0; i < GENERATED; i++) {
  const mirrors = Math.round(3 + (i * 7) / (GENERATED - 1));
  const id = handmade.length + i + 1;
  levels.push(generate(SEED_BASE + i, mirrors, id));
  process.stdout.write(`fase ${id}: ${mirrors} espelhos\n`);
}
writeFileSync(new URL('levels.json', dir), JSON.stringify(levels) + '\n');
process.stdout.write(`${levels.length} fases escritas em src/levels/levels.json\n`);
