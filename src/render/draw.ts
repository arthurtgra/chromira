import { CONFIG } from '../config.ts';
import { DELTA, FILTER_COLORS } from '../core/trace.ts';
import type { Cell, Color, Dir, Segment } from '../core/types.ts';
import { cut, reachedEnd, visibleLength, type BeamPlan, type Front } from './beams.ts';
import { cx, cy, type Layout } from './layout.ts';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

// Fundo e pontos da grade não mudam durante a fase: desenhados uma vez numa imagem guardada e copiados.
let bgCache: { key: string; img: HTMLCanvasElement } | null = null;

export function drawBackground(ctx: Ctx, l: Layout, colors: readonly [string, string], cols: number, rows: number): void {
  const dpr = ctx.getTransform().a || 1;
  const key = `${l.w}x${l.h}@${dpr}:${l.ox},${l.oy},${l.cell}:${colors.join()}:${cols}x${rows}`;
  if (bgCache?.key !== key) {
    const img = document.createElement('canvas');
    img.width = Math.round(l.w * dpr);
    img.height = Math.round(l.h * dpr);
    const c = img.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = c.createRadialGradient(l.w / 2, l.h * 0.45, 0, l.w / 2, l.h * 0.45, Math.max(l.w, l.h) * 0.75);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    c.fillStyle = g;
    c.fillRect(0, 0, l.w, l.h);
    c.fillStyle = `rgba(255,255,255,${CONFIG.gridDotAlpha})`;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        c.beginPath();
        c.arc(cx(l, x), cy(l, y), CONFIG.gridDotRadius, 0, TAU);
        c.fill();
      }
    }
    bgCache = { key, img };
  }
  ctx.drawImage(bgCache.img, 0, 0, l.w, l.h);
}

export interface WaveOrigin {
  x: number; // célula
  y: number;
  color: Color;
  at: number; // ms desde a vitória em que este anel começa
}

// Onda de vitória: anéis saindo dos alvos e pontos da grade acendendo quando o anel passa por eles.
export function drawWinWave(ctx: Ctx, l: Layout, cols: number, rows: number, origins: WaveOrigin[], ms: number): void {
  const W = CONFIG.winWave;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const o of origins) {
    const t = ms - o.at;
    if (t < 0 || t > W.ms) continue;
    const k = t / W.ms;
    const rad = (t / 1000) * W.speed; // em células
    const fade = (1 - k) ** 1.5;
    const col = CONFIG.colors[o.color];
    const ox = cx(l, o.x);
    const oy = cy(l, o.y);
    ctx.strokeStyle = col;
    // Anel principal com halo largo + um eco mais fraco logo atrás.
    for (const [lag, mul] of W.echoes) {
      const r = rad - (lag / 1000) * W.speed;
      if (r <= 0) continue;
      ctx.globalAlpha = W.glowAlpha * fade * mul;
      ctx.lineWidth = W.glowWidth;
      ctx.beginPath();
      ctx.arc(ox, oy, r * l.cell, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = W.alpha * fade * mul;
      ctx.lineWidth = W.width;
      ctx.stroke();
    }
    ctx.fillStyle = col;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = Math.abs(Math.hypot(x - o.x, y - o.y) - rad);
        if (d > W.band) continue;
        const b = 1 - d / W.band;
        ctx.globalAlpha = W.dotAlpha * fade * b;
        ctx.beginPath();
        ctx.arc(cx(l, x), cy(l, y), W.dotR * (0.6 + 0.4 * b), 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

interface Run {
  pts: [number, number][];
  color: Color;
  d0: number;
}

interface Part {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: Color;
  d0: number;
  join: boolean; // continua a parte anterior (mesma luz, sem falha)
}

// Luzes que já chegaram ao mesmo trecho, em qualquer sentido, viram a cor somada (azul + vermelho = rosa,
// as três = branco). Só a parte visível conta: a mistura começa onde e quando a segunda luz chega.
// Cada trecho comum é desenhado uma vez só, para a mistura não ficar mais forte que uma luz normal.
function mixParts(vis: (Part | null)[]): Part[] {
  const segs = vis.filter((v): v is Part => v !== null);
  const lineOf = (v: Part): string => (v.y1 === v.y2 ? `h${v.y1}` : `v${v.x1}`);
  const span = (v: Part): [number, number] =>
    v.y1 === v.y2 ? [Math.min(v.x1, v.x2), Math.max(v.x1, v.x2)] : [Math.min(v.y1, v.y2), Math.max(v.y1, v.y2)];
  const lines = new Map<string, { v: Part; i: number; a: number; b: number }[]>();
  segs.forEach((v, i) => {
    if (v.x1 === v.x2 && v.y1 === v.y2) return;
    const [a, b] = span(v);
    const k = lineOf(v);
    lines.set(k, [...(lines.get(k) ?? []), { v, i, a, b }]);
  });
  const out: Part[] = [];
  let open = false;
  let idx = -1;
  for (const v of vis) {
    if (v === null) {
      open = false;
      continue;
    }
    idx++;
    const len = Math.abs(v.x2 - v.x1) + Math.abs(v.y2 - v.y1);
    if (len === 0) continue;
    const [a, b] = span(v);
    const same = (lines.get(lineOf(v)) ?? []).filter((o) => o.b > a && o.a < b);
    const cuts = [...new Set([a, b, ...same.flatMap((o) => [o.a, o.b]).filter((t) => t > a && t < b)])].sort((p, q) => p - q);
    const forward = v.x2 > v.x1 || v.y2 > v.y1;
    if (!forward) cuts.reverse();
    const at = (t: number): [number, number] => (v.y1 === v.y2 ? [t, v.y1] : [v.x1, t]);
    let join: boolean = v.join && open;
    for (let c = 1; c < cuts.length; c++) {
      const t1 = cuts[c - 1]!;
      const t2 = cuts[c]!;
      const mid = (t1 + t2) / 2;
      const here = same.filter((o) => o.a < mid && o.b > mid);
      const owner = Math.min(...here.map((o) => o.i));
      if (owner !== idx) {
        join = false;
        continue;
      }
      const color = here.reduce((m: number, o) => m | o.v.color, 0) as Color;
      const [x1, y1] = at(t1);
      const [x2, y2] = at(t2);
      out.push({ x1, y1, x2, y2, color, d0: v.d0 + Math.abs(t1 - (forward ? a : b)), join });
      join = true;
    }
    open = join;
  }
  return out;
}

// Junta segmentos encadeados da mesma cor numa polilinha: cantos sem emenda.
function buildRuns(plan: BeamPlan, front: Front): Run[] {
  const vis: (Part | null)[] = [];
  let open = false;
  for (const p of plan.pieces) {
    const v = visibleLength(p, front);
    if (v <= 0) {
      vis.push(null);
      open = false;
      continue;
    }
    const s = cut(p, 0, v);
    vis.push({ ...s, d0: p.d0, join: open });
    open = v >= p.len;
    if (!open) vis.push(null);
  }
  const runs: Run[] = [];
  for (const s of mixParts(vis)) {
    const last = runs.at(-1);
    const tail = last?.pts.at(-1);
    if (s.join && last && tail && last.color === s.color && tail[0] === s.x1 && tail[1] === s.y1) last.pts.push([s.x2, s.y2]);
    else runs.push({ pts: [[s.x1, s.y1], [s.x2, s.y2]], color: s.color, d0: s.d0 });
  }
  return runs;
}

function strokeRun(ctx: Ctx, l: Layout, r: Run): void {
  ctx.beginPath();
  r.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(cx(l, x), cy(l, y)) : ctx.lineTo(cx(l, x), cy(l, y))));
  ctx.stroke();
}

// Engorda das ondas em volta do pulso de vitória (gaussiana estreita).
function swell(st: BeamStyle, d: number): number {
  if (st.pulse === undefined) return 1;
  const P = CONFIG.winPulse;
  return 1 + (P.swell - 1) * Math.exp(-(((d - st.pulse) / P.width) ** 2));
}

// Ponto de luz do pulso: onde ele está ao longo de cada polilinha, brilho na cor do feixe com miolo branco.
function drawPulseHeads(ctx: Ctx, l: Layout, runs: Run[], st: BeamStyle): void {
  if (st.pulse === undefined) return;
  const P = CONFIG.winPulse;
  for (const r of runs) {
    let s = r.d0;
    for (let i = 1; i < r.pts.length; i++) {
      const [x1, y1] = r.pts[i - 1]!;
      const [x2, y2] = r.pts[i]!;
      const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
      const u = st.pulse - s;
      if (u >= 0 && u <= len) {
        const x = cx(l, x1 + ((x2 - x1) / len) * u);
        const y = cy(l, y1 + ((y2 - y1) / len) * u);
        const rad = P.glow * l.cell;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.3, CONFIG.colors[r.color]);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fill();
      }
      s += len;
    }
  }
}

