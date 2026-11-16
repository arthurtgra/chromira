// Editor de fases (só no modo desenvolvedor): botão de lápis na barra de baixo entra no modo de edição.
// No modo de edição: arrastar move a peça (soltar fora da grade apaga), tocar gira, a barra de ferramentas
// adiciona peças novas em células vazias. A fase começa no estado mostrado (rotações = level.start).
// Salvar grava em src/levels/edits.json pelo servidor de desenvolvimento (npm run dev); sem servidor,
// fica guardado no aparelho e o JSON vai para a área de transferência.
import { CONFIG } from './config.ts';
import { expand, GRID } from './core/grid.ts';
import { countSolutions, MAX_SPACE, searchSpace } from './core/solver.ts';
import { baseStates, isPiece, placeCells, railOf, rotOf, startRots, trace } from './core/trace.ts';
import type { Cell, Color, Dir, Level } from './core/types.ts';
import type { Game } from './game.ts';
import fileEdits from './levels/edits.json';

type PlaceTool = 'emitter' | 'mirror' | 'splitter' | 'filter' | 'prism' | 'dichroic' | 'wall' | 'target';
export type Tool = 'move' | PlaceTool | 'color' | 'erase';

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

// Aplica as edições salvas sobre as fases geradas: edits.json sempre; as do aparelho só no modo desenvolvedor.
export function applyEdits(levels: Level[], dev: boolean): void {
  const all: Edits = { ...(fileEdits as unknown as Edits), ...(dev ? readLocal() : {}) };
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
      if (this.tool !== 'move' && this.tool !== 'color' && this.tool !== 'erase') this.add(this.tool, c.x, c.y);
      return;
    }
    if (this.tool === 'erase') return this.remove(i);
    if (this.tool === 'color') return this.recolor(i);
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
    this.game.synth.turn(cell.t === 'filter');
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

  // Grava a fase atual: no arquivo pelo servidor de dev; se não houver servidor, no aparelho + área de transferência.
  async save(): Promise<void> {
    const n = this.game.current + 1;
    const lv = structuredClone(this.level);
    const check = checkLevel(lv);
    const local = readLocal();
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n, level: lv }),
      });
      if (!r.ok) throw new Error(String(r.status));
      delete local[String(n)];
      writeLocal(local);
      this.notify(`Level ${n} saved to edits.json · ${check}`);
    } catch {
      local[String(n)] = lv;
      writeLocal(local);
      let copied = true;
      try {
        await navigator.clipboard.writeText(JSON.stringify(lv));
      } catch {
        copied = false;
      }
      this.notify(`No dev server: level ${n} saved on this device${copied ? ', JSON copied' : ''} · ${check}`);
    }
  }

  // Volta a fase para a versão gerada (levels.json), apagando a edição salva.
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
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n, level: null }),
      });
    } catch {
      // sem servidor: só a cópia do aparelho
    }
    this.notify(`Level ${n} reverted`);
  }
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const TOOL_ICONS: Record<Tool, [string, string]> = {
  move: ['Move / turn', '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'],
  emitter: ['Emitter', '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 9l3 3-3 3"/>'],
  mirror: ['Mirror', '<path d="M5 19L19 5" stroke-width="3"/>'],
  splitter: ['Splitter', '<path d="M5 19L19 5" stroke-dasharray="3 3"/><path d="M3 12h18" opacity=".4"/>'],
  filter: ['Filter', '<circle cx="12" cy="12" r="7"/><path d="M12 5v14" opacity=".5"/>'],
  prism: ['Prism', '<path d="M12 4l8 15H4z"/>'],
  dichroic: ['Dichroic', '<path d="M5 19L19 5" stroke="#ff3358" stroke-width="3"/>'],
  wall: ['Wall', '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'],
  target: ['Target', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'],
  color: ['Color', '<circle cx="8" cy="9" r="3.5" stroke="#ff3358"/><circle cx="16" cy="9" r="3.5" stroke="#29f58a"/><circle cx="12" cy="16" r="3.5" stroke="#4c7dff"/>'],
  erase: ['Erase', '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'],
};

export const EDIT_ICON = svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>');

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

  const tools = document.createElement('div');
  tools.className = 'ed-tools';
  const toolButtons = (Object.keys(TOOL_ICONS) as Tool[]).map((t) => {
    const [label, icon] = TOOL_ICONS[t];
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tool = t;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg(icon);
    b.addEventListener('click', () => {
      game.synth.uiTap();
      editor.tool = t;
      render();
      status.textContent = HINTS[t];
    });
    tools.append(b);
    return b;
  });

  bar.append(status, actions, tools);
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(bar);

  function render(): void {
    for (const b of toolButtons) b.classList.toggle('on', b.dataset.tool === editor.tool);
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
  erase: 'Tap a piece to delete it',
};
