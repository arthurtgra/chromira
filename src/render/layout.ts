import { CONFIG } from '../config.ts';

export interface Layout {
  cell: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export function computeLayout(w: number, h: number, cols: number, rows: number): Layout {
  const { pad, top, bottom } = CONFIG.layout;
  const cell = Math.floor(Math.min((w - pad * 2) / cols, (h - top - bottom) / rows));
  const ox = Math.round((w - cell * cols) / 2);
  const oy = Math.round(top + (h - top - bottom - cell * rows) / 2);
  return { cell, ox, oy, w, h };
}

export const cx = (l: Layout, x: number): number => l.ox + (x + 0.5) * l.cell;
export const cy = (l: Layout, y: number): number => l.oy + (y + 0.5) * l.cell;