function strokeWave(ctx: Ctx, l: Layout, r: Run, phase: number, st: BeamStyle, ampMul = 1, lenMul = 1, speedMul = 1): void {
  const W = CONFIG.beam.waves;
  const amp = W.amp * ampMul * l.cell * st.widthMul;
  const k = TAU / (W.length * lenMul);
  const wt = st.time * TAU * W.speed * speedMul;
  // Trechos da polilinha. Cada canto é uma reflexão (espelho, divisor, dicroico): a onda que sai é a
  // imagem espelhada da que chega, então o lado da onda (sign) inverte a cada canto, e perto do canto
  // a onda é cortada na linha do espelho. A amplitude só afina no começo e no fim do feixe.
  const segs: { x: number; y: number; ux: number; uy: number; len: number; s: number; sign: number }[] = [];
  let s = r.d0;
  let sign = 1;
  for (let i = 1; i < r.pts.length; i++) {
    const [x1, y1] = r.pts[i - 1]!;
    const [x2, y2] = r.pts[i]!;
    const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    if (len <= 0) continue;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const prev = segs.at(-1);
    if (prev && (prev.ux !== ux || prev.uy !== uy)) sign = -sign;
    segs.push({ x: x1, y: y1, ux, uy, len, s, sign });
    s += len;
  }
  if (segs.length === 0) return;
  const total = s - r.d0;
  const offAt = (d: number): number => {
    const a = d - r.d0;
    const env = Math.max(0, Math.min(1, a / W.taper, (total - a) / W.taper));
    return amp * env * swell(st, d) * Math.sin(k * d - wt + phase);
  };
  // Ponto da onda no trecho g, a u células do início dele (u pode sair do trecho perto dos cantos).
  const at = (g: (typeof segs)[number], u: number): [number, number] => {
    const off = offAt(g.s + u) * g.sign;
    return [cx(l, g.x + g.ux * u) - g.uy * off, cy(l, g.y + g.uy * u) + g.ux * off];
  };
  // A luz reflete na face do espelho (a camada de fora, voltada para a luz), não no meio da placa.
  const face = (CONFIG.mirror.thick * l.cell) / 2; // px do centro da placa até a face
  // Até onde, em volta do vértice, a onda pode cruzar a face (amplitude + recuo da face a 45°).
  const ext = (amp * CONFIG.winPulse.swell) / l.cell + CONFIG.mirror.thick * Math.SQRT1_2 + W.step;
  ctx.beginPath();
  let started = false;
  const put = ([px, py]: [number, number]): void => {
    if (started) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
    started = true;
  };
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i]!;
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const turnIn = prev !== undefined && (prev.ux !== g.ux || prev.uy !== g.uy);
    const turnOut = next !== undefined && (next.ux !== g.ux || next.uy !== g.uy);
    const e = Math.min(ext, g.len / 2);
    const u0 = turnIn ? e : 0;
    const u1 = turnOut ? g.len - e : g.len;
    const n = Math.max(1, Math.ceil((u1 - u0) / W.step));
    for (let j = i === 0 || turnIn ? 0 : 1; j <= n; j++) put(at(g, u0 + ((u1 - u0) * j) / n));
    if (!turnOut || !next) continue;
    // Canto: para cada ponto perto do vértice, desenha a onda que chega até ela tocar a face do espelho;
    // depois, a refletida (mesma distância percorrida) a partir de onde ela sai da face. O trecho entre
    // as duas corre rente à face: a luz bate na superfície e volta, sem entrar na placa.
    const vx = cx(l, next.x);
    const vy = cy(l, next.y);
    const mx = (next.ux - g.ux) * Math.SQRT1_2; // normal da face, apontando para o lado da luz
    const my = (next.uy - g.uy) * Math.SQRT1_2;
    const outside = ([px, py]: [number, number]): boolean => (px - vx) * mx + (py - vy) * my >= face;
    const e2 = Math.min(ext, next.len / 2);
    const m = Math.max(2, Math.ceil((e + e2) / W.step));
    let hit = false; // a onda que chega já tocou a face: daqui em diante só a refletida
    for (let j = 1; j < m; j++) {
      const t = -e + ((e + e2) * j) / m; // distância ao vértice ao longo da luz
      const pin = at(g, g.len + t);
      if (!hit && outside(pin)) put(pin);
      else {
        hit = true;
        const pout = at(next, t);
        if (outside(pout)) put(pout);
      }
    }
  }
  ctx.stroke();
}

