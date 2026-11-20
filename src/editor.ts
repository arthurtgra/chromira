// Editor de fases (só no modo desenvolvedor): botão de lápis na barra de baixo entra no modo de edição.
// No modo de edição: arrastar move a peça (soltar fora da grade apaga), tocar gira, a barra de ferramentas
// adiciona peças novas em células vazias. A fase começa no estado mostrado (rotações = level.start).
// Salvar grava em src/levels/edits.json pelo servidor de desenvolvimento (npm run dev); sem servidor,
// fica guardado no aparelho e o JSON vai para a área de transferência.
import { CONFIG } from './config.ts';
import { expand, GRID } from './core/grid.ts';
import { countSolutions, MAX_SPACE, searchSpace } from './core/solver.ts';
import { baseStates, isPiece, placeCells, railOf, rotOf, startRots, trace } from './core/trace.ts';
import type { Cell, Color, Dir, Level, Rail } from './core/types.ts';
import { drawPieces, drawRails, type PieceView } from './render/draw.ts';
import type { Game } from './game.ts';
import { githubToken, publishEdits, setGithubToken } from './github.ts';
import fileEdits from './levels/edits.json';

type PlaceTool = 'emitter' | 'mirror' | 'splitter' | 'filter' | 'prism' | 'dichroic' | 'wall' | 'target';
type Mode = 'move' | 'color' | 'erase';
export type Tool = Mode | PlaceTool | 'rail';
const RAIL_LENS = [2, 3, 4] as const;

const COLOR_CYCLE: Color[] = [7, 1, 2, 4, 3, 5, 6];
const PRIMARY: (1 | 2 | 4)[] = [1, 2, 4];
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const LOCAL_KEY = 'chromira.edits.v1';
const ENDPOINT = '/__chromira/level';

type Edits = Record<string, Level>; // chave = número da fase (1-based)

const next = <T>(list: readonly T[], v: T): T => list[(list.indexOf(v) + 1) % list.length]!;

function readLocal(): Edits {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Edits;
  } catch {
    return {};
  }
}

function writeLocal(e: Edits): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(e));
  } catch {
    // armazenamento bloqueado
  }
}

// Aplica as edições salvas sobre as fases geradas: edits.json (o jogo de todos) e, por cima, as guardadas
// neste aparelho (valem no modo normal também). Cópia do aparelho igual à do arquivo já foi publicada e sai.
export function applyEdits(levels: Level[]): void {
  const file = fileEdits as unknown as Edits;
  const local = readLocal();
  for (const k of Object.keys(local)) if (JSON.stringify(local[k]) === JSON.stringify(file[k])) delete local[k];
  writeLocal(local);
  const all: Edits = { ...file, ...local };
  for (const [k, lv] of Object.entries(all)) {
    const i = Number(k) - 1;
    const base = levels[i];
    if (!base) continue;
    // Edição salva na grade antiga 6x8: abre a coluna e a linha do meio, como nas outras fases.
    const fit = lv.w === GRID.w && lv.h === GRID.h ? structuredClone(lv) : expand(structuredClone(lv));
    levels[i] = { ...fit, id: base.id, difficulty: lv.difficulty ?? base.difficulty };
  }
}

function newCell(tool: PlaceTool, x: number, y: number): Cell {
  switch (tool) {
    case 'emitter':
      return { x, y, t: 'emitter', dir: 'E', color: 7 };
    case 'target':
      return { x, y, t: 'target', color: 7 };
    case 'dichroic':
      return { x, y, t: 'dichroic', color: 1 };
    case 'mirror':
      return { x, y, t: 'mirror' };
    case 'splitter':
      return { x, y, t: 'splitter' };
    case 'filter':
      return { x, y, t: 'filter' };
    case 'prism':
      return { x, y, t: 'prism' };
    case 'wall':
      return { x, y, t: 'wall' };
  }
}

