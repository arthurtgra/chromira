import { railOf } from './trace.ts';
import type { Cell, Level } from './types.ts';

// Grade do jogo: ímpar nos dois eixos, então existe uma coluna e uma linha do meio.
export const GRID = { w: 7, h: 9 } as const;

// Caixa ocupada pelas células (peça em trilho conta o trilho inteiro).
function bounds(cells: Cell[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cells) {
    const rail = railOf(c);
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + (rail?.axis === 'x' ? rail.len - 1 : 0));
    y1 = Math.max(y1, c.y + (rail?.axis === 'y' ? rail.len - 1 : 0));
  }
  return { x0, y0, x1, y1 };
}

// Coloca a fase na grade GRID com o conteúdo centralizado. Deslocar tudo junto não muda a solução:
// a luz só anda mais uma célula antes de sair da grade. Aplicar de novo não move nada.
export function recenter(level: Level): Level {
  const { w, h } = GRID;
  if (level.cells.length === 0) return { ...level, w, h };
  const b = bounds(level.cells);
  const shift = (lo: number, hi: number, size: number): number =>
    Math.max(-lo, Math.min(size - 1 - hi, Math.round((size - 1) / 2 - (lo + hi) / 2)));
  const dx = shift(b.x0, b.x1, w);
  const dy = shift(b.y0, b.y1, h);
  return { ...level, w, h, cells: level.cells.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })) };
}

// Onde abrir a linha/coluna nova: antes do índice k, o mais perto do meio do conteúdo,
// sem cortar um trilho no mesmo eixo (o trilho precisa continuar contínuo).
function gap(cells: Cell[], axis: 'x' | 'y', lo: number, hi: number): number {
  const mid = (lo + hi + 1) / 2;
  const ks: number[] = [];
  for (let k = lo + 1; k <= hi; k++) ks.push(k);
  ks.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  const ok = (k: number): boolean =>
    cells.every((c) => {
      const r = railOf(c);
      if (!r || r.axis !== axis) return true;
      const s = c[axis];
      return k <= s || k > s + r.len - 1;
    });
  return ks.find(ok) ?? hi + 1;
}

// Fase feita na grade antiga 6x8 → 7x9: abre uma coluna e uma linha vazias no meio do conteúdo,
// então a fase ocupa a grade nova inteira. Uma linha vazia entre as peças só alonga os feixes:
// as mesmas peças continuam alinhadas, e as soluções não mudam. Depois centraliza o que sobrar.
export function expand(level: Level): Level {
  if (level.cells.length === 0) return { ...level, w: GRID.w, h: GRID.h };
  const b = bounds(level.cells);
  const kx = gap(level.cells, 'x', b.x0, b.x1);
  const ky = gap(level.cells, 'y', b.y0, b.y1);
  const cells = level.cells.map((c) => ({ ...c, x: c.x + (c.x >= kx ? 1 : 0), y: c.y + (c.y >= ky ? 1 : 0) }));
  return recenter({ ...level, w: GRID.w, h: GRID.h, cells });
}
