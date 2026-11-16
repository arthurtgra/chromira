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