// Resumo para mostrar depois de salvar: quantas soluções e se já começa resolvida.
export function checkLevel(lv: Level): string {
  if (!lv.cells.some((c) => c.t === 'target')) return 'no target';
  if (!lv.cells.some((c) => c.t === 'emitter')) return 'no emitter';
  if (trace(lv, startRots(lv)).solved) return 'starts solved!';
  if (searchSpace(lv) > MAX_SPACE) return 'too many pieces to check';
  const { count } = countSolutions(lv, 100);
  return count === 0 ? 'NO SOLUTION' : `${count >= 100 ? '100+' : count} solution${count === 1 ? '' : 's'}`;
}

interface Drag {
  ci: number; // índice em level.cells
  px: number;
  py: number;
  moved: boolean;
  out: boolean; // ponteiro fora da grade: soltar apaga
}

export class Editor {
  tool: Tool = 'move';
  railLen: number = 2;
  private drag: Drag | null = null;
  private readonly game: Game;
  private readonly notify: (msg: string) => void;

  constructor(game: Game, notify: (msg: string) => void) {
    this.game = game;
    this.notify = notify;
  }

  private get level(): Level {
    return this.game.editLevel;
  }

  // Estado inicial de cada célula (só peças móveis), alinhado a level.cells.
  private states(): (number | undefined)[] {
    const rots = startRots(this.level);
    let pi = 0;
    return this.level.cells.map((c) => (isPiece(c) ? (rots[pi++] ?? 0) : undefined));
  }

  private commit(cells: Cell[], states: (number | undefined)[]): void {
    const lv = this.level;
    lv.cells = cells;
    lv.start = cells.flatMap((c, i) => (isPiece(c) ? [states[i] ?? 0] : []));
    this.game.editChanged();
  }

  // Posições como aparecem (peça em trilho na posição do estado inicial).
  private placed(): Cell[] {
    return placeCells(this.level, startRots(this.level));
  }

  private indexAt(x: number, y: number, except = -1): number {
    return this.placed().findIndex((c, i) => i !== except && c.x === x && c.y === y);
  }

  // Trilho inteiro dentro da grade.
  private fits(c: Cell): boolean {
    const { w, h } = this.level;
    const rail = railOf(c);
    const ex = c.x + (rail?.axis === 'x' ? rail.len - 1 : 0);
    const ey = c.y + (rail?.axis === 'y' ? rail.len - 1 : 0);
    return c.x >= 0 && c.y >= 0 && ex < w && ey < h;
  }

  press(px: number, py: number): void {
    this.game.synth.unlock();
    const c = this.game.hitCell(px, py);
    if (!c) return;
    const i = this.indexAt(c.x, c.y);
    if (i < 0) {
      if (this.tool === 'rail') this.addRailed(c.x, c.y);
      else if (this.tool !== 'move' && this.tool !== 'color' && this.tool !== 'erase') this.add(this.tool, c.x, c.y);
      return;
    }
    if (this.tool === 'erase') return this.remove(i);
    if (this.tool === 'color') return this.recolor(i);
    if (this.tool === 'rail') return this.rail(i);
    this.drag = { ci: i, px, py, moved: false, out: false };
    this.game.editMark = c;
  }

