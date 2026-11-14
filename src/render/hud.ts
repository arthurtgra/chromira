import { CONFIG } from '../config.ts';
import type { Layout } from './layout.ts';

export interface HudState {
  level: number;
  difficulty: number; // 1..5
  appear: number; // ms desde que a fase abriu
  win: number; // 0..1, cresce na vitória
  rainbow: number; // 0..1
  time: number; // segundos
  accent: string; // cor dominante da fase
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

// Número fino grande com degradê branco → cor da fase sobre halo macio, e barrinhas de dificuldade.
export function drawHud(ctx: CanvasRenderingContext2D, l: Layout, s: HudState): void {
  const H = CONFIG.hud;
  const k = easeOutCubic(clamp01(s.appear / H.appearMs));
  const x = l.w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Halo atrás do número: acende forte quando a fase abre, assenta, e volta a acender na vitória.
  const G = H.glow;
  const flare = G.flare * Math.exp(-s.appear / G.decayMs);
  const ga = G.rest * k + flare + G.win * s.win;
  ctx.save();
  ctx.translate(x, H.y + G.dy);
  ctx.scale(G.w / G.h, 1);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, G.h);
  halo.addColorStop(0, s.accent);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, ga);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, G.h, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Número: sobe e aparece; pulso na vitória.
  const scale = (1 + H.winScale * s.win) * (1 + H.breathe * Math.sin(s.time * 2));
  const y = H.y + 10 * (1 - k);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = `${H.numberWeight} ${H.numberPx}px ${H.family}`;
  const text = String(s.level);
  const half = H.numberPx / 2;
  let fill: CanvasGradient;
  if (s.rainbow > 0) {
    const w = ctx.measureText(text).width;
    fill = ctx.createLinearGradient(-w / 2, -half, w / 2, half);
    const shift = (s.time * 40) % 360;
    for (let i = 0; i <= 4; i++) {
      fill.addColorStop(i / 4, `hsl(${(shift + i * 70) % 360}, ${Math.round(85 * s.rainbow)}%, ${92 - 14 * s.rainbow}%)`);
    }
  } else {
    fill = ctx.createLinearGradient(0, -half, 0, half);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(1, s.accent);
  }
  ctx.globalAlpha = k;
  ctx.shadowColor = s.accent;
  ctx.shadowBlur = 18 + 30 * s.win;
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();

  // Dificuldade: 5 barrinhas; cheias até o nível, em tons do espectro.
  const n = 5;
  const total = n * H.barW + (n - 1) * H.barGap;
  for (let i = 0; i < n; i++) {
    const a = clamp01((s.appear - 200 - i * 60) / 220);
    const on = i < s.difficulty;
    const bx = x - total / 2 + i * (H.barW + H.barGap);
    const w = H.barW * a;
    ctx.globalAlpha = on ? 0.95 : 0.16;
    ctx.fillStyle = on ? `hsl(${i * 60}, 90%, 64%)` : '#ffffff';
    ctx.beginPath();
    ctx.roundRect(bx + (H.barW - w) / 2, H.barY - H.barH / 2, w, H.barH, H.barH / 2);
    ctx.fill();
  }
  ctx.restore();
}
