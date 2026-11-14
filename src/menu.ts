import type { Game } from './game.ts';
import { logoSvg } from './logo.ts';

type Screen = 'home' | 'levels' | null;

// Capítulos da tela de fases: [primeira fase (1-based), nome]. Seguem as faixas do gen-levels.
const CHAPTERS: [number, string][] = [
  [1, 'First light'],
  [12, 'Mixing'],
  [24, 'Filters'],
  [33, 'Prisms'],
  [41, 'Blends'],
  [51, 'Splitters'],
  [61, 'Everything'],
  [71, 'Rails'],
  [81, 'Dichroic'],
];

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

// Menus em HTML por cima do canvas: o jogo continua desenhando atrás, desfocado.
export function setupMenu(game: Game, startOnHome: boolean, mark?: (i: number) => string | undefined): void {
  const home = $<HTMLElement>('#home');
  const levels = $<HTMLElement>('#levels');
  const mini = $<HTMLElement>('#mini');
  const menuBtn = $<HTMLButtonElement>('#menu-btn');
  const grid = $<HTMLElement>('#grid');
  let screen: Screen = null;
  $('#logo').innerHTML = logoSvg();
  let back: Screen = null;

  const setMini = (open: boolean): void => {
    mini.hidden = !open;
    if (open) {
      $('#mini-panel').hidden = false;
      $('#dev-panel').hidden = true;
    }
    menuBtn.setAttribute('aria-expanded', String(open));
  };

  const show = (s: Screen): void => {
    if (s === 'levels') back = screen;
    screen = s;
    home.hidden = s !== 'home';
    levels.hidden = s !== 'levels';
    menuBtn.hidden = s !== null;
    document.body.dataset.screen = s ?? 'game';
    setMini(false);
    game.synth.setMusic(s !== null);
    if (s === 'home') $('#play-sub').textContent = `level ${game.current + 1}`;
    if (s === 'levels') renderGrid();
  };

  function renderGrid(): void {
    const open = game.unlocked;
    $('#progress').textContent = `${game.done.size}/${game.count}`;
    const tiles = Array.from({ length: game.count }, (_, i) => {
        const b = document.createElement('button');
        b.className = 'lvl';
        b.textContent = String(i + 1);
        b.style.setProperty('--c', `hsl(${(game.difficulty(i) - 1) * 60}, 90%, 64%)`);
        if (game.done.has(i)) b.classList.add('done');
        else if (i <= open) b.classList.add('open');
        else b.classList.add('locked');
        if (i === game.current) b.classList.add('current');
        const m = mark?.(i);
        if (m) b.classList.add(`fb-${m}`);
        b.setAttribute('aria-label', `Level ${i + 1}${game.done.has(i) ? ', completed' : i > open ? ', locked' : ''}`);
        b.addEventListener('click', () => {
          game.synth.uiSelect();
          game.load(i);
          show(null);
        });
        return b;
    });
    const items: HTMLElement[] = [];
    for (const [ci, [from, name]] of CHAPTERS.entries()) {
      const to = Math.min(game.count, (CHAPTERS[ci + 1]?.[0] ?? game.count + 1) - 1);
      if (from > game.count) break;
      let done = 0;
      for (let i = from - 1; i < to; i++) if (game.done.has(i)) done++;
      const h = document.createElement('div');
      h.className = 'chapter';
      h.innerHTML = `<span class="ch-name"></span><span class="ch-line"></span><span class="ch-count"></span>`;
      h.querySelector('.ch-name')!.textContent = name;
      h.querySelector('.ch-count')!.textContent = `${done}/${to - from + 1}`;
      if (done === to - from + 1) h.classList.add('complete');
      items.push(h, ...tiles.slice(from - 1, to));
    }
    grid.replaceChildren(...items);
    grid.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-go]')) {
    el.addEventListener('click', () => {
      game.synth.uiTap();
      const go = el.dataset.go;
      if (go === 'levels') show('levels');
      else if (go === 'home') show('home');
      else if (go === 'back') show(back);
      else if (go === 'close') setMini(false);
    });
  }
  $('#play').addEventListener('click', () => {
    game.synth.uiSelect();
    show(null);
  });
  menuBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  menuBtn.addEventListener('click', () => {
    game.synth.uiTap();
    setMini(Boolean(mini.hidden));
  });
  // Toque fora do painel fecha o mini menu (sem girar peça por baixo).
  window.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target as Node;
      if (mini.hidden || (t as Element).closest?.('.panel') || menuBtn.contains(t)) return;
      setMini(false);
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true },
  );

  show(startOnHome ? 'home' : null);
}
