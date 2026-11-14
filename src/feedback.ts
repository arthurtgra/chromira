// Feedback de playtest: joinha / dislike / cortar por fase, guardado no aparelho e copiado como texto.
// Liga/desliga pelo menu Developer (com senha); o estado fica guardado no aparelho.
import type { Game } from './game.ts';

export type Vote = 'up' | 'down' | 'cut';

const KEY = 'chromira.feedback.v2';
const FLAG = 'chromira.feedback.on';

type Store = Record<string, { vote: Vote; id: number }>; // chave = número da fase (1-based)

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
  } catch {
    return {};
  }
}

function write(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // armazenamento bloqueado
  }
}

export function feedbackEnabled(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

// Só o hash fica no código. Não é segurança de verdade (o site é público), só tira a barra do caminho dos jogadores.
const PASS_HASH = 'a1878c173c3cb3e882a2024b8c34af657be6b0db9397e83868f1ac45cc38184d';

async function checkPassword(p: string): Promise<boolean> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`chromira:${p}`));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === PASS_HASH;
}

// Item "Developer" no mini menu: painel com senha para ligar/desligar o feedback de playtest.
export function setupDev(game: Game): void {
  const on = feedbackEnabled();
  const menu = document.querySelector<HTMLElement>('#mini-panel')!;
  const panel = document.querySelector<HTMLFormElement>('#dev-panel')!;
  const input = panel.querySelector<HTMLInputElement>('input')!;
  const submit = panel.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const msg = panel.querySelector<HTMLElement>('.dev-msg')!;
  // Ligar pede a senha; desligar não.
  input.hidden = on;
  submit.textContent = on ? 'Turn off' : 'Enter';

  const dev = document.createElement('button');
  dev.className = 'dev-item';
  dev.textContent = 'Developer';
  dev.addEventListener('click', () => {
    game.synth.uiTap();
    menu.hidden = true;
    panel.hidden = false;
    input.value = '';
    msg.textContent = '';
    if (!on) input.focus();
  });
  menu.append(dev);
  panel.querySelector<HTMLButtonElement>('.dev-back')!.addEventListener('click', () => {
    game.synth.uiTap();
    panel.hidden = true;
    menu.hidden = false;
  });

  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!on && !(await checkPassword(input.value))) {
      msg.textContent = 'Wrong password';
      input.select();
      return;
    }
    try {
      localStorage.setItem(FLAG, on ? '0' : '1');
    } catch {
      msg.textContent = 'Storage blocked';
      return;
    }
    location.reload();
  });
}

export class Feedback {
  private store = read();

  vote(i: number): Vote | undefined {
    return this.store[String(i + 1)]?.vote;
  }

  get cut(): Set<number> {
    return new Set(Object.entries(this.store).filter(([, v]) => v.vote === 'cut').map(([k]) => Number(k) - 1));
  }

  // Toque no mesmo voto desfaz.
  set(i: number, id: number, vote: Vote): void {
    const k = String(i + 1);
    if (this.store[k]?.vote === vote) delete this.store[k];
    else this.store[k] = { vote, id };
    write(this.store);
  }

  text(): string {
    const by = (v: Vote): string =>
      Object.entries(this.store)
        .filter(([, e]) => e.vote === v)
        .map(([k]) => Number(k))
        .sort((a, b) => a - b)
        .join(', ') || '-';
    return `Chromira feedback\nliked: ${by('up')}\ndisliked: ${by('down')}\ncut: ${by('cut')}`;
  }
}

const ICONS: Record<Vote, string> = {
  up: '<path d="M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.2 2.6L12.6 9H18a2 2 0 0 1 2 2.3l-1.2 6.6A2.5 2.5 0 0 1 16.3 20H7"/>',
  down: '<path d="M7 13V4H4v9zM7 13l4 8c1.5 0 2.5-1 2.2-2.6L12.6 15H18a2 2 0 0 0 2-2.3l-1.2-6.6A2.5 2.5 0 0 0 16.3 4H7"/>',
  cut: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function setupFeedback(game: Game, fb: Feedback): { refresh: () => void } {
  const bar = document.createElement('div');
  bar.id = 'fb';
  const buttons = (Object.keys(ICONS) as Vote[]).map((v) => {
    const b = document.createElement('button');
    b.dataset.vote = v;
    b.setAttribute('aria-label', v === 'up' ? 'Like level' : v === 'down' ? 'Dislike level' : 'Cut level');
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[v]}</svg>`;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => {
      game.synth.uiTap();
      const i = game.current;
      fb.set(i, game.levelId, v);
      game.skip = fb.cut;
      if (v === 'cut' && fb.vote(i) === 'cut') game.load(game.nextIndex(i));
      refresh();
    });
    bar.append(b);
    return b;
  });

  const toast = document.createElement('div');
  toast.id = 'fb-toast';
  toast.hidden = true;
  document.body.append(bar, toast);

  // "Copy feedback" fica dentro do painel Developer.
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy feedback';
  copy.addEventListener('click', async () => {
    game.synth.uiTap();
    const t = fb.text();
    let ok = true;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      ok = false;
    }
    toast.textContent = ok ? 'Copied' : t;
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), ok ? 1400 : 8000);
  });
  const dev = document.querySelector<HTMLFormElement>('#dev-panel')!;
  dev.insertBefore(copy, dev.querySelector('button[type=submit]'));

  function refresh(): void {
    const v = fb.vote(game.current);
    for (const b of buttons) b.classList.toggle('on', b.dataset.vote === v);
  }
  game.skip = fb.cut;
  refresh();
  return { refresh };
}
