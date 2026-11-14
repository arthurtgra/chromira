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

// Rótulo "FASE" espaçado, número fino grande com degradê branco → cor da fase, filete e barrinhas de dificuldade.
export function drawHud(ctx: CanvasRenderingContext2D, l: Layout, s: HudState): void {
  const H = CONFIG.hud;
  const k = easeOutCubic(clamp01(s.appear / H.appearMs));
  const x = l.w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // FASE
  ctx.font = `600 ${H.labelPx}px ${H.family}`;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.4 * k;
  const label = 'FASE';
  const widths = [...label].map((ch) => ctx.measureText(ch).width);
  const lw = widths.reduce((a, b) => a + b, 0) + H.labelSpacing * (label.length - 1);
  let lx = x - lw / 2;
  [...label].forEach((ch, i) => {
    ctx.fillText(ch, lx + widths[i]! / 2, H.labelY);
    lx += widths[i]! + H.labelSpacing;
  });

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

  // Filete: linha fina que abre do centro, sumindo nas pontas.
  const lineY = (H.y + H.barY) / 2 + 6;
  const half2 = 34 * k;
  const g = ctx.createLinearGradient(x - half2, 0, x + half2, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, s.accent);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = g;
  ctx.fillRect(x - half2, lineY, half2 * 2, 1);

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
