// Gera src/levels/levels.json: fases feitas à mão + faixas geradas, cada faixa ordenada por dificuldade.
import { readFileSync, writeFileSync } from 'node:fs';
import { generate, type GenOptions } from '../src/core/generate.ts';
import { difficultyScore } from '../src/core/solver.ts';
import type { Level } from '../src/core/types.ts';

interface Tier {
  count: number; // fases novas geradas (as mantidas de kept.json entram a mais)
  seed: number; // seed própria: mexer numa faixa não muda as outras
  finale?: boolean; // fica no fim do jogo, fora da ordenação global
  epilogue?: boolean; // depois do final, uma fase por faixa, na ordem das faixas (mecânicas novas)
  options: (k: number) => GenOptions; // k = 0..1 dentro da faixa
}

const lerp = (a: number, b: number, k: number): number => Math.round(a + (b - a) * k);

// Playtest 2026-11-16 (fases 1–50): as curtidas ficaram em kept.json; as outras eram simples demais. Todas
// as faixas ganharam mais peças especiais e distratoras (decoys: peças fora da luz, perto do caminho).
const TIERS: Tier[] = [
  // Mistura de dois feixes; metade com alvo de cor combinada.
  {
    count: 6,
    seed: 30000,
    options: (k) => ({
      mirrors: lerp(6, 8, k),
      beams: 2,
      merge: k > 0.3 ? 1 : 0,
      mergeMirrors: 2,
      decoys: k > 0.5 ? 2 : 1,
      minMoves: lerp(5, 7, k),
    }),
  },
  // Filtro + prisma, às vezes com divisor.
  {
    count: 8,
    seed: 30100,
    options: (k) => ({
      mirrors: lerp(7, 9, k),
      filters: 1,
      prism: true,
      beams: k > 0.5 ? 3 : 2,
      splitters: k > 0.5 ? 1 : 0,
      decoys: k > 0.5 ? 2 : 1,
      minMoves: lerp(6, 8, k),
    }),
  },
  // Dois prismas (dois feixes brancos) e um terceiro feixe com filtro.
  {
    count: 8,
    seed: 30200,
    options: (k) => ({ mirrors: lerp(7, 9, k), prisms: 2, filters: 1, beams: 3, decoys: k > 0.5 ? 2 : 1, minMoves: lerp(6, 8, k) }),
  },
  // Trilho, com divisor ou dicroico.
  {
    count: 6,
    seed: 30300,
    options: (k) => {
      const i = Math.round(k * 5);
      const prism = i % 2 === 1;
      return {
        mirrors: lerp(6, 8, k),
        beams: 2,
        prism,
        slider: prism ? ('prism' as const) : ('mirror' as const),
        splitters: i % 3 === 0 ? 1 : 0,
        dichroics: i % 3 === 0 ? 0 : 1,
        decoys: 1,
        minMoves: lerp(5, 7, k),
      };
    },
  },
  // Alvos combinados + filtro, depois com dicroico.
  {
    count: 8,
    seed: 30400,
    options: (k) => ({
      mirrors: lerp(6, 8, k),
      beams: 2,
      merge: k > 0.4 ? 2 : 1,
      mergeMirrors: 2,
      filters: 1,
      dichroics: k > 0.5 ? 1 : 0,
      decoys: k > 0.5 ? 2 : 1,
      minMoves: lerp(6, 8, k),
    }),
  },
  // Dicroico (o espelho com filtro): um ou dois, com filtro.
  {
    count: 6,
    seed: 30500,
    options: (k) => ({
      mirrors: lerp(6, 8, k),
      beams: k > 0.4 ? 3 : 2,
      dichroics: k > 0.4 ? 2 : 1,
      filters: 1,
      decoys: 1,
      minMoves: lerp(5, 7, k),
    }),
  },
  // Divisor + prisma + alvo combinado.
  {
    count: 8,
    seed: 30600,
    options: (k) => ({
      mirrors: lerp(7, 8, k),
      beams: k > 0.5 ? 3 : 2,
      prism: true,
      splitters: k > 0.5 ? 2 : 1,
      merge: 1,
      mergeMirrors: 2,
      decoys: k > 0.5 ? 2 : 1,
      minMoves: lerp(6, 8, k),
    }),
  },
  // Tudo junto: prisma, filtro e divisor ou dicroico (cada peça especial no seu feixe).
  {
    count: 8,
    seed: 30700,
    options: (k) => {
      const i = Math.round(k * 7);
      return {
        mirrors: lerp(7, 8, k),
        beams: 3,
        prism: true,
        filters: 1,
        splitters: i % 2,
        dichroics: 1 - (i % 2),
        decoys: 2,
        minMoves: lerp(7, 9, k),
      };
    },
  },
  // 91–100: final — dois prismas, alvo combinado, trilho, divisor ou dicroico e distratoras.
  {
    count: 10,
    seed: 30800,
    finale: true,
    options: (k) => {
      const i = Math.round(k * 9);
      return {
        mirrors: lerp(7, 9, k),
        beams: 3,
        prisms: i % 2 === 0 ? 2 : 1,
        filters: i % 2 === 0 ? 0 : 1,
        merge: i % 2 === 0 ? 0 : 1, // dois prismas já enchem a grade: sem alvo combinado
        mergeMirrors: 2,
        splitters: i % 2 === 0 ? 0 : 1,
        dichroics: i % 2 === 1 ? 0 : 1,
        slider: i % 3 === 0 ? ('prism' as const) : ('mirror' as const),
        decoys: 2,
        minMoves: lerp(9, 11, k),
      };
    },
  },
  // Dupla difração: dois prismas e um divisor ou dicroico, com trilho.
  {
    count: 8,
    seed: 30900,
    options: (k) => {
      const i = Math.round(k * 7);
      return {
        mirrors: lerp(7, 9, k),
        beams: 3,
        prisms: 2,
        splitters: i % 2,
        dichroics: 1 - (i % 2),
        slider: 'mirror' as const,
        decoys: 2,
        minMoves: lerp(7, 9, k),
      };
    },
  },
  // 101–104: mecânicas novas, uma por fase, cada uma com peças já conhecidas.
  // Espelhos ligados: dois pares giram juntos (fio pontilhado), com alvo combinado.
  {
    count: 1,
    seed: 40000,
    epilogue: true,
    options: () => ({ mirrors: 8, beams: 2, merge: 1, mergeMirrors: 2, links: 2, decoys: 1, minMoves: 7 }),
  },
  // Portais: dois feixes atravessam um par de portais cada; um passa por filtro.
  {
    count: 1,
    seed: 40100,
    epilogue: true,
    options: () => ({ mirrors: 8, beams: 2, portals: 2, filters: 1, decoys: 1, minMoves: 7 }),
  },
  // Sensor e porta: um feixe acende o sensor que abre a porta no caminho do feixe que passa pelo prisma.
  {
    count: 1,
    seed: 40200,
    epilogue: true,
    options: () => ({ mirrors: 7, beams: 2, gates: 1, prism: true, decoys: 1, minMoves: 7 }),
  },
  // Anti-alvos: zonas onde certa cor (ou qualquer luz) não pode chegar, com prisma e dicroico.
  {
    count: 1,
    seed: 40300,
    epilogue: true,
    options: () => ({ mirrors: 8, beams: 3, prism: true, darks: 3, dichroics: 1, minMoves: 8 }),
  },
  // 105–108: ímã, lente que funde, cristal e diodo.
  // Ímã: curva a luz sempre para o mesmo lado (tocar inverte a polaridade); três no lugar de espelhos.
  {
    count: 1,
    seed: 50000,
    epilogue: true,
    options: () => ({ mirrors: 8, beams: 2, benders: 3, filters: 1, decoys: 1, minMoves: 7 }),
  },
  // Lente que funde: dois feixes entram, um sai com as cores somadas até o alvo combinado.
  {
    count: 1,
    seed: 50100,
    epilogue: true,
    options: () => ({ mirrors: 7, beams: 2, merge: 1, mergeMirrors: 2, combiners: 1, decoys: 1, minMoves: 7 }),
  },
  // Cristal: troca a cor no caminho (R→G→B→R), com prisma.
  {
    count: 1,
    seed: 50200,
    epilogue: true,
    options: () => ({ mirrors: 8, beams: 2, prism: true, shifters: 2, decoys: 1, minMoves: 7 }),
  },
  // Diodo: passagem de mão única, com divisor e um ímã.
  {
    count: 1,
    seed: 50300,
    epilogue: true,
    options: () => ({ mirrors: 8, beams: 3, splitters: 1, diodes: 3, benders: 1, minMoves: 8 }),
  },
];

