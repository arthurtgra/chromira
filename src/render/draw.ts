import { CONFIG } from '../config.ts';
import { DELTA, FILTER_COLORS, LEFT, RIGHT } from '../core/trace.ts';
import type { Cell, Color, Dir, Segment } from '../core/types.ts';
import { cut, reachedEnd, visibleLength, type BeamPlan } from './beams.ts';
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

// Junta segmentos encadeados da mesma cor numa polilinha: cantos sem emenda.
function buildRuns(plan: BeamPlan, front: number): Run[] {
  const runs: Run[] = [];
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
  }
  return runs;
}

function strokeRun(ctx: Ctx, l: Layout, r: Run): void {
  ctx.beginPath();
  r.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(cx(l, x), cy(l, y)) : ctx.lineTo(cx(l, x), cy(l, y))));
  ctx.stroke();
}

function strokeWave(ctx: Ctx, l: Layout, r: Run, phase: number, st: BeamStyle, ampMul = 1, lenMul = 1, speedMul = 1): void {
  const W = CONFIG.beam.waves;
  const amp = W.amp * ampMul * l.cell * st.widthMul;
  const k = TAU / (W.length * lenMul);
  const wt = st.time * TAU * W.speed * speedMul;
  let s = r.d0;
  ctx.beginPath();
  for (let i = 1; i < r.pts.length; i++) {
    const [x1, y1] = r.pts[i - 1]!;
    const [x2, y2] = r.pts[i]!;
    const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const n = Math.max(2, Math.ceil(len / W.step));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const u = (j / n) * len;
      const env = Math.min(1, u / W.taper, (len - u) / W.taper);
      const off = amp * env * Math.sin(k * (s + u) - wt + phase);
      const px = cx(l, x1 + ux * u) - uy * off;
      const py = cy(l, y1 + uy * u) + ux * off;
      if (i === 1 && j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    s += len;
  }
  ctx.stroke();
}

export interface BeamStyle {
  t: number; // fração da animação de crescimento, 0..1
  widthMul: number;
  rainbow: number; // 0..1
  time: number; // segundos
}

export interface FadingBeam {
  seg: Segment; // já recortado: só o que ainda não foi recolhido
  d0: number; // fase das ondas
  alpha: number;
}

// Três camadas por polilinha, faixas cromáticas correndo no sentido da luz e franjas de difração nos brancos.
export function drawBeams(ctx: Ctx, l: Layout, plan: BeamPlan, front: number, fading: FadingBeam[], st: BeamStyle): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Trechos sendo recolhidos: mesmo visual, mais fracos.
  for (const f of fading) {
    drawRuns(ctx, l, [{ pts: [[f.seg.x1, f.seg.y1], [f.seg.x2, f.seg.y2]], color: f.seg.color, d0: f.d0 }], st, f.alpha);
  }
  drawRuns(ctx, l, buildRuns(plan, front), st, 1);
  ctx.restore();
}

// Névoa e miolo na cor do feixe, miolo de mistura, e as ondas (uma por componente R/G/B, fases a 120°;
// cor pura vira trança de duas ondas). Cada onda tem aura que a acompanha e uma deriva lenta mais aberta.
function drawRuns(ctx: Ctx, l: Layout, runs: Run[], st: BeamStyle, alphaMul: number): void {
  const B = CONFIG.beam;
  const W = B.waves;
  for (const layer of B.layers) {
    ctx.globalAlpha = layer.alpha * alphaMul;
    ctx.lineWidth = Math.max(1, layer.width * l.cell);
    for (const r of runs) {
      ctx.strokeStyle = CONFIG.colors[r.color];
      strokeRun(ctx, l, r);
    }
  }
  for (const r of runs) {
    if ((r.color & (r.color - 1)) === 0 || r.color === 7) continue;
    ctx.strokeStyle = CONFIG.colors[r.color];
    for (const m of [W.mixGlow, W.mixCore]) {
      ctx.globalAlpha = m.alpha * alphaMul;
      ctx.lineWidth = Math.max(1, m.width * l.cell);
      strokeRun(ctx, l, r);
    }
  }
  for (const r of runs) {
    const comps = COMPONENTS.filter((c) => (r.color & c) !== 0);
    const waves =
      comps.length === 1
        ? [0, Math.PI].map((ph) => ({ color: CONFIG.colors[comps[0]!], ph }))
        : comps.map((c) => ({
            color: mix(CONFIG.colors[c], CONFIG.colors[r.color], W.tint[r.color] ?? 0),
            ph: (COMPONENTS.indexOf(c) * TAU) / 3,
          }));
    for (const w of waves) {
      ctx.strokeStyle = w.color;
      ctx.lineWidth = W.driftWidth * l.cell;
      ctx.globalAlpha = W.driftAlpha * alphaMul;
      strokeWave(ctx, l, r, w.ph * 1.7, st, W.driftAmp, W.driftLength, W.driftSpeed);
      ctx.lineWidth = W.glowWidth * l.cell;
      ctx.globalAlpha = W.glowAlpha * alphaMul;
      strokeWave(ctx, l, r, w.ph, st);
      ctx.lineWidth = Math.max(1, W.width * l.cell);
      ctx.globalAlpha = W.alpha * alphaMul;
      strokeWave(ctx, l, r, w.ph, st);
    }
  }
  if (st.rainbow > 0) {
    const R = CONFIG.rainbow;
    ctx.lineWidth = Math.max(1, W.width * 0.7 * l.cell);
    ctx.globalAlpha = R.alpha * st.rainbow * alphaMul;
    const ampMul = 1 + (R.ampMul - 1) * st.rainbow;
    for (const r of runs) {
      if (r.color !== 7) continue;
      R.hues.forEach((h, i) => {
        ctx.strokeStyle = `hsl(${h}, 100%, 62%)`;
        strokeWave(ctx, l, r, ((i + 0.5) * TAU) / R.hues.length, st, ampMul);
      });
    }
  }
}

