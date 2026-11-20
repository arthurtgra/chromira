import type { Level } from './core/types.ts';
import { Game } from './game.ts';
import { onPointer } from './input.ts';
import { CONFIG } from './config.ts';
import levelsJson from './levels/levels.json';
import { Feedback, feedbackEnabled, setupDev, setupFeedback } from './feedback.ts';
import { setupMenu } from './menu.ts';
import { applyEdits, EDIT_ICON, setupEditor } from './editor.ts';
import { loadSave } from './save.ts';
import '@fontsource-variable/outfit';
import './style.css';

const levels = levelsJson as unknown as Level[];
const original = structuredClone(levels); // versão gerada, para "Revert" no editor
applyEdits(levels); // edits.json + fases editadas guardadas neste aparelho
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const muteBtn = document.querySelector<HTMLButtonElement>('#mute')!;
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
// Restos de versões antigas (?feedback=1) saem da barra de endereço.
if (params.has('feedback')) {
  params.delete('feedback');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
}
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
const ed = fb
  ? setupEditor(game, original, (on) => {
      // A barra do editor ocupa mais espaço embaixo: a grade encolhe enquanto ele está aberto.
      (CONFIG.layout as { bottom: number }).bottom = on ? 205 : 80;
      game.relayout();
    })
  : null;
if (fb && ed) {
  const { refresh } = setupFeedback(game, fb);
  game.onLoad = refresh;
  // Lápis na barra do desenvolvedor: entra no modo de edição da fase atual.
  const edit = document.createElement('button');
  edit.setAttribute('aria-label', 'Edit level');
  edit.innerHTML = EDIT_ICON;
  edit.addEventListener('pointerdown', (e) => e.stopPropagation());
  edit.addEventListener('click', () => {
    game.synth.uiTap();
    ed.toggle();
  });
  document.querySelector('#fb')!.prepend(edit);
}

function resize(): void {
  // Densidade limitada: iPhone tem 3x; 2x é quase igual na tela e desenha ~55% menos pixels.
  const dpr = Math.min(CONFIG.maxDpr, window.devicePixelRatio || 1);
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
  down: (x, y) => (game.editing && ed ? ed.editor.press(x, y) : game.press(x, y)),
  move: (x, y) => (game.editing && ed ? ed.editor.dragTo(x, y) : game.dragTo(x, y)),
  up: () => (game.editing && ed ? ed.editor.release() : game.release()),
});

// Em tela de toque, pointerdown não conta como gesto para liberar áudio; pointerup/touchend contam.
// Android (tela cheia / app instalado) aceita travar em retrato; nos outros a tela #rotate cobre o jogo.
const lockPortrait = (): void => {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  o.lock?.('portrait').catch(() => {});
};
window.addEventListener('pointerup', lockPortrait, { once: true });

// Setas ao lado do número: anterior sempre que houver; seguinte só se já estiver liberada (no modo
// desenvolvedor todas estão). Escondidas durante a edição.
const prev = document.querySelector<HTMLButtonElement>('#prev')!;
const next = document.querySelector<HTMLButtonElement>('#next')!;
document.documentElement.style.setProperty('--hud-y', `${CONFIG.hud.y}px`);
document.documentElement.style.setProperty('--step-dx', `${CONFIG.hud.stepDx}px`);
for (const [btn, d] of [
  [prev, -1],
  [next, 1],
] as const) {
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    const i = game.current + d;
    if (i < 0 || i > game.unlocked) return;
    game.synth.uiTap();
    game.load(i);
  });
}
function updateSteps(): void {
  const busy = game.editing || game.won;
  prev.hidden = busy || game.current <= 0;
  next.hidden = busy || game.current >= game.unlocked;
}
void document.fonts.load(`${CONFIG.hud.numberWeight} ${CONFIG.hud.numberPx}px "Outfit Variable"`);

for (const ev of ['pointerup', 'touchend', 'click', 'keydown'] as const) {
  window.addEventListener(ev, () => game.synth.unlock(), { capture: true, passive: true });
}

let last = performance.now();
function frame(t: number): void {
  // No máximo 60 quadros por segundo (a folga de 2 ms absorve a variação do intervalo numa tela de 60 Hz).
  if (t - last < 1000 / CONFIG.maxFps - 2) {
    requestAnimationFrame(frame);
    return;
  }
  game.update(Math.min(100, t - last));
  last = t;
  game.render(ctx);
  updateSteps();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