// Pontuação → 1..5 marcadores no topo da tela.
const THRESHOLDS = [6, 11, 16, 21];
const pips = (score: number): number => 1 + THRESHOLDS.filter((t) => score >= t).length;

// Seed sem fase válida (comum nas faixas com muitas mecânicas): tenta seeds derivadas, deterministicamente.
// Faixas antigas acertam de primeira, então não mudam.
function generateRetry(seed: number, opts: GenOptions): Level {
  for (let n = 0; ; n++) {
    try {
      return generate(seed + n * 1000, opts);
    } catch (e) {
      if (n >= 30) throw e;
    }
  }
}

const dir = new URL('../src/levels/', import.meta.url);
const handmade = JSON.parse(readFileSync(new URL('handmade.json', dir), 'utf8')) as Level[];
// Fases geradas aprovadas no playtest: ficam iguais e entram na sua faixa, ordenadas junto com as novas.
const kept = JSON.parse(readFileSync(new URL('kept.json', dir), 'utf8')) as { tier: number; level: Level }[];
const levels: Level[] = [...handmade];
type Scored = { level: Level; score: number; tier: number };
const tiers: Scored[][] = TIERS.map((tier, t) => {
  const batch: Scored[] = kept.filter((k) => k.tier === t).map(({ level }) => ({ level, score: difficultyScore(level), tier: t }));
  for (let i = 0; i < tier.count; i++) {
    const level = generateRetry(tier.seed + i, tier.options(tier.count === 1 ? 0 : i / (tier.count - 1)));
    batch.push({ level, score: difficultyScore(level), tier: t });
  }
  return batch.sort((a, b) => a.score - b.score);
});

