// Falha se alguma fase não tiver solução ou já começar resolvida.
import { readFileSync } from 'node:fs';
import { countSolutions } from '../src/core/solver.ts';
import { startRots, trace } from '../src/core/trace.ts';
import type { Level } from '../src/core/types.ts';

const levels = JSON.parse(readFileSync(new URL('../src/levels/levels.json', import.meta.url), 'utf8')) as Level[];
// Fases editadas no jogo (editor do modo desenvolvedor) substituem a gerada na mesma posição.
const edits = JSON.parse(readFileSync(new URL('../src/levels/edits.json', import.meta.url), 'utf8')) as Record<string, Level>;
for (const [k, lv] of Object.entries(edits)) if (levels[Number(k) - 1]) levels[Number(k) - 1] = lv;
let bad = 0;
for (const [i, lv] of levels.entries()) {
  const { count, first } = countSolutions(lv);
  const start = startRots(lv);
  const startSolved = trace(lv, start).solved;
  const moves = first ? start.filter((v, j) => v !== first[j]).length : '-';
  const ok = count > 0 && !startSolved;
  if (!ok) bad++;
  process.stdout.write(
    `${ok ? 'ok  ' : 'FAIL'} fase ${i + 1} (id ${lv.id}): ${count} solução(ões), ${moves} toque(s)${startSolved ? ', começa resolvida' : ''}\n`,
  );
}
if (bad > 0) {
  process.stderr.write(`${bad} fase(s) inválida(s)\n`);
  process.exit(1);
}
