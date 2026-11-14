import type { Layout } from './render/layout.ts';

export function cellAt(l: Layout, px: number, py: number, cols: number, rows: number): { x: number; y: number } | null {
  const x = Math.floor((px - l.ox) / l.cell);
  const y = Math.floor((py - l.oy) / l.cell);
  return x >= 0 && y >= 0 && x < cols && y < rows ? { x, y } : null;
}

export function onTap(el: HTMLElement, handler: (px: number, py: number) => void): void {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    handler(e.clientX - r.left, e.clientY - r.top);
  });
}