// Ordem: dificuldade estritamente crescente (nota do solver). Cada mecânica aparece pela primeira vez na
// sua fase mais fácil, onde ela cai na curva; empates seguem a ordem das faixas.
const all = tiers.filter((_, t) => !TIERS[t]!.finale && !TIERS[t]!.epilogue).flat().sort((a, b) => a.score - b.score || a.tier - b.tier);
const seenTier = new Set<number>();
for (const x of all) {
  levels.push(x.level);
  const tag = seenTier.has(x.tier) ? '' : '  <- nova mecânica';
  seenTier.add(x.tier);
  process.stdout.write(`fase ${levels.length}: faixa ${x.tier + 1} nota ${x.score.toFixed(1)}${tag}
`);
}
for (const [t, batch] of tiers.entries()) {
  if (!TIERS[t]!.finale) continue;
  for (const x of batch) {
    levels.push(x.level);
    process.stdout.write(`fase ${levels.length}: final nota ${x.score.toFixed(1)}
`);
  }
}
for (const [t, batch] of tiers.entries()) {
  if (!TIERS[t]!.epilogue) continue;
  for (const x of batch) {
    levels.push(x.level);
    process.stdout.write(`fase ${levels.length}: nova mecânica nota ${x.score.toFixed(1)}
`);
  }
}
// handmade.json e kept.json já estão na grade 7x9; as geradas saem dela pelo generate.
for (const [i, level] of levels.entries()) {
  level.id = i + 1;
  level.difficulty = pips(difficultyScore(level));
}
writeFileSync(new URL('levels.json', dir), JSON.stringify(levels) + '\n');
process.stdout.write(`${levels.length} fases; marcadores: ${levels.map((l) => l.difficulty).join('')}\n`);