export interface BeamStyle {
  t: number; // fração da animação de crescimento, 0..1
  widthMul: number;
  rainbow: number; // 0..1
  time: number; // segundos
  pulse?: number; // vitória: distância da fonte onde está o pulso de luz que caminha
}

export interface FadingBeam {
  seg: Segment; // já recortado: só o que ainda não foi recolhido
  d0: number; // fase das ondas
  alpha: number;
}

// Três camadas por polilinha, faixas cromáticas correndo no sentido da luz e franjas de difração nos brancos.
export function drawBeams(ctx: Ctx, l: Layout, plan: BeamPlan, front: Front, fading: FadingBeam[], st: BeamStyle): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Trechos sendo recolhidos: mesmo visual, mais fracos.
  for (const f of fading) {
    drawRuns(ctx, l, [{ pts: [[f.seg.x1, f.seg.y1], [f.seg.x2, f.seg.y2]], color: f.seg.color, d0: f.d0 }], st, f.alpha);
  }
  const runs = buildRuns(plan, front);
  drawRuns(ctx, l, runs, st, 1);
  drawPulseHeads(ctx, l, runs, st);
  ctx.restore();
}

// Névoa e miolo na cor do feixe, miolo de mistura, e as ondas (uma por componente R/G/B, fases a 120°;
// cor pura vira trança de duas ondas). Cada onda tem aura que a acompanha e uma deriva lenta mais aberta.
// Traço com borda em degradê: várias passadas da mais larga para a mais fina, cada uma fraca. Somadas
// ('lighter'), o centro fica forte e a borda some aos poucos, como brilho, sem contorno marcado.
function soft(ctx: Ctx, width: number, alpha: number, draw: () => void): void {
  const n = CONFIG.beam.softSteps;
  const a = (alpha * CONFIG.beam.softCenter) / n;
  for (let k = 0; k < n; k++) {
    ctx.lineWidth = Math.max(1, width * (1 - k / n));
    ctx.globalAlpha = a;
    draw();
  }
}

