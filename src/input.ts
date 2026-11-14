import type { Layout } from './render/layout.ts';

export function cellAt(l: Layout, px: number, py: number, cols: number, rows: number): { x: number; y: number } | null {
  const x = Math.floor((px - l.ox) / l.cell);
  const y = Math.floor((py - l.oy) / l.cell);
  return x >= 0 && y >= 0 && x < cols && y < rows ? { x, y } : null;
}

export interface PointerHandlers {
  down: (px: number, py: number) => void;
  move: (px: number, py: number) => void;
  up: () => void;
}

export function onPointer(el: HTMLElement, h: PointerHandlers): void {
  const at = (e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    h.down(...at(e));
  });
  el.addEventListener('pointermove', (e) => {
    if (el.hasPointerCapture(e.pointerId)) h.move(...at(e));
  });
  el.addEventListener('pointerup', () => h.up());
  el.addEventListener('pointercancel', () => h.up());
}
