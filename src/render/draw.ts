import { CONFIG } from '../config.ts';
import { DELTA, FILTER_COLORS } from '../core/trace.ts';
import type { Cell, Color, Segment } from '../core/types.ts';
import { cut, visibleLength, visibleSegments, type BeamPlan } from './beams.ts';
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

interface Run {
  pts: [number, number][];
  color: Color;
  d0: number;
}

// Junta segmentos encadeados da mesma cor numa polilinha só: cantos contínuos, sem emendas.
function buildRuns(plan: BeamPlan, front: number): { runs: Run[]; heads: Segment[]; ends: Segment[] } {
  const runs: Run[] = [];
  const heads: Segment[] = [];
  const ends: Segment[] = [];
  let open = false;
  for (const p of plan.pieces) {
    const v = visibleLength(p, front);
    if (v <= 0) {
      open = false;
      continue;
    }
    const s = cut(p, 0, v);
    const last = runs.at(-1);
    const tail = last?.pts.at(-1);
    if (open && last && tail && last.color === s.color && tail[0] === s.x1 && tail[1] === s.y1) last.pts.push([s.x2, s.y2]);
    else runs.push({ pts: [[s.x1, s.y1], [s.x2, s.y2]], color: s.color, d0: p.d0 });
    open = v >= p.len;
    if (open) ends.push(s);
    else if (front - p.d0 >= p.known) heads.push(s);
  }
  return { runs, heads, ends };
}

function strokeRun(ctx: Ctx, l: Layout, r: Run): void {
  ctx.beginPath();
  r.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(cx(l, x), cy(l, y)) : ctx.lineTo(cx(l, x), cy(l, y))));
  ctx.stroke();
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.3, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

export interface BeamStyle {
  t: number; // fração da animação de crescimento, 0..1
  widthMul: number;
  rainbow: number; // 0..1
  time: number; // segundos
}

export interface FadingBeam {
  seg: Segment;
  k: number; // 0..1, quanto já apagou
}

// Feixe como polilinhas contínuas com três camadas, pulsos de luz correndo no sentido da propagação,
// cabeça brilhante na frente que avança e franjas de difração nos feixes brancos.
export function drawBeams(ctx: Ctx, l: Layout, plan: BeamPlan, front: number, fading: FadingBeam[], st: BeamStyle): void {
  const B = CONFIG.beam;
  const { runs, heads } = buildRuns(plan, front);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const f of fading) {
    const a = (1 - f.k) ** 2;
    for (const layer of B.layers) {
      ctx.globalAlpha = layer.alpha * a;
      ctx.lineWidth = Math.max(1, layer.width * l.cell * (1 - 0.5 * f.k));
      ctx.strokeStyle = CONFIG.colors[f.seg.color];
      ctx.beginPath();
      ctx.moveTo(cx(l, f.seg.x1), cy(l, f.seg.y1));
      ctx.lineTo(cx(l, f.seg.x2), cy(l, f.seg.y2));
      ctx.stroke();
    }
  }

  for (const layer of B.layers) {
    ctx.globalAlpha = layer.alpha;
    ctx.lineWidth = Math.max(1, layer.width * l.cell * st.widthMul);
    for (const r of runs) {
      ctx.strokeStyle = CONFIG.colors[r.color];
      strokeRun(ctx, l, r);
    }
  }

  // Pulsos: tracejado cuja fase segue a distância da fonte, então atravessa cantos sem pular.
  const F = B.flow;
  ctx.setLineDash([F.dash * l.cell, F.gap * l.cell]);
  ctx.lineWidth = Math.max(1.5, F.width * l.cell * st.widthMul);
  ctx.globalAlpha = F.alpha;
  ctx.strokeStyle = '#ffffff';
  for (const r of runs) {
    ctx.lineDashOffset = (r.d0 - st.time * F.speed) * l.cell;
    strokeRun(ctx, l, r);
  }
  ctx.setLineDash([]);

  for (const h of heads) glow(ctx, cx(l, h.x2), cy(l, h.y2), B.head * l.cell, CONFIG.colors[h.color], 0.9);

  if (st.rainbow > 0) {
    const R = CONFIG.rainbow;
    const n = R.fringes;
    ctx.lineWidth = Math.max(1, 0.025 * l.cell * st.widthMul);
    for (const s of visibleSegments(plan, front)) {
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

// Desenhado por cima das peças: reflexo cintilante onde o feixe bate num espelho ou filtro,
// e clarão de impacto onde ele morre numa parede ou na borda.
export function drawBeamHits(ctx: Ctx, l: Layout, cells: Cell[], plan: BeamPlan, front: number, st: BeamStyle): void {
  const B = CONFIG.beam;
  const shiny = new Set(cells.flatMap((c) => (c.t === 'mirror' || c.t === 'filter' ? [`${c.x},${c.y}`] : [])));
  const { ends } = buildRuns(plan, front);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const s of ends) {
    const x = cx(l, s.x2);
    const y = cy(l, s.y2);
    const col = CONFIG.colors[s.color];
    const seed = s.x2 * 1.7 + s.y2 * 2.3;
    if (shiny.has(`${s.x2},${s.y2}`)) {
      const pulse = 0.5 + 0.5 * Math.sin(st.time * TAU * B.glint.hz + seed);
      const r = B.glint.radius * l.cell * (0.85 + 0.15 * pulse) * st.widthMul;
      glow(ctx, x, y, r, col, 0.45 + 0.3 * pulse);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      const rot = st.time * B.glint.spin + seed;
      for (let i = 0; i < 4; i++) {
        const a = rot + (i * Math.PI) / 4;
        const len = r * (i % 2 === 0 ? 1.15 : 0.6);
        ctx.globalAlpha = (i % 2 === 0 ? 0.75 : 0.45) * (0.6 + 0.4 * pulse);
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
    } else if (!Number.isInteger(s.x2) || !Number.isInteger(s.y2)) {
      const flicker = 0.75 + 0.25 * Math.sin(st.time * 11 + seed);
      glow(ctx, x, y, B.impact * l.cell * flicker * st.widthMul, col, 0.7);
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
  targetReceived: (x: number, y: number) => number; // OR das cores chegando agora
}

const COMPONENTS = [1, 2, 4] as const;

// Disco interno com a mistura que chega + marcadores R/G/B no anel: cheio = chegou, oco = falta, riscado = sobra.
function drawTargetHints(ctx: Ctx, x: number, y: number, r: number, need: number, got: number): void {
  if (got !== 0 && got !== need) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = CONFIG.colors[got as keyof typeof CONFIG.colors];
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, TAU);
    ctx.fill();
  }
  const dot = Math.max(3.5, r * 0.22);
  COMPONENTS.forEach((comp, i) => {
    const needs = (need & comp) !== 0;
    const has = (got & comp) !== 0;
    if (!needs && !has) return;
    const a = -Math.PI / 2 + (i * TAU) / 3;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    const col = CONFIG.colors[comp];
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#07070d';
    ctx.beginPath();
    ctx.arc(px, py, dot + 1.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, dot, 0, TAU);
    if (has) ctx.fill();
    else ctx.stroke();
    if (has && !needs) {
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(px - dot * 1.4, py + dot * 1.4);
      ctx.lineTo(px + dot * 1.4, py - dot * 1.4);
      ctx.stroke();
    }
  });
  ctx.lineWidth = CONFIG.piece.stroke;
  ctx.globalAlpha = 1;
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
        ctx.lineWidth = p.stroke * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.lineWidth = p.stroke;
        drawTargetHints(ctx, x, y, r, cell.color, view.targetReceived(cell.x, cell.y));
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
