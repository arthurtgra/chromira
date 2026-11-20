import { CONFIG, difficultyHue } from '../config.ts';
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

// Número fino grande com degradê branco → cor da fase e barrinhas de dificuldade.
export function drawHud(ctx: CanvasRenderingContext2D, l: Layout, s: HudState): void {
  const H = CONFIG.hud;
  const k = easeOutCubic(clamp01(s.appear / H.appearMs));
  const x = l.w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

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
  // Brilho borrado em volta do número: contornos largos e fracos na cor da fase, do mais largo ao mais
  // fino (sem shadowBlur: no Safari do iPhone a sombra do texto saía deslocada, uma faixa embaixo).
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.accent;
  ctx.globalAlpha = k * H.glow.alpha;
  for (let i = 0; i < H.glow.steps; i++) {
    ctx.lineWidth = H.glow.width * (1 - i / H.glow.steps);
    ctx.strokeText(text, 0, 0);
  }
  ctx.globalAlpha = k;
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();

  // Dificuldade: só as barrinhas do nível (sem as apagadas), centralizadas, em tons do espectro.
  const n = Math.max(1, Math.min(5, s.difficulty));
  const total = n * H.barW + (n - 1) * H.barGap;
  for (let i = 0; i < n; i++) {
    const a = clamp01((s.appear - 200 - i * 60) / 220);
    const bx = x - total / 2 + i * (H.barW + H.barGap);
    const w = H.barW * a;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = `hsl(${difficultyHue(i + 1)}, 90%, 64%)`;
    ctx.beginPath();
    ctx.roundRect(bx + (H.barW - w) / 2, H.barY - H.barH / 2, w, H.barH, H.barH / 2);
    ctx.fill();
  }
  ctx.restore();
}
