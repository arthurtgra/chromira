import { isPiece, key, linkOf, pieceStates, pieces, placeCells, startRots, trace } from './trace.ts';
import type { Level, Rots } from './types.ts';

export const MAX_SPACE = 1 << 16;

// Variáveis da busca: cada peça sozinha, ou um grupo de peças ligadas (giram juntas: o grupo só tem
// "quantos toques a partir do início").
interface Var {
  members: number[];
  radix: number;
}

function variables(level: Level): Var[] {
  const vars: Var[] = [];
  const groups = new Map<number, Var>();
  pieces(level).forEach((c, i) => {
    const l = linkOf(c);
    const g = l === undefined ? undefined : groups.get(l);
    if (g) g.members.push(i);
    else {
      const v = { members: [i], radix: pieceStates(c) };
      vars.push(v);
      if (l !== undefined) groups.set(l, v);
    }
  });
  return vars;
}

export function searchSpace(level: Level): number {
  return variables(level).reduce((a, v) => a * v.radix, 1);
}

// Percorre todos os estados alcançáveis; fn devolve true para parar.
function forEachState(level: Level, fn: (rots: Rots) => boolean): void {
  const vars = variables(level);
  const space = searchSpace(level);
  if (space > MAX_SPACE) throw new Error(`solver: ${space} combinações é demais para força bruta`);
  const start = startRots(level);
  const states = pieces(level).map(pieceStates);
  const val = vars.map(() => 0);
  const rots: Rots = start.map(() => 0);
  for (let n = 0; n < space; n++) {
    for (const [vi, v] of vars.entries()) {
      for (const m of v.members) rots[m] = v.members.length > 1 ? (start[m]! + val[vi]!) % states[m]! : val[vi]!;
    }
    if (fn(rots)) return;
    for (let i = 0; i < val.length; i++) {
      val[i]! += 1;
      if (val[i]! < vars[i]!.radix) break;
      val[i] = 0;
    }
  }
}

export function countSolutions(level: Level, limit: number = Infinity): { count: number; first: Rots | null } {
  let count = 0;
  let first: Rots | null = null;
  forEachState(level, (rots) => {
    if (trace(level, rots).solved) {
      count++;
      first ??= [...rots];
    }
    return count >= limit;
  });
  return { count, first };
}

// Células por onde a luz passa (pontas incluídas). Peça fora delas não muda nada na solução.
export function litCells(level: Level, rots: Rots): Set<string> {
  const lit = new Set<string>();
  for (const s of trace(level, rots).segments) {
    const len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    const ux = len ? (s.x2 - s.x1) / len : 0;
    const uy = len ? (s.y2 - s.y1) / len : 0;
    for (let t = 0; t <= len + 1e-9; t++) {
      const x = s.x1 + ux * t;
      const y = s.y1 + uy * t;
      if (Number.isInteger(x) && Number.isInteger(y)) lit.add(key(x, y));
    }
  }
  return lit;
}

// Solução sem as peças apagadas (distratoras): o estado delas não conta.
export function essentialKey(level: Level, rots: Rots): string {
  const lit = litCells(level, rots);
  const placed = placeCells(level, rots).filter(isPiece);
  return rots.map((v, i) => (lit.has(key(placed[i]!.x, placed[i]!.y)) ? v : '*')).join(',');
}

// Soluções diferentes de verdade: duas que só mudam peças distratoras (fora da luz) contam como uma.
export function countEssential(level: Level, limit: number = Infinity): number {
  const keys = new Set<string>();
  forEachState(level, (rots) => {
    if (trace(level, rots).solved) keys.add(essentialKey(level, rots));
    return keys.size >= limit;
  });
  return keys.size;
}

export function solve(level: Level): Rots | null {
  return countSolutions(level, 1).first;
}

// Nota de dificuldade: toques necessários, tamanho da busca, alvos e peças especiais.
export function difficultyScore(level: Level): number {
  const sol = solve(level);
  if (!sol) return Infinity;
  const start = level.start ?? sol.map(() => 0);
  // Só conta peças acesas na solução: girar uma distratora não é um toque necessário.
  const need = essentialKey(level, sol).split(',');
  // Grupo ligado conta um toque só (todas giram juntas).
  const seen = new Set<number>();
  const moves = pieces(level).filter((c, i) => {
    if (need[i] === '*' || start[i] === sol[i]) return false;
    const l = linkOf(c);
    if (l === undefined) return true;
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  }).length;
  const count = (t: string): number => level.cells.filter((c) => c.t === t).length;
  return moves + 0.6 * Math.log2(searchSpace(level)) + 0.5 * count('target') + 1.2 * count('filter') + count('prism') + 1.3 * count('splitter') + 1.3 * count('dichroic');
}