function drawRuns(ctx: Ctx, l: Layout, runs: Run[], st: BeamStyle, alphaMul: number): void {
  const B = CONFIG.beam;
  const W = B.waves;
  const cell = l.cell * B.thickness; // espessura geral do feixe (todas as linhas)
  // Feixe branco (as três cores juntas) um pouco mais grosso que os outros: ondas mais largas e abertas.
  const thick = (r: Run): number => (r.color === 7 ? B.white.width : 1);
  const spread = (r: Run): number => (r.color === 7 ? B.white.amp : 1);
  B.layers.forEach((layer, li) => {
    for (const r of runs) {
      // Núcleo: branco tem o seu (fecha os espaços entre as três ondas); misturas de 2 cores, um fraco.
      const core = li === B.layers.length - 1;
      const pair = r.color === 3 || r.color === 5 || r.color === 6;
      const L = core && r.color === 7 ? B.white.core : core && pair ? B.pairCore : layer;
      ctx.strokeStyle = CONFIG.colors[r.color];
      const f = W.fill[r.color] ?? 1;
      soft(ctx, L.width * (L === layer ? thick(r) : 1) * cell, L.alpha * f * alphaMul, () => strokeRun(ctx, l, r));
    }
  });
  for (const r of runs) {
    if ((r.color & (r.color - 1)) === 0 || r.color === 7) continue;
    ctx.strokeStyle = CONFIG.colors[r.color];
    const mx = W.mix[r.color];
    for (const m of mx ? [mx.glow, mx.core] : [W.mixGlow, W.mixCore]) {
      soft(ctx, m.width * cell, m.alpha * (W.fill[r.color] ?? 1) * alphaMul, () => strokeRun(ctx, l, r));
    }
  }
  for (const r of runs) {
    const comps = COMPONENTS.filter((c) => (r.color & c) !== 0);
    const tw = thick(r);
    const ta = spread(r);
    const waves =
      comps.length === 1
        ? [0, Math.PI].map((ph) => ({ color: W.pure[comps[0] as 1 | 2 | 4], ph, width: 1, alpha: W.alpha as number, blue: comps[0] === 4 }))
        : comps.map((c, k) => {
            const o = W.comp[r.color]?.[c];
            const pair = comps.length === 2; // amarelo, rosa, ciano: mesmo desenho para os três
            return {
              color: o?.color ?? mix(W.pure[c as 1 | 2 | 4], CONFIG.colors[r.color], W.tint[r.color] ?? 0),
              // Duas cores: ondas opostas (0° e 180°), trança simétrica igual nas três misturas.
              ph: pair ? k * Math.PI : (COMPONENTS.indexOf(c) * TAU) / 3,
              width: o?.width ?? (pair ? W.pairWidth : 1),
              alpha: o?.alpha ?? (pair ? W.pairAlpha : W.alpha),
              blue: c === 4,
            };
          });
    // Deriva: uma só onda larga por feixe, na cor combinada (1 cor: nenhuma; branco: a mais grossa).
    const drift = W.driftByColors[comps.length] ?? 0;
    if (drift > 0) {
      ctx.strokeStyle = CONFIG.colors[r.color];
      soft(ctx, W.driftWidth * drift * cell, W.driftAlpha * (W.fill[r.color] ?? 1) * alphaMul, () =>
        strokeWave(ctx, l, r, 0, st, W.driftAmp * ta, W.driftLength, W.driftSpeed),
      );
    }
    for (const w of waves) {
      const bw = w.blue ? W.blueBoost : 1;
      ctx.strokeStyle = w.color;
      soft(ctx, W.glowWidth * tw * bw * cell, W.glowAlpha * (w.blue ? W.blueGlow : 1) * alphaMul, () => strokeWave(ctx, l, r, w.ph, st, ta));
      // A própria onda também em degradê (mais larga, centro forte, borda sumindo): brilho, não tubo contornado.
      soft(ctx, W.width * w.width * tw * bw * cell * W.lineSoft, w.alpha * (w.blue ? W.blueLine : 1) * alphaMul, () => strokeWave(ctx, l, r, w.ph, st, ta));
    }
  }
  if (st.rainbow > 0 && CONFIG.rainbow.beamWaves) {
    const R = CONFIG.rainbow;
    ctx.lineWidth = Math.max(1, W.width * 0.7 * B.white.width * cell);
    ctx.globalAlpha = R.alpha * st.rainbow * alphaMul;
    const ampMul = (1 + (R.ampMul - 1) * st.rainbow) * B.white.amp;
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
  front: Front,
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

// Prisma aceso: halo contínuo em volta, com as cores girando como num arco-íris — cada cor que sai fica
// virada para o lado por onde sai (vermelho à esquerda, verde reto, azul à direita, igual ao trace) e as
// misturas no meio (amarelo, ciano; rosa atrás). Por cima, raiozinhos finos que tremulam. Pulsa devagar.
// segments = trechos já visíveis: o brilho aparece quando a luz chega ao prisma.
let haloCanvas: HTMLCanvasElement | null = null;

const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function drawPrismGlow(ctx: Ctx, l: Layout, cells: Cell[], segments: Segment[], st: BeamStyle): void {
  const P = CONFIG.rainbow.prism;
  const k = P.alpha[0] + (P.alpha[1] - P.alpha[0]) * st.rainbow;
  const pulse = 0.5 + 0.5 * Math.sin(st.time * TAU * P.pulseHz);
  for (const p of cells) {
    if (p.t !== 'prism') continue;
    const inc = segments.find((s) => s.x2 === p.x && s.y2 === p.y);
    if (!inc) continue;
    const dir = DIRS.find((d) => DELTA[d][0] === Math.sign(inc.x2 - inc.x1) && DELTA[d][1] === Math.sign(inc.y2 - inc.y1))!;
    const x = cx(l, p.x);
    const y = cy(l, p.y);
    const R = P.halo * l.cell * (0.94 + 0.06 * pulse);
    const a0 = Math.atan2(DELTA[dir][1], DELTA[dir][0]);
    const has = (c: number): boolean => (inc.color & c) === c;
    // Volta completa a partir da direção reta (verde), no sentido horário da tela.
    const stops: [number, Color, number][] = [
      [0, 2, 1],
      [0.125, 6, P.mixAlpha],
      [0.25, 4, 1],
      [0.375, 5, P.mixAlpha],
      [0.5, 5, P.mixAlpha * 0.6],
      [0.625, 5, P.mixAlpha],
      [0.75, 1, 1],
      [0.875, 3, P.mixAlpha],
      [1, 2, 1],
    ];
    const at = (t: number): [string, number] => {
      const [, c, a] = stops.reduce((best, s) => (Math.abs(s[0] - t) < Math.abs(best[0] - t) ? s : best));
      return [CONFIG.colors[c], has(c) ? a : 0];
    };

    // Halo: degradê cônico (cores em volta) recortado por um radial (some para fora), num canvas à parte.
    const size = Math.ceil(R * 2);
    haloCanvas ??= document.createElement('canvas');
    if (haloCanvas.width < size) haloCanvas.width = haloCanvas.height = size;
    const h = haloCanvas.getContext('2d')!;
    h.clearRect(0, 0, size, size);
    h.globalCompositeOperation = 'source-over';
    const cone = h.createConicGradient(a0, R, R);
    for (const [t, c, a] of stops) cone.addColorStop(t, rgba(CONFIG.colors[c], has(c) ? a : 0));
    h.fillStyle = cone;
    h.fillRect(0, 0, size, size);
    h.globalCompositeOperation = 'destination-in';
    const fall = h.createRadialGradient(R, R, R * P.haloInner, R, R, R);
    fall.addColorStop(0, 'rgba(0,0,0,1)');
    fall.addColorStop(0.35, 'rgba(0,0,0,0.75)');
    fall.addColorStop(1, 'rgba(0,0,0,0)');
    h.fillStyle = fall;
    h.fillRect(0, 0, size, size);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k * P.haloAlpha;
    ctx.drawImage(haloCanvas, 0, 0, size, size, x - R, y - R, size, size);

    // Miolo fraco na cor que entra.
    const g = ctx.createRadialGradient(x, y, 0, x, y, P.core * l.cell);
    g.addColorStop(0, CONFIG.colors[inc.color]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = k * P.coreAlpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, P.core * l.cell, 0, TAU);
    ctx.fill();

    // Raiozinhos: traços finos saindo do centro, girando devagar, cada um com seu próprio tremor.
    ctx.lineCap = 'round';
    ctx.lineWidth = P.rays.width;
    for (let i = 0; i < P.rays.count; i++) {
      const t = (i / P.rays.count + st.time * P.rays.spin) % 1;
      const [col, a] = at(t);
      if (a === 0) continue;
      const flick = 0.5 + 0.5 * Math.sin(st.time * (2.1 + (i % 5) * 0.7) + i * 2.4);
      const ang = a0 + t * TAU;
      const r0 = P.rays.from * l.cell;
      const r1 = r0 + (P.rays.len[0] + (P.rays.len[1] - P.rays.len[0]) * flick) * l.cell;
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      const lg = ctx.createLinearGradient(x + ux * r0, y + uy * r0, x + ux * r1, y + uy * r1);
      lg.addColorStop(0, rgba(col, 0.9 * a));
      lg.addColorStop(1, rgba(col, 0));
      ctx.globalAlpha = k * P.rays.alpha * (0.5 + 0.5 * flick);
      ctx.strokeStyle = lg;
      ctx.beginPath();
      ctx.moveTo(x + ux * r0, y + uy * r0);
      ctx.lineTo(x + ux * r1, y + uy * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export interface PieceView {
  mirrorAngle: (i: number) => number; // i = índice da peça móvel; radianos ('/' = -45°)
  filterColor: (i: number) => { from: number; to: number; k: number }; // índices em FILTER_COLORS
  targetFill: (x: number, y: number) => number; // 0..1
  targetReceived: (x: number, y: number) => number; // OR das cores chegando agora
  prismAngle: (ci: number) => number; // ci = índice da célula; direção da ponta (radianos, y para baixo)
  gateOpen: (id: number) => boolean;
  bender: (i: number) => { from: number; to: number; k: number }; // polaridade do ímã (0/1) animando
  charge: (x: number, y: number, ms: number) => number; // 0..1, carga do alvo
  autoPhase: number; // 0..1 até o próximo giro dos espelhos automáticos
  darkHit: (x: number, y: number) => boolean; // anti-alvo recebendo luz proibida
  time: number; // segundos
}

const COMPONENTS = [1, 2, 4] as const;

// Alvo: anel na cor exigida. Mistura que chega aparece como disco no meio.
// Faltando cor: disco pequeno e calmo. Cor errada (sobra componente): disco + X e anel tracejado tremendo.
function drawTarget(ctx: Ctx, x: number, y: number, r: number, need: Color, got: number, fill: number, time: number): void {
  const col = CONFIG.colors[need];
  const wrong = (got & ~need) !== 0;
  const jx = wrong ? Math.sin(time * 38) * r * 0.05 : 0;
  ctx.lineWidth = CONFIG.piece.stroke * 1.5;

  // Aceso: brilho macio na cor do alvo, para ele ler "amarelo" (ou rosa, ciano...) de longe.
  if (fill > 0) {
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 * fill;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.9, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  if (wrong) {
    ctx.strokeStyle = col;
    ctx.setLineDash([r * 0.42, r * 0.28]);
    ctx.lineDashOffset = time * r * 2;
    ctx.beginPath();
    ctx.arc(x + jx, y, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    // Cor misturada: anel interno em arcos das cores que a formam (vermelho + verde dentro do amarelo).
    // Some conforme o alvo enche.
    const comps = COMPONENTS.filter((c) => (need & c) !== 0);
    if (comps.length > 1 && fill < 1) {
      const n = comps.length * 2;
      const gap = 0.35;
      ctx.lineWidth = CONFIG.piece.stroke * 1.2;
      ctx.globalAlpha = 1 - fill;
      // Cores que já estão chegando ficam em destaque (mais fortes e grossas); as que faltam, apagadas.
      for (let i = 0; i < n; i++) {
        const c = comps[i % comps.length]!;
        const on = (got & c) !== 0;
        const a0 = -Math.PI / 2 + (i * TAU) / n + gap / 2;
        ctx.globalAlpha = (1 - fill) * (on ? 1 : 0.4);
        ctx.lineWidth = CONFIG.piece.stroke * (on ? 1.8 : 1.1);
        ctx.strokeStyle = CONFIG.colors[c];
        ctx.beginPath();
        ctx.arc(x, y, r * 0.58, a0, a0 + TAU / n - gap);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = CONFIG.piece.stroke * 1.5;
    }
  }
  if (wrong) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = CONFIG.colors[got as Color];
    ctx.beginPath();
    ctx.arc(x + jx, y, r * 0.55, 0, TAU);
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
  // tinted: corpo pintado da cor que emite (escurecida), contorno na cor; lente clareada.
  ctx.fillStyle = E.tinted ? mix(E.fill, col, 0.38) : E.fill;
  ctx.strokeStyle = E.tinted ? col : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = CONFIG.piece.stroke;
  ctx.beginPath();
  ctx.roundRect(-b, -b, b * 2, b * 2, b * E.radius);
  ctx.fill();
  ctx.stroke();

  const t = E.lens * c;
  ctx.fillStyle = E.tinted ? mix(col, '#ffffff', 0.55) : col;
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

// Trilho da peça arrastável: cápsula contornada cobrindo as células por onde ela desliza, com um pontinho
// em cada parada. Desenhado por cima dos feixes (senão some quando a luz passa ao longo dele) e por baixo da peça.
// Peças ligadas (giram juntas): fio pontilhado fino entre elas e um pontinho no centro de cada uma.
export function drawLinks(ctx: Ctx, l: Layout, cells: Cell[]): void {
  const K = CONFIG.link;
  const groups = new Map<number, Cell[]>();
  for (const c of cells) {
    const id = c.t === 'mirror' || c.t === 'splitter' || c.t === 'dichroic' ? c.link : undefined;
    if (id !== undefined) groups.set(id, [...(groups.get(id) ?? []), c]);
  }
  ctx.save();
  for (const [id, g] of groups) {
    const col = K.colors[id % K.colors.length]!;
    ctx.strokeStyle = col;
    ctx.globalAlpha = K.alpha;
    ctx.lineWidth = K.width;
    ctx.setLineDash(K.dash);
    ctx.beginPath();
    g.forEach((c, i) => (i === 0 ? ctx.moveTo(cx(l, c.x), cy(l, c.y)) : ctx.lineTo(cx(l, c.x), cy(l, c.y))));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    for (const c of g) {
      ctx.beginPath();
      ctx.arc(cx(l, c.x), cy(l, c.y), K.dotR * l.cell, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Fibra óptica: tubo curvo entre as duas pontas; com luz passando, brilha na cor dela.
export function drawFibers(ctx: Ctx, l: Layout, cells: Cell[], plan: BeamPlan, front: Front): void {
  const F = CONFIG.fiber;
  const pairs = new Map<number, Extract<Cell, { t: 'fiber' }>[]>();
  for (const c of cells) if (c.t === 'fiber') pairs.set(c.pair, [...(pairs.get(c.pair) ?? []), c]);
  ctx.save();
  ctx.lineCap = 'round';
  for (const [, ends] of pairs) {
    const [a, b] = ends;
    if (!a || !b) continue;
    const k = F.bend * l.cell;
    const back = (c: Extract<Cell, { t: 'fiber' }>): [number, number] => [-DELTA[c.dir][0], -DELTA[c.dir][1]];
    const [ax, ay] = [cx(l, a.x), cy(l, a.y)];
    const [bx, by] = [cx(l, b.x), cy(l, b.y)];
    const [abx, aby] = back(a);
    const [bbx, bby] = back(b);
    const curve = (): void => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(ax + abx * k, ay + aby * k, bx + bbx * k, by + bby * k, bx, by);
    };
    ctx.strokeStyle = F.tube;
    ctx.lineWidth = F.width * l.cell;
    curve();
    ctx.stroke();
    // Luz dentro: cor de quem chegou à boca (trecho terminando numa das pontas, já alcançado pela frente).
    let lit = 0;
    for (const p of plan.pieces) {
      if (!reachedEnd(p, front)) continue;
      if ((p.x2 === a.x && p.y2 === a.y) || (p.x2 === b.x && p.y2 === b.y)) lit |= p.color;
    }
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = CONFIG.colors[lit as Color];
      for (const [w, al] of F.glow) {
        ctx.globalAlpha = al;
        ctx.lineWidth = w * l.cell;
        curve();
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

export function drawRails(ctx: Ctx, l: Layout, cells: Cell[]): void {
  const R = CONFIG.rail;
  ctx.save();
  for (const c of cells) {
    if ((c.t !== 'mirror' && c.t !== 'prism') || !c.rail) continue;
    const n = c.rail.len - 1;
    const [dx, dy] = c.rail.axis === 'x' ? [1, 0] : [0, 1];
    const h = (R.width * l.cell) / 2;
    const x0 = cx(l, c.x) - h;
    const y0 = cy(l, c.y) - h;
    const w = dx * n * l.cell + 2 * h;
    const hh = dy * n * l.cell + 2 * h;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, hh, h);
    ctx.fillStyle = R.fill;
    ctx.fill();
    ctx.strokeStyle = R.color;
    ctx.lineWidth = R.line;
    ctx.stroke();
    ctx.fillStyle = R.dot;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.arc(cx(l, c.x + dx * i), cy(l, c.y + dy * i), R.dotR * l.cell, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
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
  for (const [ci, cell] of cells.entries()) {
    const x = cx(l, cell.x);
    const y = cy(l, cell.y);
    switch (cell.t) {
      case 'mirror': {
        // Espelho de vidro, como o prisma: placa fina e transparente com cantos quase retos, preenchida
        // por um degradê claro ao longo do comprimento (faixas mais e menos brilhantes, levemente azuladas)
        // e contorno fino. Referencial da peça: x = comprimento.
        const a = view.mirrorAngle(pi++);
        const M = CONFIG.mirror;
        const hl = (p.mirrorLen * c) / 2;
        const ht = (M.thick * c) / 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.roundRect(-hl, -ht, hl * 2, ht * 2, M.corner * c);
        // Fundo sólido: o vidro do espelho não deixa ver o feixe por dentro.
        ctx.fillStyle = M.base;
        ctx.fill();
        const glass = ctx.createLinearGradient(-hl, -ht, hl, ht);
        for (const [at, alpha] of M.glass) glass.addColorStop(at, `rgba(${M.tint},${alpha})`);
        ctx.fillStyle = glass;
        ctx.fill();
        ctx.globalAlpha = M.edgeAlpha;
        ctx.strokeStyle = `rgb(${M.tint})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        if (cell.auto) {
          // Automático: anel fino em volta que vai se fechando até o próximo giro.
          const A = CONFIG.auto;
          ctx.globalAlpha = 0.25;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, A.ring * c, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = A.color;
          ctx.beginPath();
          ctx.arc(x, y, A.ring * c, -Math.PI / 2, -Math.PI / 2 + TAU * view.autoPhase);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'dichroic': {
        // Espelho dicroico: placa de vidro tingida na cor que reflete, face espelhada nessa cor e verso claro.
        const a = view.mirrorAngle(pi++);
        const col = CONFIG.colors[cell.color];
        const r = (p.mirrorLen * c) / 2;
        const ux = Math.cos(a) * r;
        const uy = Math.sin(a) * r;
        const t = p.splitterGap * c * 1.2;
        const nx = -Math.sin(a) * t;
        const ny = Math.cos(a) * t;
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x - ux + nx, y - uy + ny);
        ctx.lineTo(x + ux + nx, y + uy + ny);
        ctx.lineTo(x + ux - nx, y + uy - ny);
        ctx.lineTo(x - ux - nx, y - uy - ny);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col;
        ctx.lineWidth = p.stroke;
        ctx.beginPath();
        ctx.moveTo(x - ux + nx, y - uy + ny);
        ctx.lineTo(x + ux + nx, y + uy + ny);
        ctx.stroke();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - ux - nx, y - uy - ny);
        ctx.lineTo(x + ux - nx, y + uy - ny);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = p.stroke;
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
        // Bloco: placa lisa e escura com contorno fino, no mesmo estilo do lançador (sem degradê nem sombra).
        const s = p.wallSize * c;
        ctx.fillStyle = CONFIG.emitter.fill;
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.16);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'bender': {
        // Ímã: ferradura com polos vermelho e azul e uma seta curva mostrando para que lado a luz vira.
        // Trocar a polaridade espelha a ferradura (a seta inverte) com uma transição curta.
        const B = CONFIG.bender;
        const st = view.bender(pi++);
        const flip = st.from + (st.to - st.from) * st.k; // 0 = esquerda, 1 = direita
        const sx = 1 - 2 * flip;
        const r = B.radius * c;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(sx === 0 ? 0.001 : sx, 1);
        ctx.lineCap = 'round';
        ctx.lineWidth = B.width * c;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(0, 0, r, Math.PI * 0.75, Math.PI * 2.25);
        ctx.stroke();
        for (const [ang, col] of [[Math.PI * 0.75, CONFIG.colors[1]], [Math.PI * 2.25, CONFIG.colors[4]]] as const) {
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.arc(0, 0, r, ang - 0.12, ang + 0.12);
          ctx.stroke();
        }
        // Seta curva (virando à esquerda no referencial da peça).
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        const ar = r * 0.45;
        ctx.beginPath();
        ctx.arc(0, 0, ar, Math.PI * 0.1, Math.PI * 1.1, true);
        ctx.stroke();
        const ex = Math.cos(Math.PI * 1.1) * ar;
        const ey = Math.sin(Math.PI * 1.1) * ar;
        ctx.beginPath();
        ctx.moveTo(ex - ar * 0.35, ey - ar * 0.05);
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex + ar * 0.1, ey - ar * 0.4);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'combiner': {
        // Lente que funde: anel de vidro com uma seta apontando a saída; gira de 90° em 90°.
        const a = view.mirrorAngle(pi++) - Math.PI / 2;
        const r = CONFIG.combiner.radius * c;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.28)');
        g.addColorStop(1, 'rgba(255,255,255,0.05)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.stroke();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(-r * 0.35, -r * 0.45);
        ctx.lineTo(r * 0.55, 0);
        ctx.lineTo(-r * 0.35, r * 0.45);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'shifter': {
        // Cristal: losango de vidro com três pontinhos R, G, B girando devagar (a cor muda ao passar).
        const r = CONFIG.shifter.radius * c;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const t = (k * TAU) / 6 + Math.PI / 6;
          ctx.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.stroke();
        const spin = view.time * CONFIG.shifter.spin;
        ([1, 2, 4] as const).forEach((col, k) => {
          const t = spin + (k * TAU) / 3;
          ctx.fillStyle = CONFIG.colors[col];
          ctx.beginPath();
          ctx.arc(x + Math.cos(t) * r * 0.45, y + Math.sin(t) * r * 0.45, r * 0.16, 0, TAU);
          ctx.fill();
        });
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'diode': {
        // Diodo: placa fina atravessada por uma seta no sentido em que a luz pode passar.
        const [ddx, ddy] = DELTA[cell.dir];
        const a = Math.atan2(ddy, ddx);
        const r = CONFIG.diode.size * c;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, -r);
        ctx.lineTo(r * 0.4, 0);
        ctx.lineTo(-r * 0.6, r);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(r * 0.55, -r);
        ctx.lineTo(r * 0.55, r);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'portal': {
        // Portal: anel duplo na cor do par, miolo escuro (a luz some aqui e reaparece no outro).
        const col = CONFIG.portal.colors[cell.pair % CONFIG.portal.colors.length]!;
        const r = CONFIG.portal.radius * c;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(5,5,10,0.95)');
        g.addColorStop(0.7, 'rgba(5,5,10,0.85)');
        g.addColorStop(1, col);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.55, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'sensor': {
        // Sensor: losango na sua cor; aceso, preenche e brilha (abre as portas de mesmo número).
        const col = CONFIG.colors[cell.color];
        const r = CONFIG.sensor.size * c;
        const on = (view.targetReceived(cell.x, cell.y) & cell.color) === cell.color;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        if (on) {
          ctx.shadowColor = col;
          ctx.shadowBlur = 14;
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'gate': {
        // Porta: bloco com grade de barras na cor do sensor dela; aberta, só o contorno tracejado.
        const sensor = cells.find((q) => q.t === 'sensor' && q.gate === cell.id);
        const col = sensor?.t === 'sensor' ? CONFIG.colors[sensor.color] : '#ffffff';
        const s = p.wallSize * c;
        const open = view.gateOpen(cell.id);
        ctx.beginPath();
        ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.16);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        if (open) {
          ctx.globalAlpha = 0.35;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = CONFIG.emitter.fill;
          ctx.fill();
          ctx.globalAlpha = 0.9;
          ctx.stroke();
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          for (let k = 1; k <= 3; k++) {
            const bx = x - s / 2 + (s * k) / 4;
            ctx.moveTo(bx, y - s * 0.32);
            ctx.lineTo(bx, y + s * 0.32);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'dark': {
        // Anti-alvo: buraco escuro com anel tracejado na cor proibida (branco = qualquer luz) e um traço
        // cortando. Atingido: o anel pisca forte, a fase não fecha enquanto a luz chegar aqui.
        const col = cell.color === undefined ? '#ffffff' : CONFIG.colors[cell.color];
        const r = p.ringRadius * c;
        const hit = view.darkHit(cell.x, cell.y);
        ctx.fillStyle = 'rgba(3,3,6,0.92)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = hit ? 2.5 : 1.5;
        ctx.globalAlpha = hit ? 0.6 + 0.4 * Math.sin(view.time * 20) : 0.75;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x - r * 0.55, y + r * 0.55);
        ctx.lineTo(x + r * 0.55, y - r * 0.55);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'target': {
        drawTarget(ctx, x, y, p.ringRadius * c, cell.color, view.targetReceived(cell.x, cell.y), view.targetFill(cell.x, cell.y), view.time);
        if (cell.charge) {
          // Carga: quatro tracinhos em volta (marca de alvo que precisa de tempo) e um arco que enche.
          const R = p.ringRadius * c * 1.35;
          const col = CONFIG.colors[cell.color];
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.5;
          for (let k = 0; k < 4; k++) {
            const t = (k * Math.PI) / 2 + Math.PI / 4;
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(t) * R, y + Math.sin(t) * R);
            ctx.lineTo(x + Math.cos(t) * R * 1.15, y + Math.sin(t) * R * 1.15);
            ctx.stroke();
          }
          const k = view.charge(cell.x, cell.y, cell.charge);
          if (k > 0) {
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + TAU * k);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.lineWidth = p.stroke;
        }
        ctx.strokeStyle = p.color;
        break;
      }
      case 'well': {
        // Lente gravitacional: miolo escuro com anéis finos que se apertam para o centro (puxa a luz).
        const W2 = CONFIG.well;
        const r = W2.radius * c;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.55, 'rgba(10,6,24,0.9)');
        g.addColorStop(1, 'rgba(120,90,255,0.0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = W2.color;
        ctx.lineWidth = 1;
        for (let k = 1; k <= 3; k++) {
          const pulse = (view.time * W2.speed + k / 3) % 1; // anéis encolhendo devagar até o centro
          ctx.globalAlpha = 0.5 * pulse;
          ctx.beginPath();
          ctx.arc(x, y, r * (1 - pulse * 0.7), 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'fiber': {
        // Ponta da fibra: boca em U aberta para a direção dir (por onde a luz entra e sai).
        const [ddx, ddy] = DELTA[cell.dir];
        const a = Math.atan2(ddy, ddx);
        const r = CONFIG.fiber.mouth * c;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.strokeStyle = CONFIG.fiber.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(r, -r);
        ctx.lineTo(-r * 0.6, -r);
        ctx.arc(-r * 0.6, 0, r, -Math.PI / 2, Math.PI / 2, true);
        ctx.lineTo(r, r);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.stroke;
        break;
      }
      case 'emitter':
        drawEmitter(ctx, x, y, c, cell.dir, cell.color, view.time);
        ctx.strokeStyle = p.color;
        ctx.fillStyle = p.color;
        break;
      case 'prism': {
        const s = p.prismSize * c;
        if (cell.rail) pi++;
        const a = view.prismAngle(ci);
        const tri = (r: number): void => {
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const t = a + (k * 2 * Math.PI) / 3;
            ctx.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
          }
          ctx.closePath();
        };
        const tipX = x + Math.cos(a) * s;
        const tipY = y + Math.sin(a) * s;
        const t1 = a + (2 * Math.PI) / 3;
        const ex = x + Math.cos(t1) * s;
        const ey = y + Math.sin(t1) * s;
        // Vidro: degradê claro saindo da face do reflexo e sumindo na direção do vértice oposto,
        // com uma faixa de brilho no meio (sheen), tudo bem transparente.
        const t2 = a - (2 * Math.PI) / 3;
        const ox = x + Math.cos(t2) * s;
        const oy = y + Math.sin(t2) * s;
        const glass = ctx.createLinearGradient((tipX + ex) / 2, (tipY + ey) / 2, ox, oy);
        // Sempre claro até o vértice oposto (sem trecho escuro, que sumia no fundo e parecia faltar a ponta).
        glass.addColorStop(0, 'rgba(255,255,255,0.5)');
        glass.addColorStop(0.3, 'rgba(255,255,255,0.16)');
        glass.addColorStop(0.5, 'rgba(255,255,255,0.32)');
        glass.addColorStop(0.7, 'rgba(255,255,255,0.14)');
        glass.addColorStop(1, 'rgba(255,255,255,0.22)');
        tri(s);
        ctx.fillStyle = glass;
        ctx.fill();
        tri(s);
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