  dragTo(px: number, py: number): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(px - d.px, py - d.py) < CONFIG.dragSlop) return;
    d.moved = true;
    const c = this.game.hitCell(px, py);
    d.out = !c;
    this.game.editMark = c;
    if (!c) return;
    const cur = this.placed()[d.ci]!;
    if ((cur.x === c.x && cur.y === c.y) || this.indexAt(c.x, c.y, d.ci) >= 0) return;
    const base = this.level.cells[d.ci]!;
    const moved: Cell = { ...base, x: base.x + c.x - cur.x, y: base.y + c.y - cur.y };
    if (!this.fits(moved)) return;
    const cells = [...this.level.cells];
    cells[d.ci] = moved;
    this.commit(cells, this.states());
    this.game.synth.turn(true);
    navigator.vibrate?.(CONFIG.vibrateMs);
  }

  release(): void {
    const d = this.drag;
    this.drag = null;
    this.game.editMark = null;
    if (!d) return;
    if (d.out) this.remove(d.ci);
    else if (!d.moved) this.turn(d.ci);
  }

  // Toque: espelho/divisor/dicroico giram, filtro troca de cor, lançador gira, alvo troca de cor.
  private turn(i: number): void {
    const cell = this.level.cells[i]!;
    const cells = [...this.level.cells];
    const states = this.states();
    if (cell.t === 'emitter') cells[i] = { ...cell, dir: next(DIRS, cell.dir) };
    else if (cell.t === 'target') cells[i] = { ...cell, color: next(COLOR_CYCLE, cell.color) };
    else if (isPiece(cell) && baseStates(cell) > 1) {
      const s = states[i] ?? 0;
      const r = rotOf(cell, s);
      states[i] = s - r + ((r + 1) % baseStates(cell));
    } else return;
    this.commit(cells, states);
    if (cell.t === 'filter') this.game.synth.filter(rotOf(cell, states[i] ?? 0));
    else this.game.synth.turn();
    navigator.vibrate?.(CONFIG.vibrateMs);
  }

  // Ferramenta de cor: lançador e alvo passam por todas as cores; dicroico por R/G/B; filtro igual ao toque.
  private recolor(i: number): void {
    const cell = this.level.cells[i]!;
    const cells = [...this.level.cells];
    if (cell.t === 'emitter' || cell.t === 'target') cells[i] = { ...cell, color: next(COLOR_CYCLE, cell.color) };
    else if (cell.t === 'dichroic') cells[i] = { ...cell, color: next(PRIMARY, cell.color) };
    else if (cell.t === 'filter') return this.turn(i);
    else return;
    this.commit(cells, this.states());
    this.game.synth.turn(true);
  }

  // Trilho cabe: dentro da grade e sem outra peça nas células por onde a peça desliza.
  private railFits(c: Cell, i: number): boolean {
    if (!this.fits(c)) return false;
    const rail = railOf(c);
    if (!rail) return true;
    for (let k = 0; k < rail.len; k++) {
      const x = c.x + (rail.axis === 'x' ? k : 0);
      const y = c.y + (rail.axis === 'y' ? k : 0);
      if (this.indexAt(x, y, i) >= 0) return false;
    }
    return true;
  }

  // Ferramenta de trilho num espelho ou prisma: sem trilho ganha um (horizontal; se não couber,
  // vertical); com trilho de outro tamanho troca o tamanho; do mesmo tamanho gira para vertical e,
  // tocando de novo, tira o trilho. A peça volta para o começo do trilho.
  private rail(i: number): void {
    const placed = this.placed()[i]!;
    if (placed.t !== 'mirror' && placed.t !== 'prism') {
      this.notify('Rails go on mirrors and prisms');
      return;
    }
    const cur = placed.rail;
    const options: (Rail | undefined)[] =
      !cur || cur.len !== this.railLen
        ? [{ axis: cur?.axis ?? 'x', len: this.railLen }, { axis: cur?.axis === 'y' ? 'x' : 'y', len: this.railLen }]
        : cur.axis === 'x'
          ? [{ axis: 'y', len: this.railLen }, undefined]
          : [undefined];
    for (const rail of options) {
      const cell = { ...placed, rail } as Cell;
      if (!rail) delete (cell as { rail?: Rail }).rail;
      if (!this.railFits(cell, i)) continue;
      const cells = [...this.level.cells];
      const states = this.states();
      cells[i] = cell;
      states[i] = rotOf(cell, states[i] ?? 0);
      this.commit(cells, states);
      this.game.synth.turn(true);
      navigator.vibrate?.(CONFIG.vibrateMs);
      return;
    }
    this.notify(`No room for a ${this.railLen}-cell rail here`);
  }

  private addRailed(x: number, y: number): void {
    for (const axis of ['x', 'y'] as const) {
      const cell: Cell = { x, y, t: 'mirror', rail: { axis, len: this.railLen } };
      if (!this.railFits(cell, -1)) continue;
      this.commit([...this.level.cells, cell], [...this.states(), 0]);
      this.game.synth.turn();
      navigator.vibrate?.(CONFIG.vibrateMs);
      return;
    }
    this.notify(`No room for a ${this.railLen}-cell rail here`);
  }

  private add(tool: PlaceTool, x: number, y: number): void {
    const states = this.states();
    const cell = newCell(tool, x, y);
    this.commit([...this.level.cells, cell], [...states, isPiece(cell) ? 0 : undefined]);
    this.game.synth.turn();
    navigator.vibrate?.(CONFIG.vibrateMs);
  }

  private remove(i: number): void {
    const states = this.states();
    this.commit(
      this.level.cells.filter((_, j) => j !== i),
      states.filter((_, j) => j !== i),
    );
    this.game.synth.down();
    navigator.vibrate?.(CONFIG.vibrateMs);
  }

  // Grava a fase atual. Sempre fica no aparelho (vale no modo normal também) e depois vai para o jogo:
  // pelo servidor de dev (npm run dev) direto no arquivo; no site, por um commit no GitHub (precisa do
  // token no painel Developer), que dispara o deploy. Fase sem solução não é publicada: o deploy roda
  // check-levels e falharia.
  async save(): Promise<void> {
    const n = this.game.current + 1;
    const lv = structuredClone(this.level);
    const check = checkLevel(lv);
    const local = readLocal();
    local[String(n)] = lv;
    writeLocal(local);
    if (await devServer(n, lv)) {
      delete local[String(n)];
      writeLocal(local);
      this.notify(`Level ${n} saved to edits.json · ${check}`);
      return;
    }
    if (!githubToken()) {
      this.notify(`Level ${n} saved on this device only · add a GitHub token in Developer to publish · ${check}`);
      return;
    }
    if (!publishable(check)) {
      this.notify(`Level ${n} kept on this device, not published: ${check}`);
      return;
    }
    this.notify(`Publishing level ${n}…`);
    try {
      await publishEdits((e) => (e[String(n)] = lv), `Edit level ${n} (in-game editor)`);
      this.notify(`Level ${n} published · ${check} · site updates in ~1 min`);
    } catch (e) {
      this.notify(`Publish failed (${(e as Error).message}) · level ${n} kept on this device`);
    }
  }

  // Volta a fase para a versão gerada (levels.json), apagando a edição salva (aparelho, arquivo e GitHub).
  async revert(original: Level): Promise<void> {
    const n = this.game.current + 1;
    const lv = this.level;
    lv.cells = structuredClone(original.cells);
    if (original.start) lv.start = [...original.start];
    else delete lv.start;
    this.game.editChanged();
    const local = readLocal();
    delete local[String(n)];
    writeLocal(local);
    if (await devServer(n, null)) return this.notify(`Level ${n} reverted`);
    if (!githubToken()) return this.notify(`Level ${n} reverted on this device`);
    try {
      await publishEdits((e) => delete e[String(n)], `Revert level ${n} (in-game editor)`);
      this.notify(`Level ${n} reverted and published`);
    } catch (e) {
      this.notify(`Revert publish failed (${(e as Error).message})`);
    }
  }
}

