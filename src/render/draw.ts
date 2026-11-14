import { CONFIG } from '../config.ts';
import { DELTA, FILTER_COLORS } from '../core/trace.ts';
import type { Cell, Segment } from '../core/types.ts';
import { cx, cy, type Layout } from './layout.ts';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export function drawBackground(ctx: Ctx, l: Layout, colors: readonly [string, string], cols: number, rows: number): void {
  const g = ctx.createRadialGradient(l.w / 2, l.h * 0.45, 0, l.w / 2, l.h * 0.45, Math.max(l.w, l.h) * 0.75);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, l.w, l.h);
  ctx.fillStyle = `rgba(255,255,255,${CONFIG.gridDotAlpha})`;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.beginPath();
      ctx.arc(cx(l, x), cy(l, y), CONFIG.gridDotRadius, 0, TAU);
      ctx.fill();
    }
  }
}

const segLen = (s: Segment): number => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);

function visibleSegments(segments: Segment[], t: number): Segment[] {
  const total = segments.reduce((a, s) => a + segLen(s), 0);
  let budget = total * Math.min(1, Math.max(0, t));
  const out: Segment[] = [];
  for (const s of segments) {
    if (budget <= 0) break;
    const len = segLen(s);
    if (len <= budget) out.push(s);
    else {
      const f = budget / len;
      out.push({ ...s, x2: s.x1 + (s.x2 - s.x1) * f, y2: s.y1 + (s.y2 - s.y1) * f });
    }
    budget -= len;
  }
  return out;
}

export interface BeamStyle {
  t: number; // fração desenhada, 0..1
  widthMul: number;
  rainbow: number; // 0..1
  time: number; // segundos
}

// Desenha os segmentos até a fração t do comprimento total; feixes brancos ganham franjas de difração.
export function drawBeams(ctx: Ctx, l: Layout, segments: Segment[], st: BeamStyle): void {
  const visible = visibleSegments(segments, st.t);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const layer of CONFIG.beam.layers) {
    ctx.globalAlpha = layer.alpha;
    ctx.lineWidth = Math.max(1, layer.width * l.cell * st.widthMul);
    for (const s of visible) {
      ctx.strokeStyle = CONFIG.colors[s.color];
      ctx.beginPath();
      ctx.moveTo(cx(l, s.x1), cy(l, s.y1));
      ctx.lineTo(cx(l, s.x2), cy(l, s.y2));
      ctx.stroke();
    }
  }

  if (st.rainbow > 0) {
    const R = CONFIG.rainbow;
    const n = R.fringes;
    ctx.lineWidth = Math.max(1, 0.025 * l.cell * st.widthMul);
    for (const s of visible) {
      if (s.color !== 7) continue;
      const vertical = s.x1 === s.x2;
      for (let i = 0; i < n; i++) {
        const side = i / (n - 1) - 0.5; // -0.5..0.5
        const wave = 0.65 + 0.35 * Math.sin(st.time * TAU * R.shimmerHz + i * 0.9 + s.x1 + s.y1);
        const off = side * 2 * R.spread * l.cell * wave * st.rainbow * st.widthMul;
        ctx.globalAlpha = R.alpha * st.rainbow * (0.6 + 0.4 * wave);
        ctx.strokeStyle = `hsl(${(i / (n - 1)) * 280}, 100%, 62%)`;
        ctx.beginPath();
        ctx.moveTo(cx(l, s.x1) + (vertical ? off : 0), cy(l, s.y1) + (vertical ? 0 : off));
        ctx.lineTo(cx(l, s.x2) + (vertical ? off : 0), cy(l, s.y2) + (vertical ? 0 : off));
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// Leque de espectro no prisma, aberto na direção do feixe que entra.
export function drawPrismFans(ctx: Ctx, l: Layout, cells: Cell[], segments: Segment[], st: BeamStyle): void {
  if (st.t < 1) return;
  const R = CONFIG.rainbow;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of cells) {
    if (p.t !== 'prism') continue;
    const inc = segments.find((s) => s.x2 === p.x && s.y2 === p.y && (s.color & (s.color - 1)) !== 0);
    if (!inc) continue;
    const ang = Math.atan2(Math.sign(inc.y2 - inc.y1), Math.sign(inc.x2 - inc.x1));
    const x = cx(l, p.x);
    const y = cy(l, p.y);
    const rad = R.fanRadius * l.cell * (0.9 + 0.1 * Math.sin(st.time * TAU * R.shimmerHz));
    const g = ctx.createConicGradient(ang - Math.PI / 2, x, y);
    for (let i = 0; i <= 6; i++) g.addColorStop((i / 6) * 0.5, `hsla(${i * 45}, 100%, 60%, 1)`);
    g.addColorStop(0.5001, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = R.fanAlpha[0] + (R.fanAlpha[1] - R.fanAlpha[0]) * st.rainbow;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, rad, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export interface PieceView {
  mirrorAngle: (i: number) => number; // i = índice da peça móvel; radianos ('/' = -45°)
  filterColor: (i: number) => { from: number; to: number; k: number }; // índices em FILTER_COLORS
  targetFill: (x: number, y: number) => number; // 0..1
}

function mix(a: string, b: string, k: number): string {
  const p = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function drawPieces(ctx: Ctx, l: Layout, cells: Cell[], view: PieceView): void {
  const p = CONFIG.piece;
  const c = l.cell;
  ctx.save();
  ctx.lineWidth = p.stroke;
  ctx.strokeStyle = p.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let pi = 0;
  for (const cell of cells) {
    const x = cx(l, cell.x);
    const y = cy(l, cell.y);
    switch (cell.t) {
      case 'mirror': {
        const a = view.mirrorAngle(pi++);
        const r = (p.mirrorLen * c) / 2;
        const ux = Math.cos(a) * r;
        const uy = Math.sin(a) * r;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = p.stroke * 4;
        ctx.beginPath();
        ctx.moveTo(x - ux, y - uy);
        ctx.lineTo(x + ux, y + uy);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = p.stroke;
        ctx.stroke();
        break;
      }
      case 'filter': {
        const f = view.filterColor(pi++);
        const col = mix(
          CONFIG.colors[FILTER_COLORS[f.from]!],
          CONFIG.colors[FILTER_COLORS[f.to]!],
          f.k,
        );
        const r = p.filterRadius * c * (1 + 0.15 * Math.sin(f.k * Math.PI));
        const rot = (f.from + f.k) * (TAU / 3);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = rot + (i * TAU) / 6;
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col;
        ctx.stroke();
        ctx.strokeStyle = p.color;
        break;
      }
      case 'wall': {
        const s = p.wallSize * c;
        ctx.globalAlpha = 0.45;
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
        const col = CONFIG.colors[cell.color];
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.55, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (fill > 0) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x, y, r * fill * 0.8, 0, TAU);
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
        ctx.arc(x + dx * s, y + dy * s, s * 0.45, 0, TAU);
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
