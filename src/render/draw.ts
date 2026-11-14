import { CONFIG } from '../config.ts';
import { DELTA } from '../core/trace.ts';
import type { Cell, Segment } from '../core/types.ts';
import { cx, cy, type Layout } from './layout.ts';

type Ctx = CanvasRenderingContext2D;

export function drawBackground(ctx: Ctx, l: Layout, color: string, cols: number, rows: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, l.w, l.h);
  ctx.fillStyle = `rgba(255,255,255,${CONFIG.gridDotAlpha})`;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.beginPath();
      ctx.arc(cx(l, x), cy(l, y), CONFIG.gridDotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const segLen = (s: Segment): number => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);

// Desenha os segmentos até a fração t do comprimento total.
export function drawBeams(ctx: Ctx, l: Layout, segments: Segment[], t: number, widthMul: number): void {
  const total = segments.reduce((a, s) => a + segLen(s), 0);
  let budget = total * Math.min(1, Math.max(0, t));
  const visible: Segment[] = [];
  for (const s of segments) {
    if (budget <= 0) break;
    const len = segLen(s);
    if (len <= budget) visible.push(s);
    else {
      const f = budget / len;
      visible.push({ ...s, x2: s.x1 + (s.x2 - s.x1) * f, y2: s.y1 + (s.y2 - s.y1) * f });
    }
    budget -= len;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const layer of CONFIG.beam.layers) {
    ctx.globalAlpha = layer.alpha;
    ctx.lineWidth = Math.max(1, layer.width * l.cell * widthMul);
    for (const s of visible) {
      ctx.strokeStyle = CONFIG.colors[s.color];
      ctx.beginPath();
      ctx.moveTo(cx(l, s.x1), cy(l, s.y1));
      ctx.lineTo(cx(l, s.x2), cy(l, s.y2));
      ctx.stroke();
    }
  }
  ctx.restore();
}

export interface PieceView {
  mirrorAngle: (i: number) => number; // radianos; '/' = -45°, '\' = 45°
  targetFill: (x: number, y: number) => number; // 0..1
}

export function drawPieces(ctx: Ctx, l: Layout, cells: Cell[], view: PieceView): void {
  const p = CONFIG.piece;
  const c = l.cell;
  ctx.save();
  ctx.lineWidth = p.stroke;
  ctx.strokeStyle = p.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let mi = 0;
  for (const cell of cells) {
    const x = cx(l, cell.x);
    const y = cy(l, cell.y);
    switch (cell.t) {
      case 'mirror': {
        const a = view.mirrorAngle(mi++);
        const r = (p.mirrorLen * c) / 2;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        ctx.stroke();
        break;
      }
      case 'wall': {
        const s = p.wallSize * c;
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
        ctx.beginPath();
        ctx.moveTo(x - s / 2, y + s / 2);
        ctx.lineTo(x + s / 2, y - s / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'target': {
        const r = p.ringRadius * c;
        const fill = view.targetFill(cell.x, cell.y);
        ctx.strokeStyle = CONFIG.colors[cell.color];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        if (fill > 0) {
          ctx.fillStyle = CONFIG.colors[cell.color];
          ctx.beginPath();
          ctx.arc(x, y, r * fill * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = p.color;
        break;
      }
      case 'emitter': {
        const s = 0.22 * c;
        const [dx, dy] = DELTA[cell.dir];
        ctx.strokeRect(x - s, y - s, s * 2, s * 2);
        ctx.fillStyle = CONFIG.colors[cell.color];
        ctx.beginPath();
        ctx.arc(x + dx * s, y + dy * s, s * 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'prism': {
        const s = p.prismSize * c;
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s * 0.87, y + s * 0.5);
        ctx.lineTo(x - s * 0.87, y + s * 0.5);
        ctx.closePath();
        ctx.stroke();
        break;
      }
    }
  }
  ctx.restore();
}

export function drawHud(ctx: Ctx, l: Layout, levelNumber: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${CONFIG.hudAlpha})`;
  ctx.font = CONFIG.hudFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(levelNumber), l.w / 2, CONFIG.layout.top / 2);
  ctx.restore();
}

export function drawDebug(ctx: Ctx, l: Layout, cols: number, rows: number, fps: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) ctx.fillText(`${x},${y}`, l.ox + x * l.cell + 3, l.oy + y * l.cell + 3);
  }
  ctx.font = '12px monospace';
  ctx.fillText(`${fps.toFixed(0)} fps`, 8, 8);
  ctx.restore();
}