// Só no `npm run dev`: o plugin do Vite grava edits.json. No site estático a chamada falha.
async function devServer(n: number, level: Level | null): Promise<boolean> {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n, level }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const publishable = (check: string): boolean => /^\d+\+? solutions?$/.test(check);

// Publica de uma vez as fases guardadas só no aparelho (as válidas); roda ao salvar o token.
async function publishDeviceEdits(): Promise<string> {
  const local = readLocal();
  const ok = Object.entries(local).filter(([, lv]) => publishable(checkLevel(lv)));
  const skipped = Object.keys(local).length - ok.length;
  if (ok.length === 0) return skipped ? `${skipped} level(s) not publishable (no solution)` : 'Nothing to publish';
  await publishEdits((e) => {
    for (const [k, lv] of ok) e[k] = lv;
  }, `Edit levels ${ok.map(([k]) => k).join(', ')} (in-game editor)`);
  return `Published ${ok.length} level(s)${skipped ? `, ${skipped} skipped (no solution)` : ''} · site updates in ~1 min`;
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const MODE_ICONS: Record<Mode, [string, string]> = {
  move: ['Move / turn', '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'],
  color: ['Color', '<circle cx="8" cy="9" r="3.5" stroke="#ff3358"/><circle cx="16" cy="9" r="3.5" stroke="#29f58a"/><circle cx="12" cy="16" r="3.5" stroke="#4c7dff"/>'],
  erase: ['Erase', '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'],
};

// Peças da paleta: desenhadas pelo mesmo código do jogo, então o ícone é a peça.
const ITEMS: [PlaceTool | 'rail', string, Cell][] = [
  ['emitter', 'Emitter', { x: 0, y: 0, t: 'emitter', dir: 'E', color: 7 }],
  ['target', 'Target', { x: 0, y: 0, t: 'target', color: 7 }],
  ['mirror', 'Mirror', { x: 0, y: 0, t: 'mirror' }],
  ['splitter', 'Splitter', { x: 0, y: 0, t: 'splitter' }],
  ['dichroic', 'Dichroic', { x: 0, y: 0, t: 'dichroic', color: 1 }],
  ['filter', 'Filter', { x: 0, y: 0, t: 'filter' }],
  ['prism', 'Prism', { x: 0, y: 0, t: 'prism' }],
  ['wall', 'Wall', { x: 0, y: 0, t: 'wall' }],
  ['rail', 'Rail', { x: 0, y: 0, t: 'mirror', rail: { axis: 'x', len: 2 } }],
];

const ICON_VIEW: PieceView = {
  mirrorAngle: () => -Math.PI / 4,
  filterColor: () => ({ from: 0, to: 0, k: 1 }),
  targetFill: () => 0,
  targetReceived: () => 0,
  prismAngle: () => -Math.PI / 2,
  gateOpen: () => false,
  bender: () => ({ from: 0, to: 0, k: 1 }),
  charge: () => 0,
  autoPhase: 0,
  darkHit: () => false,
  time: 0,
};

function pieceIcon(cell: Cell, size: number): HTMLCanvasElement {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rail = railOf(cell);
  const n = rail?.len ?? 1;
  const cellPx = size / (n === 1 ? 1.15 : n + 0.3);
  const l = { cell: cellPx, ox: (size - cellPx * n) / 2, oy: (size - cellPx) / 2, w: size, h: size };
  drawRails(ctx, l, [cell]);
  drawPieces(ctx, l, [cell], ICON_VIEW);
  return canvas;
}

export const EDIT_ICON = svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>');

// No painel Developer: só o token do GitHub (guardado neste aparelho). Com ele, cada Save publica sozinho.
// Ao salvar o token, as fases que tinham ficado só no aparelho são publicadas automaticamente.
function setupPublishPanel(): void {
  const dev = document.querySelector<HTMLFormElement>('#dev-panel')!;
  const box = document.createElement('div');
  box.className = 'dev-publish';
  // Campo de texto (não senha): o iOS preenchia o campo de senha sozinho com a senha do Developer.
  // O token salvo não volta para o campo; só aparece o começo e o fim para conferir.
  const token = document.createElement('input');
  token.type = 'text';
  token.setAttribute('aria-label', 'GitHub token');
  token.autocomplete = 'off';
  token.spellcheck = false;
  token.setAttribute('autocapitalize', 'off');
  token.setAttribute('autocorrect', 'off');
  token.name = 'chromira-github-token';
  const msg = document.createElement('p');
  msg.className = 'dev-note';
  const showSaved = (): void => {
    const t = githubToken();
    token.value = '';
    token.placeholder = t ? `Token: ${t.slice(0, 15)}…${t.slice(-4)} (paste to replace)` : 'Paste GitHub token';
  };
  showSaved();
  // Enter no campo do token não pode enviar o formulário (ele liga/desliga o modo Developer).
  token.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      token.blur();
    }
  });
  token.addEventListener('change', async () => {
    const raw = token.value.trim();
    if (!raw) return;
    // Pega só o token, mesmo se vier texto junto, espaço ou quebra de linha no meio.
    const found = raw.replace(/\s+/g, '').match(/github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+/);
    if (!found) {
      msg.textContent = "That doesn't look like a GitHub token (github_pat_…)";
      token.value = '';
      return;
    }
    setGithubToken(found[0]);
    showSaved();
    if (Object.keys(readLocal()).length === 0) {
      msg.textContent = 'Token saved · every Save now publishes';
      return;
    }
    msg.textContent = 'Token saved · publishing levels saved on this device…';
    try {
      msg.textContent = `Token saved · ${await publishDeviceEdits()}`;
    } catch (e) {
      msg.textContent = `Token saved, but publishing failed (${(e as Error).message})`;
    }
  });
  box.append(token, msg);
  dev.insertBefore(box, dev.querySelector('button[type=submit]'));
}

