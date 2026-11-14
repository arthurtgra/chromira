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

const easeOutBack = (t: number): number => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export function drawHud(ctx: CanvasRenderingContext2D, l: Layout, s: HudState): void {
  const H = CONFIG.hud;
  const k = clamp01(s.appear / H.appearMs);
  const scale =
    (k < 1 ? 0.4 + 0.6 * easeOutBack(k) : 1) * (1 + H.winScale * s.win) * (1 + H.breathe * Math.sin(s.time * 2));
  const x = l.w / 2;
  const y = H.y;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.25 + 0.75 * k;
  ctx.font = H.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = String(s.level);
  const w = ctx.measureText(text).width;

  let fill: string | CanvasGradient = '#ffffff';
  if (s.rainbow > 0) {
    const g = ctx.createLinearGradient(-w / 2 - 20, 0, w / 2 + 20, 0);
    const shift = (s.time * 60) % 360;
    for (let i = 0; i <= 6; i++) {
      const light = 100 - 32 * s.rainbow;
      g.addColorStop(i / 6, `hsl(${(shift + i * 50) % 360}, ${Math.round(100 * s.rainbow)}%, ${light}%)`);
    }
    fill = g;
  }
  ctx.shadowColor = s.accent;
  ctx.shadowBlur = 14 + 26 * s.win;
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Marcadores de dificuldade: losangos cheios até o nível, coloridos pelo espectro.
  ctx.save();
  const n = 5;
  const total = (n - 1) * H.pipGap;
  for (let i = 0; i < n; i++) {
    const px = x - total / 2 + i * H.pipGap;
    const appearI = clamp01((s.appear - 250 - i * 70) / 200);
    const r = H.pipSize * (0.4 + 0.6 * appearI);
    const on = i < s.difficulty;
    const hue = i * 65;
    ctx.globalAlpha = on ? 0.95 * appearI : 0.25 * appearI;
    ctx.beginPath();
    ctx.moveTo(px, H.pipY - r);
    ctx.lineTo(px + r, H.pipY);
    ctx.lineTo(px, H.pipY + r);
    ctx.lineTo(px - r, H.pipY);
    ctx.closePath();
    if (on) {
      ctx.fillStyle = `hsl(${hue}, 95%, 62%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.fill();
    } else {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}
