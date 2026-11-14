import type { Game } from './game.ts';
import { logoSvg } from './logo.ts';

type Screen = 'home' | 'levels' | null;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

// Menus em HTML por cima do canvas: o jogo continua desenhando atrás, desfocado.
export function setupMenu(game: Game, startOnHome: boolean): void {
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
    menuBtn.setAttribute('aria-expanded', String(open));
  };

  const show = (s: Screen): void => {
    if (s === 'levels') back = screen;
    screen = s;
    home.hidden = s !== 'home';
    levels.hidden = s !== 'levels';
    menuBtn.hidden = s !== null;
    setMini(false);
    game.synth.setMusic(s !== null);
    if (s === 'home') $('#play-sub').textContent = `level ${game.current + 1}`;
    if (s === 'levels') renderGrid();
  };

  function renderGrid(): void {
    const open = game.unlocked;
    $('#progress').textContent = `${game.done.size}/${game.count}`;
    grid.replaceChildren(
      ...Array.from({ length: game.count }, (_, i) => {
        const b = document.createElement('button');
        b.className = 'lvl';
        b.textContent = String(i + 1);
        b.style.setProperty('--c', `hsl(${(game.difficulty(i) - 1) * 60}, 90%, 64%)`);
        if (game.done.has(i)) b.classList.add('done');
        else if (i <= open) b.classList.add('open');
        else b.classList.add('locked');
        if (i === game.current) b.classList.add('current');
        b.setAttribute('aria-label', `Level ${i + 1}${game.done.has(i) ? ', completed' : i > open ? ', locked' : ''}`);
        b.addEventListener('click', () => {
          game.synth.uiSelect();
          game.load(i);
          show(null);
        });
        return b;
      }),
    );
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
      if (mini.hidden || $('#mini-panel').contains(t) || menuBtn.contains(t)) return;
      setMini(false);
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true },
  );

  show(startOnHome ? 'home' : null);
}