// Colisão: onde a luz bate num obstáculo (parede, lançador), clarão pequeno e macio na cor do feixe,
// tremulando. Só aparece depois que a frente de luz chegou lá.
export function drawImpacts(
  ctx: Ctx,
  l: Layout,
  hits: { x: number; y: number; color: Color }[],
  plan: BeamPlan,
  front: number,
  st: BeamStyle,
): void {
  const I = CONFIG.beam.impact;
  const reached = new Set(plan.pieces.filter((p) => reachedEnd(p, front)).map((p) => `${p.x2},${p.y2}`));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const h of hits) {
    if (!reached.has(`${h.x},${h.y}`)) continue;
    const x = cx(l, h.x);
    const y = cy(l, h.y);
    const r = I.radius * l.cell * (0.8 + 0.2 * Math.sin(st.time * 13 + h.x * 3.1 + h.y * 1.7));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, CONFIG.colors[h.color]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = I.alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

const DIRS: Dir[] = ['N', 'E', 'S', 'W'];

// Prisma aceso: só degradês radiais, sem contornos. Um brilho branco/da cor que entra no centro e,
// para cada cor que sai, um lóbulo dessa cor deslocado para o lado exato por onde ela sai
// (vermelho vira à esquerda, verde segue, azul vira à direita — igual ao trace). Pulsa devagar.
// segments = trechos já visíveis: o brilho aparece quando a luz chega ao prisma, sem depender do resto da animação.
export function drawPrismGlow(ctx: Ctx, l: Layout, cells: Cell[], segments: Segment[], st: BeamStyle): void {
  const P = CONFIG.rainbow.prism;
  const k = P.alpha[0] + (P.alpha[1] - P.alpha[0]) * st.rainbow;
  const pulse = 0.5 + 0.5 * Math.sin(st.time * TAU * P.pulseHz);
  const blob = (x: number, y: number, r: number, color: string, alpha: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of cells) {
    if (p.t !== 'prism') continue;
    const inc = segments.find((s) => s.x2 === p.x && s.y2 === p.y);
    if (!inc) continue;
    const dir = DIRS.find((d) => DELTA[d][0] === Math.sign(inc.x2 - inc.x1) && DELTA[d][1] === Math.sign(inc.y2 - inc.y1))!;
    const x = cx(l, p.x);
    const y = cy(l, p.y);
    const exits: [Color, Dir][] = [
      [1, LEFT[dir]],
      [2, dir],
      [4, RIGHT[dir]],
    ];
    for (const [c, d] of exits) {
      if ((inc.color & c) === 0) continue;
      const off = P.lobeOffset * l.cell;
      blob(x + DELTA[d][0] * off, y + DELTA[d][1] * off, P.lobe * l.cell, CONFIG.colors[c], k * P.lobeAlpha * (0.8 + 0.2 * pulse));
    }
    blob(x, y, P.core * l.cell * (0.92 + 0.08 * pulse), CONFIG.colors[inc.color], k * P.coreAlpha);
  }
  ctx.restore();
}

export interface PieceView {
  mirrorAngle: (i: number) => number; // i = índice da peça móvel; radianos ('/' = -45°)
  filterColor: (i: number) => { from: number; to: number; k: number }; // índices em FILTER_COLORS
  targetFill: (x: number, y: number) => number; // 0..1
  targetReceived: (x: number, y: number) => number; // OR das cores chegando agora
  time: number; // segundos
}

const COMPONENTS = [1, 2, 4] as const;

// Alvo: anel na cor exigida. Mistura que chega aparece como disco no meio.
// Faltando cor: disco pequeno e calmo. Cor errada (sobra componente): disco + X e anel tracejado tremendo.
function drawTarget(ctx: Ctx, x: number, y: number, r: number, need: Color, got: number, fill: number, time: number): void {
  const col = CONFIG.colors[need];
  const wrong = (got & ~need) !== 0;
  const jx = wrong ? Math.sin(time * 38) * r * 0.05 : 0;
  ctx.strokeStyle = col;
  ctx.lineWidth = CONFIG.piece.stroke * 1.5;
  if (wrong) {
    ctx.setLineDash([r * 0.42, r * 0.28]);
    ctx.lineDashOffset = time * r * 2;
  }
  ctx.beginPath();
  ctx.arc(x + jx, y, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  if (got !== 0 && got !== need) {
    ctx.globalAlpha = wrong ? 0.7 : 0.45;
    ctx.fillStyle = CONFIG.colors[got as Color];
    ctx.beginPath();
    ctx.arc(x + jx, y, r * (wrong ? 0.55 : 0.4), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (wrong) {
    const d = r * 0.32;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = CONFIG.piece.stroke * 1.6;
    ctx.beginPath();
    ctx.moveTo(x + jx - d, y - d);
    ctx.lineTo(x + jx + d, y + d);
    ctx.moveTo(x + jx + d, y - d);
    ctx.lineTo(x + jx - d, y + d);
    ctx.stroke();
  }
  if (fill > 0) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r * fill * 0.8, 0, TAU);
    ctx.fill();
  }
  ctx.lineWidth = CONFIG.piece.stroke;
}

// Lançador: corpo escuro arredondado, liso, e uma lente acesa na face de saída. A luz nasce da lente.
function drawEmitter(ctx: Ctx, x: number, y: number, c: number, dir: Dir, color: Color, time: number): void {
  const E = CONFIG.emitter;
  const col = CONFIG.colors[color];
  const [dx, dy] = DELTA[dir];
  const b = E.body * c;
  const pulse = 0.5 + 0.5 * Math.sin(time * TAU * E.pulseHz);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dy, dx));

  const halo = ctx.createRadialGradient(b, 0, 0, b, 0, E.halo * c);
  halo.addColorStop(0, col);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.18 + 0.1 * pulse;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(b, 0, E.halo * c, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.globalAlpha = 1;
  ctx.fillStyle = E.fill;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = CONFIG.piece.stroke;
  ctx.beginPath();
  ctx.roundRect(-b, -b, b * 2, b * 2, b * E.radius);
  ctx.fill();
  ctx.stroke();

  const t = E.lens * c;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.roundRect(b - t / 2, -b * 0.7, t, b * 1.4, t / 2);
  ctx.fill();
  ctx.restore();
}

export function mix(a: string, b: string, k: number): string {
  const p = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`; // hex: pode ser misturado de novo
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
      case 'splitter': {
        // Vidro: placa translúcida entre dois filetes finos, mais curta que o espelho. Lê como "meio espelho".
        const a = view.mirrorAngle(pi++);
        const r = (p.mirrorLen * c) / 2;
        const ux = Math.cos(a) * r;
        const uy = Math.sin(a) * r;
        const t = p.splitterGap * c;
        const nx = -Math.sin(a) * t;
        const ny = Math.cos(a) * t;
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(x - ux + nx, y - uy + ny);
        ctx.lineTo(x + ux + nx, y + uy + ny);
        ctx.lineTo(x + ux - nx, y + uy - ny);
        ctx.lineTo(x - ux - nx, y - uy - ny);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.2;
        for (const sgn of [1, -1]) {
          ctx.beginPath();
          ctx.moveTo(x - ux + nx * sgn, y - uy + ny * sgn);
          ctx.lineTo(x + ux + nx * sgn, y + uy + ny * sgn);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = p.stroke;
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
        // Bloco sólido: placa arredondada um pouco mais clara que o fundo, com luz no topo e sombra embaixo.
        const s = p.wallSize * c;
        const r = s * 0.18;
        const g = ctx.createLinearGradient(x, y - s / 2, x, y + s / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.10)');
        g.addColorStop(1, 'rgba(255,255,255,0.03)');
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.roundRect(x - s / 2, y - s / 2 + 3, s, s, r);
        ctx.fill();
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x - s / 2, y - s / 2, s, s, r);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        ctx.moveTo(x - s / 2 + r, y - s / 2 + 0.5);
        ctx.lineTo(x + s / 2 - r, y - s / 2 + 0.5);
        ctx.stroke();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'target': {
        drawTarget(ctx, x, y, p.ringRadius * c, cell.color, view.targetReceived(cell.x, cell.y), view.targetFill(cell.x, cell.y), view.time);
        ctx.strokeStyle = p.color;
        break;
      }
      case 'emitter':
        drawEmitter(ctx, x, y, c, cell.dir, cell.color, view.time);
        ctx.strokeStyle = p.color;
        ctx.fillStyle = p.color;
        break;
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
