import type { Level } from './core/types.ts';
import { Game } from './game.ts';
import { onTap } from './input.ts';
import levelsJson from './levels/levels.json';
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
const urlLevel = Number(params.get('level'));
game.load(Number.isInteger(urlLevel) && urlLevel > 0 ? urlLevel - 1 : save.level);

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

onTap(canvas, (x, y) => game.tap(x, y));

let last = performance.now();
function frame(t: number): void {
  game.update(Math.min(100, t - last));
  last = t;
  game.render(ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