// Barra do editor: ferramentas embaixo, ações (salvar, desfazer edição, sair) acima delas.
export function setupEditor(
  game: Game,
  original: Level[],
  onToggle: (on: boolean) => void,
): { toggle: () => void; editor: Editor } {
  const bar = document.createElement('div');
  bar.id = 'editor';
  bar.hidden = true;
  const status = document.createElement('div');
  status.className = 'ed-status';
  const editor = new Editor(game, (msg) => (status.textContent = msg));

  const actions = document.createElement('div');
  actions.className = 'ed-actions';
  const action = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      game.synth.uiTap();
      fn();
    });
    actions.append(b);
    return b;
  };
  action('Save', () => {
    status.textContent = 'Saving…';
    void editor.save();
  });
  action('Revert', () => {
    const o = original[game.current];
    if (o && confirm(`Revert level ${game.current + 1} to the generated version?`)) void editor.revert(o);
  });
  action('Done', () => toggle());

  const select = (t: Tool): void => {
    game.synth.uiTap();
    editor.tool = t;
    lens.hidden = true;
    render();
    status.textContent = HINTS[t];
  };
  const toolButton = (t: Tool, label: string, content: string | HTMLElement): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tool = t;
    b.title = label;
    b.setAttribute('aria-label', label);
    if (typeof content === 'string') b.innerHTML = content;
    else b.append(content);
    b.addEventListener('click', () => select(t));
    return b;
  };

  // Mover, cor e lixo: sempre à mão, à esquerda, separados das peças.
  const modes = document.createElement('div');
  modes.className = 'ed-modes';
  const modeButtons = (Object.keys(MODE_ICONS) as Mode[]).map((t) => {
    const [label, icon] = MODE_ICONS[t];
    const b = toolButton(t, label, svg(icon));
    modes.append(b);
    return b;
  });

  const items = document.createElement('div');
  items.className = 'ed-items';
  const itemButtons = ITEMS.map(([t, label, cell]) => {
    const b = toolButton(t, label, pieceIcon(cell, 30));
    items.append(b);
    return b;
  });

  // Tamanho do trilho: toque escolhe o trilho (2 por padrão); tocar e segurar abre 2, 3 e 4 para cima.
  // Dá para arrastar o dedo até o tamanho e soltar, ou soltar e tocar no tamanho depois.
  const railBtn = itemButtons[ITEMS.findIndex(([t]) => t === 'rail')]!;
  const badge = document.createElement('span');
  badge.className = 'ed-badge';
  railBtn.append(badge);
  const lens = document.createElement('div');
  lens.className = 'ed-lens';
  lens.hidden = true;
  const lenButtons = RAIL_LENS.map((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(n);
    b.dataset.len = String(n);
    b.setAttribute('aria-label', `Rail length ${n}`);
    b.addEventListener('click', () => pickLen(n));
    lens.append(b);
    return b;
  });
  const pickLen = (n: number): void => {
    game.synth.uiTap();
    editor.railLen = n;
    editor.tool = 'rail';
    lens.hidden = true;
    render();
    status.textContent = HINTS.rail;
  };
  const lenAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const n = el?.closest<HTMLElement>('.ed-lens button')?.dataset.len;
    return n ? Number(n) : null;
  };
  let hold: number | null = null;
  let held = false;
  railBtn.addEventListener('pointerdown', (e) => {
    held = false;
    railBtn.setPointerCapture(e.pointerId);
    hold = window.setTimeout(() => {
      hold = null;
      held = true;
      const r = railBtn.getBoundingClientRect();
      lens.hidden = false;
      lens.style.left = `${r.left + r.width / 2}px`;
      lens.style.bottom = `${window.innerHeight - r.top + 6}px`;
      navigator.vibrate?.(CONFIG.vibrateMs);
    }, CONFIG.editor.holdMs);
  });
  railBtn.addEventListener('pointermove', (e) => {
    if (!held) return;
    const n = lenAt(e.clientX, e.clientY);
    lenButtons.forEach((b) => b.classList.toggle('hover', Number(b.dataset.len) === n));
  });
  const endHold = (e: PointerEvent): void => {
    if (hold !== null) window.clearTimeout(hold);
    hold = null;
    if (!held) return;
    const n = lenAt(e.clientX, e.clientY);
    lenButtons.forEach((b) => b.classList.remove('hover'));
    if (n !== null) pickLen(n);
  };
  railBtn.addEventListener('pointerup', endHold);
  railBtn.addEventListener('pointercancel', endHold);
  railBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  // Depois de segurar, o clique que vem ao soltar não fecha a lista nem troca nada.
  railBtn.addEventListener(
    'click',
    (e) => {
      if (!held) return;
      e.stopImmediatePropagation();
      held = false;
    },
    true,
  );
  document.addEventListener('pointerdown', (e) => {
    if (!lens.hidden && !lens.contains(e.target as Node) && e.target !== railBtn) lens.hidden = true;
  });

  actions.prepend(modes);
  const tools = document.createElement('div');
  tools.className = 'ed-tools';
  tools.append(items);
  const toolButtons = [...modeButtons, ...itemButtons];

  bar.append(status, actions, lens, tools);
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(bar);
  setupPublishPanel();

  function render(): void {
    for (const b of toolButtons) b.classList.toggle('on', b.dataset.tool === editor.tool);
    badge.textContent = String(editor.railLen);
    lenButtons.forEach((b, k) => b.classList.toggle('on', RAIL_LENS[k] === editor.railLen));
  }

  function toggle(): void {
    const on = !game.editing;
    bar.hidden = !on;
    document.body.classList.toggle('editing', on);
    game.setEditing(on);
    editor.tool = 'move';
    render();
    status.textContent = on ? HINTS.move : '';
    onToggle(on);
  }

  render();
  return { toggle, editor };
}

const HINTS: Record<Tool, string> = {
  move: 'Drag to move · tap to turn · drop outside to delete',
  emitter: 'Tap an empty cell to add an emitter',
  mirror: 'Tap an empty cell to add a mirror',
  splitter: 'Tap an empty cell to add a splitter',
  filter: 'Tap an empty cell to add a filter',
  prism: 'Tap an empty cell to add a prism',
  dichroic: 'Tap an empty cell to add a dichroic mirror',
  wall: 'Tap an empty cell to add a wall',
  target: 'Tap an empty cell to add a target',
  color: 'Tap an emitter, target, dichroic or filter to change its color',
  rail: 'Hold the rail button for 2, 3 or 4 · tap a mirror or prism to add a rail (again: vertical, then none) · tap an empty cell for a mirror on a rail',
  erase: 'Tap a piece to delete it',
};
