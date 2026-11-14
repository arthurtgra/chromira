import type { Level } from './core/types.ts';
import { Game } from './game.ts';
import { onPointer } from './input.ts';
import { CONFIG } from './config.ts';
import levelsJson from './levels/levels.json';
import { Feedback, feedbackEnabled, setupDev, setupFeedback } from './feedback.ts';
import { setupMenu } from './menu.ts';
import { loadSave } from './save.ts';
import './style.css';

const levels = levelsJson as unknown as Level[];
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const muteBtn = document.querySelector<HTMLButtonElement>('#mute')!;
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
const save = loadSave();
const game = new Game(levels);
game.debug = params.get('debug') === '1';
game.synth.muted = save.muted;
for (const d of save.done) game.done.add(d);
const urlLevel = Number(params.get('level'));
const fromUrl = Number.isInteger(urlLevel) && urlLevel > 0;
const fb = feedbackEnabled() ? new Feedback() : null;
game.unlockAll = fb !== null;
if (fb) (CONFIG.layout as { bottom: number }).bottom = 80; // espaço para a barra de feedback no canto inferior
game.load(fromUrl ? urlLevel - 1 : save.level);
setupMenu(game, !fromUrl, fb ? (i) => fb.vote(i) : undefined);
setupDev(game);
if (fb) {
  const { refresh } = setupFeedback(game, fb);
  game.onLoad = refresh;
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

function renderMute(): void {
  muteBtn.classList.toggle('muted', game.synth.muted);
  muteBtn.setAttribute('aria-pressed', String(game.synth.muted));
}
muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
muteBtn.addEventListener('click', () => {
  game.synth.unlock();
  game.setMuted(!game.synth.muted);
  renderMute();
});
renderMute();

onPointer(canvas, {
  down: (x, y) => game.press(x, y),
  move: (x, y) => game.dragTo(x, y),
  up: () => game.release(),
});

// Em tela de toque, pointerdown não conta como gesto para liberar áudio; pointerup/touchend contam.
// Android (tela cheia / app instalado) aceita travar em retrato; nos outros a tela #rotate cobre o jogo.
const lockPortrait = (): void => {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  o.lock?.('portrait').catch(() => {});
};
window.addEventListener('pointerup', lockPortrait, { once: true });

for (const ev of ['pointerup', 'touchend', 'click', 'keydown'] as const) {
  window.addEventListener(ev, () => game.synth.unlock(), { capture: true, passive: true });
}

let last = performance.now();
function frame(t: number): void {
  game.update(Math.min(100, t - last));
  last = t;
  game.render(ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
