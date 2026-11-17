import { Synth } from './audio/synth.ts';
import { CONFIG } from './config.ts';
import { baseStates, isPiece, key, linkOf, pieces, placeCells, posOf, railOf, rotOf, startRots, trace } from './core/trace.ts';
import type { Cell, Color, Level, Rots, Segment, TraceResult } from './core/types.ts';
import { cellAt } from './input.ts';
import { arrived, cut, extendToObstacles, planBeams, reachedEnd, segLen, visibleSegments, type BeamPiece, type BeamPlan } from './render/beams.ts';
import {
  drawBackground,
  drawBeams,
  drawDebug,
  drawPieces,
  drawImpacts,
  drawPrismGlow,
  drawRails,
  drawLinks,
  drawFibers,
  drawWinWave,
  mix,
  type BeamStyle,
  type WaveOrigin,
} from './render/draw.ts';
import { Fx } from './render/fx.ts';
import { drawHud } from './render/hud.ts';
import { computeLayout, cx, cy, type Layout } from './render/layout.ts';
import { writeSave } from './save.ts';

const QUARTER = Math.PI / 2;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

// Animação de uma peça móvel: espelho gira (ângulo), filtro troca de cor (índice).
interface Anim {
  from: number;
  to: number;
  at: number;
}

export class Game {
  readonly synth = new Synth();
  debug = false;
  private fx = new Fx();
  private layout: Layout = computeLayout(1, 1, 6, 8);
  private index = 0;
  private level!: Level;
  private rots: Rots = [];
  private result!: TraceResult;
  private hits: { x: number; y: number; dx: number; dy: number; color: Color }[] = []; // onde a luz bate num obstáculo
  private pieceCells: Cell[] = [];
  private slide: number[] = []; // posição desenhada de cada peça no trilho (desliza até a célula do estado)
  private drag: { i: number; px: number; py: number; moved: boolean } | null = null;
  private anims: Anim[] = [];
  private now = 0;
  private loadedAt = 0;
  private bgFrom: readonly [string, string] | null = null;
  private bgAt = 0;
  private plan: BeamPlan = planBeams([], []);
  private fades: { seg: Segment; at: number; off: number }[] = [];
  // Crescimento da luz por lançador: cada um tem a sua frente e o seu tempo. Mexer num espelho só
  // reinicia o lançador cujo caminho mudou; os outros continuam de onde estavam.
  private beamV = 0; // velocidade da luz em crescimento, células por ms
  private quiet = true; // sem notas enquanto a fase abre
  private litAt = new Map<string, number>();
  private prismHit = new Set<string>(); // prismas que a frente de luz já alcançou (som toca ao chegar)
  private prismSoundAt = -Infinity;
  private prismAngle = new Map<number, { cur: number; to: number }>(); // por índice em level.cells; // ponta do prisma virada para a luz que chega
  private wonAt: number | null = null;
  private autoAt = 0; // último giro dos espelhos automáticos
  private waves: WaveOrigin[] = [];
  private replayAt = Infinity; // quando o pulso de vitória começa a caminhar
  private pulseAt = Infinity;
  private pulseSpeed = 0;
  private nextAt = Infinity; // quando abre a próxima fase
  private fps = 60;
  private readonly levels: Level[];
  readonly done = new Set<number>();
  onWin: (() => void) | null = null;
  onLoad: (() => void) | null = null;
  unlockAll = false; // modo desenvolvedor: todas as fases liberadas
  skip = new Set<number>(); // fases cortadas no playtest: o avanço automático pula
  editing = false; // editor de fases (desenvolvedor): toques vão para o Editor, sem vitória
  editMark: { x: number; y: number } | null = null; // célula destacada no editor (peça sendo arrastada)
  private size = { w: 1, h: 1 };

  constructor(levels: Level[]) {
    this.levels = levels;
  }

  load(index: number): void {
    if (this.level) this.bgFrom = this.background();
    this.bgAt = this.now;
    this.index = ((index % this.levels.length) + this.levels.length) % this.levels.length;
    this.level = this.levels[this.index]!;
    this.relayout(); // a grade segue o tamanho da fase carregada
    this.initPieces();
    this.drag = null;
    this.result = trace(this.level, this.rots);
    this.prismAngle = new Map();
    this.aimPrisms(true);
    this.litAt = new Map();
    this.prismHit = new Set();
    this.quiet = true;
    this.plan = this.planAll([], this.beamSegments(), CONFIG.beam.speed);
    this.fades = [];
    this.loadedAt = this.now;
    this.wonAt = null;
    this.autoAt = this.now;
    this.replayAt = Infinity;
    this.pulseAt = Infinity;
    this.nextAt = Infinity;
    this.fx.clear();
    this.persist();
    this.onLoad?.();
  }

  // Peças móveis no estado inicial da fase, sem animação.
  private initPieces(): void {
    this.rots = startRots(this.level);
    this.pieceCells = pieces(this.level);
    this.anims = this.rots.map((r, i) => {
      const c = this.pieceCells[i]!;
      const v =
        c.t === 'filter' || c.t === 'bender'
          ? rotOf(c, r)
          : c.t === 'combiner'
            ? rotOf(c, r) * QUARTER
            : rotOf(c, r) === 0
              ? -QUARTER / 2
              : QUARTER / 2;
      return { from: v, to: v, at: -Infinity };
    });
    this.slide = this.rots.map((r, i) => posOf(this.pieceCells[i]!, r));
  }

  // Editor: a fase atual, editada no lugar (os objetos de levels são os mesmos).
  get editLevel(): Level {
    return this.level;
  }

  // Entrar/sair do editor recomeça a fase no estado inicial.
  setEditing(on: boolean): void {
    this.editing = on;
    this.load(this.index);
  }

  // Depois de cada edição: peças voltam ao estado inicial e a luz se refaz a partir do que mudou.
  editChanged(): void {
    this.initPieces();
    this.prismAngle = new Map();
    const targets = new Set(this.level.cells.flatMap((c) => (c.t === 'target' ? [key(c.x, c.y)] : [])));
    for (const k of [...this.litAt.keys()]) if (!targets.has(k)) this.litAt.delete(k);
    this.retrace();
  }

  hitCell(px: number, py: number): { x: number; y: number } | null {
    return cellAt(this.layout, px, py, this.level.w, this.level.h);
  }

  // Recalcula o layout (ex.: a barra do editor muda o espaço livre embaixo).
  relayout(): void {
    this.resize(this.size.w, this.size.h);
  }

  // Próxima fase não cortada depois de i (se todas cortadas, a seguinte).
  nextIndex(i: number): number {
    for (let k = 1; k < this.levels.length; k++) {
      const j = (i + k) % this.levels.length;
      if (!this.skip.has(j)) return j;
    }
    return (i + 1) % this.levels.length;
  }

  get levelId(): number {
    return this.level.id;
  }

  get won(): boolean {
    return this.wonAt !== null;
  }

  get current(): number {
    return this.index;
  }

  get count(): number {
    return this.levels.length;
  }

  // Liberadas: todas até a seguinte à maior concluída (e pelo menos até a atual).
  get unlocked(): number {
    if (this.unlockAll) return this.levels.length - 1;
    return Math.min(this.levels.length - 1, Math.max(this.index, ...[...this.done].map((d) => d + 1)));
  }

  difficulty(i: number): number {
    return this.levels[i]?.difficulty ?? 1;
  }

  private persist(): void {
    writeSave({ level: this.index, muted: this.synth.muted, done: [...this.done] });
  }

  resize(w: number, h: number): void {
    this.size = { w, h };
    this.layout = computeLayout(w, h, this.level.w, this.level.h);
  }

  setMuted(m: boolean): void {
    this.synth.muted = m;
    this.persist();
  }

  // Toque/arrasto. Peça sem trilho gira no toque (na hora). Peça em trilho: arrastar desliza de célula em
  // célula (nunca fica entre duas) e a luz acompanha; toque sem arrastar gira (espelho).
  press(px: number, py: number): void {
    this.synth.unlock();
    if (this.wonAt !== null || this.editing) return;
    const c = cellAt(this.layout, px, py, this.level.w, this.level.h);
    if (!c) return;
    const placed = placeCells(this.level, this.rots).filter(isPiece);
    const i = placed.findIndex((m) => m.x === c.x && m.y === c.y);
    if (i < 0) return;
    const cell = this.pieceCells[i]!;
    if (cell.t === 'mirror' && cell.auto) return; // gira sozinho
    if (railOf(cell)) this.drag = { i, px, py, moved: false };
    else this.rotate(i);
  }

  dragTo(px: number, py: number): void {
    const d = this.drag;
    if (!d || this.wonAt !== null) return;
    if (!d.moved && Math.hypot(px - d.px, py - d.py) < CONFIG.dragSlop) return;
    d.moved = true;
    const cell = this.pieceCells[d.i]!;
    const rail = railOf(cell)!;
    const along =
      rail.axis === 'x' ? (px - cx(this.layout, cell.x)) / this.layout.cell : (py - cy(this.layout, cell.y)) / this.layout.cell;
    const pos = Math.max(0, Math.min(rail.len - 1, Math.round(along)));
    const s = this.rots[d.i]!;
    if (pos === posOf(cell, s)) return;
    this.rots[d.i] = rotOf(cell, s) + baseStates(cell) * pos;
    this.synth.turn(true);
    navigator.vibrate?.(CONFIG.vibrateMs);
    this.retrace();
  }

  release(): void {
    const d = this.drag;
    this.drag = null;
    if (d && !d.moved && this.wonAt === null && baseStates(this.pieceCells[d.i]!) > 1) this.rotate(d.i);
  }

  private rotate(i: number): void {
    const link = linkOf(this.pieceCells[i]!);
    const group = link === undefined ? [i] : this.pieceCells.flatMap((c, j) => (linkOf(c) === link ? [j] : []));
    this.turn(group);
    const cell = this.pieceCells[i]!;
    if (cell.t !== 'filter') this.synth.turn();
    else this.synth.filter(rotOf(cell, this.rots[i]!));
    navigator.vibrate?.(CONFIG.vibrateMs);
    this.retrace();
  }

  // Espelhos automáticos: viram juntos a cada período, sem som de toque.
  private flipAutos(): void {
    const autos = this.pieceCells.flatMap((c, j) => (c.t === 'mirror' && c.auto ? [j] : []));
    if (autos.length === 0 || this.wonAt !== null || this.editing) return;
    if (this.now - this.autoAt < CONFIG.auto.periodMs) return;
    this.autoAt = this.now;
    this.turn(autos);
    this.retrace();
  }

  // Avança o estado (e a animação) das peças.
  private turn(group: number[]): void {
    for (const j of group) {
      const cell = this.pieceCells[j]!;
      const s = this.rots[j]!;
      const r = rotOf(cell, s);
      this.rots[j] = s - r + ((r + 1) % baseStates(cell));
      const a = this.anims[j]!;
      if (cell.t === 'bender') {
        this.anims[j] = { from: a.to, to: this.rots[j]!, at: this.now };
      } else if (cell.t !== 'filter') {
        this.anims[j] = { from: this.animValue(a, CONFIG.mirrorSpinMs), to: a.to + QUARTER, at: this.now };
      } else {
        this.anims[j] = { from: a.to, to: this.rots[j]!, at: this.now };
      }
    }
  }

  private retrace(): void {
    const before = visibleSegments(this.plan, this.fronts());
    this.result = trace(this.level, this.rots);
    this.aimPrisms(false);
    this.plan = this.planAll(before, this.beamSegments(), CONFIG.beam.turnSpeed);
    this.quiet = false;
    // Recolhe o que sumiu a partir do ponto que mudou: trechos encadeados recolhem em sequência.
    let off = 0;
    let prev: Segment | null = null;
    for (const seg of this.plan.fading) {
      off = prev && prev.x2 === seg.x1 && prev.y2 === seg.y1 ? off + segLen(prev) : 0;
      this.fades.push({ seg, at: this.now, off });
      prev = seg;
    }
  }

  // Cada trecho tem o seu tempo: o que já estava aceso continua crescendo de onde estava, agora; o que
  // está apagado começa quando a ponta do trecho anterior chega nele. Assim mexer numa peça só refaz a luz
  // depois dela; feixes ainda crescendo em outros lugares (outro lançador ou outro ramo) não param.
  private planAll(before: Segment[], next: Segment[], speed: number): BeamPlan {
    const plan = planBeams(before, next);
    this.beamV = speed / 1000;
    const done: BeamPiece[] = [];
    for (const p of plan.pieces) {
      const from = (q: BeamPiece): boolean => Math.abs(q.d0 + q.len - p.d0) < 1e-9;
      const prev =
        p.known > 0 || p.d0 === 0
          ? undefined
          : (done.find((q) => q.x2 === p.x1 && q.y2 === p.y1 && from(q)) ??
            done.find((q) => from(q) && this.portalPair(q.x2, q.y2) === key(p.x1, p.y1)));
      p.at = prev ? prev.at + (prev.len - prev.known) / this.beamV : this.now;
      done.push(p);
    }
    return plan;
  }

  // Frente de luz de cada trecho (distância da fonte até onde a luz chegou nele), com folga opcional.
  private fronts(extra = 0): (p: BeamPiece) => number {
    return (p) => p.d0 + p.known + (this.now - p.at) * this.beamV + extra;
  }

  // Ainda tem luz crescendo em algum trecho.
  private growing(): boolean {
    const f = this.fronts();
    return this.plan.pieces.some((p) => !reachedEnd(p, f));
  }

  update(dtMs: number): void {
    this.now += dtMs;
    this.fps += (1000 / Math.max(1, dtMs) - this.fps) * 0.05;
    this.fx.update(dtMs);
    const ek = 1 - Math.exp(-CONFIG.prismTurnRate * dtMs / 1000);
    for (const a of this.prismAngle.values()) a.cur += (a.to - a.cur) * ek;
    const sk = 1 - Math.exp((-CONFIG.slideRate * dtMs) / 1000);
    this.slide = this.slide.map((v, i) => v + (posOf(this.pieceCells[i]!, this.rots[i]!) - v) * sk);
    this.fades = this.fades.filter((f) => this.retracted(f) < segLen(f.seg));
    this.flipAutos();

    // Faíscas: onde a luz já chegou num obstáculo, ricocheteiam de volta (contra a direção do feixe).
    // Faísca assim que a ponta da luz encosta no obstáculo (um pouco antes do fim exato do trecho,
    // que a desaceleração da frente de luz demora a cobrir).
    const reached = arrived(this.plan, this.fronts(CONFIG.beam.sparks.lead));
    for (const h of this.hits) {
      if (reached[`${h.x},${h.y}`] === undefined) continue;
      let n = (CONFIG.beam.sparks.perSec * dtMs) / 1000;
      while (n > 0) {
        if (n >= 1 || Math.random() < n) {
          // Cor do feixe clareada: faísca lê como luz quente, não some no brilho do feixe.
          this.fx.spark(cx(this.layout, h.x), cy(this.layout, h.y), -h.dx, -h.dy, mix(CONFIG.colors[h.color], '#ffffff', 0.45));
        }
        n -= 1;
      }
    }

    // Vitória: pulso de luz caminha pelos feixes; alvos ficam acesos.
    if (this.wonAt !== null) {
      if (this.now >= this.replayAt) {
        this.replayAt = Infinity;
        this.pulseAt = this.now;
        const P = CONFIG.winPulse;
        const ms = Math.min(P.ms[1], Math.max(P.ms[0], ((this.plan.to + P.width * 2) / P.speed) * 1000));
        this.pulseSpeed = (this.plan.to + P.width * 2) / ms; // células por ms
        this.nextAt = this.now + ms + P.holdMs;
      }
      if (this.now >= this.nextAt) this.load(this.nextIndex(this.index));
      return;
    }

    // Cada alvo reage no instante em que a luz toca o anel (raio ringRadius), não o centro.
    const got = arrived(this.plan, this.fronts(CONFIG.piece.ringRadius));
    let down = false;
    for (const t of this.level.cells) {
      if (t.t !== 'target') continue;
      const k = key(t.x, t.y);
      const lit = got[k] === t.color;
      if (lit && !this.litAt.has(k)) {
        this.litAt.set(k, this.now);
        this.fx.pulse(cx(this.layout, t.x), cy(this.layout, t.y), CONFIG.colors[t.color], this.layout.cell);
        if (!this.quiet) this.synth.note(this.litAt.size - 1);
      } else if (!lit && this.litAt.has(k)) {
        this.litAt.delete(k);
        down = true;
      }
    }
    if (down && !this.quiet) this.synth.down();

    // Som do prisma quando a frente de luz chega nele (inclusive ao abrir a fase); um intervalo mínimo
    // evita rajada ao arrastar um prisma em trilho.
    const atCenter = arrived(this.plan, this.fronts());
    for (const c of placeCells(this.level, this.rots)) {
      if (c.t !== 'prism') continue;
      const k = key(c.x, c.y);
      // Só luz branca chegando no prisma faz som (luz colorida passa em silêncio).
      if (atCenter[k] !== 7) {
        this.prismHit.delete(k);
      } else if (!this.prismHit.has(k)) {
        this.prismHit.add(k);
        if (this.now - this.prismSoundAt >= CONFIG.audio.prism.minGapMs) {
          this.prismSoundAt = this.now;
          this.synth.prism();
        }
      }
    }
    if (!this.growing()) this.quiet = false;
    // Vitória assim que o último alvo acende: não espera o resto da luz (ramos indo para paredes ou
    // para fora da grade) terminar de crescer.
    const targets = this.level.cells.filter((c) => c.t === 'target');
    // Alvo com carga precisa estar aceso há charge ms seguidos.
    const allLit =
      targets.length > 0 &&
      targets.every((t) => {
        const at = this.litAt.get(key(t.x, t.y));
        return at !== undefined && (t.t !== 'target' || !t.charge || this.now - at >= t.charge);
      });
    if (this.result.solved && allLit && this.wonAt === null && !this.editing) this.win();

  }

  render(ctx: CanvasRenderingContext2D): void {
    const l = this.layout;
    drawBackground(ctx, l, this.background(), this.level.w, this.level.h);
    if (this.wonAt !== null) drawWinWave(ctx, l, this.level.w, this.level.h, this.waves, this.now - this.wonAt);
    const grow = this.wonAt === null ? 0 : easeOut(clamp01((this.now - this.wonAt) / CONFIG.beam.winGrowMs));
    const style: BeamStyle = {
      t: this.growing() ? 0 : 1,
      widthMul: 1 + (CONFIG.beam.winWidthMul - 1) * grow,
      rainbow: this.rainbow(),
      time: this.now / 1000,
      pulse: this.now >= this.pulseAt ? (this.now - this.pulseAt) * this.pulseSpeed - CONFIG.winPulse.width : undefined,
    };
    const front = this.fronts();
    const fading = this.fades.map((f) => {
      const len = segLen(f.seg);
      const r = Math.max(0, this.retracted(f));
      return { seg: cut(f.seg, r, len), d0: r, alpha: 1 - 0.5 * clamp01(r / len) };
    });
    drawPrismGlow(ctx, l, placeCells(this.level, this.rots), visibleSegments(this.plan, front), style);
    drawBeams(ctx, l, this.plan, front, fading, style);
    const got = arrived(this.plan, this.fronts(CONFIG.piece.ringRadius));
    drawRails(ctx, l, this.level.cells);
    drawLinks(ctx, l, this.drawnCells());
    drawFibers(ctx, l, this.level.cells, this.plan, this.fronts());
    drawPieces(ctx, l, this.drawnCells(), {
      mirrorAngle: (i) => this.animValue(this.anims[i]!, CONFIG.mirrorSpinMs),
      filterColor: (i) => {
        const a = this.anims[i]!;
        return { from: a.from, to: a.to, k: easeOut(clamp01((this.now - a.at) / CONFIG.filterSwapMs)) };
      },
      targetFill: (x, y) => {
        const at = this.litAt.get(key(x, y));
        return at === undefined ? 0 : easeOut(clamp01((this.now - at) / CONFIG.targetFillMs));
      },
      targetReceived: (x, y) => got[key(x, y)] ?? 0,
      charge: (x, y, ms) => {
        const at = this.litAt.get(key(x, y));
        return at === undefined ? 0 : clamp01((this.now - at) / ms);
      },
      autoPhase: clamp01((this.now - this.autoAt) / CONFIG.auto.periodMs),
      prismAngle: (ci) => this.prismAngle.get(ci)?.cur ?? -QUARTER,
      gateOpen: (id) => this.result.open.includes(id),
      bender: (i) => {
        const a = this.anims[i]!;
        return { from: a.from, to: a.to, k: easeOut(clamp01((this.now - a.at) / CONFIG.filterSwapMs)) };
      },
      darkHit: (x, y) => this.result.dark.includes(key(x, y)),
      time: this.now / 1000,
    });
    drawImpacts(ctx, l, this.hits, this.plan, this.fronts(CONFIG.beam.sparks.lead), style); // clarão junto com as faíscas
    this.fx.draw(ctx, l.w, l.h);
    if (this.editing) this.drawEditOverlay(ctx);
    drawHud(ctx, l, {
      level: this.index + 1,
      difficulty: this.level.difficulty ?? 1,
      appear: this.now - this.loadedAt,
      win: this.wonAt === null ? 0 : Math.sin(Math.PI * clamp01((this.now - this.wonAt) / CONFIG.winDelayMs)),
      rainbow: this.rainbow(),
      time: this.now / 1000,
      accent: this.accent(),
    });
    if (this.debug) drawDebug(ctx, l, this.level.w, this.level.h, this.fps);
  }

  // Editor: contorno tracejado da grade, linhas das células e destaque da peça sendo arrastada.
  private drawEditOverlay(ctx: CanvasRenderingContext2D): void {
    const l = this.layout;
    const { w, h } = this.level;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < w; x++) {
      ctx.moveTo(l.ox + x * l.cell + 0.5, l.oy);
      ctx.lineTo(l.ox + x * l.cell + 0.5, l.oy + h * l.cell);
    }
    for (let y = 1; y < h; y++) {
      ctx.moveTo(l.ox, l.oy + y * l.cell + 0.5);
      ctx.lineTo(l.ox + w * l.cell, l.oy + y * l.cell + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(l.ox + 0.5, l.oy + 0.5, w * l.cell - 1, h * l.cell - 1);
    const m = this.editMark;
    if (m) {
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(l.ox + m.x * l.cell + 3, l.oy + m.y * l.cell + 3, l.cell - 6, l.cell - 6, 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Cor de fundo atual: transição suave da fase anterior para a desta.
  private background(): readonly [string, string] {
    const to = CONFIG.backgrounds[Math.floor(this.index / 10) % CONFIG.backgrounds.length]!;
    const t = clamp01((this.now - this.bgAt) / CONFIG.backgroundFadeMs);
    if (!this.bgFrom || t >= 1) return to;
    const from = this.bgFrom;
    return [mix(from[0], to[0], t), mix(from[1], to[1], t)];
  }

  private rainbow(): number {
    const d = this.level.difficulty ?? 1;
    const from = CONFIG.rainbow.fromDifficulty;
    return d < from ? 0 : clamp01((d - from + 1) / (5 - from + 1));
  }

  private accent(): string {
    const t = this.level.cells.find((c) => c.t === 'target');
    return t?.t === 'target' ? CONFIG.colors[t.color] : '#ffffff';
  }

  private win(): void {
    this.done.add(this.index);
    this.persist();
    this.onWin?.();
    this.wonAt = this.now;
    this.waves = this.level.cells.flatMap((c) => (c.t === 'target' ? [{ x: c.x, y: c.y, color: c.color, at: 0 }] : []));
    this.waves.forEach((w, i) => (w.at = i * CONFIG.winWave.stagger));
    this.replayAt = this.now + CONFIG.winPulse.pauseMs;
    this.synth.chord((this.index + 1) % 5 === 0);
    this.fx.flash();
    this.fx.burst(
      this.level.cells.flatMap((c) =>
        c.t === 'target' ? [{ x: cx(this.layout, c.x), y: cy(this.layout, c.y), color: CONFIG.colors[c.color] }] : [],
      ),
      this.rainbow(),
    );
  }


  private retracted(f: { at: number; off: number }): number {
    return ((this.now - f.at) / 1000) * CONFIG.beam.retractSpeed - f.off;
  }

  private animValue(a: Anim, ms: number): number {
    return a.from + (a.to - a.from) * easeOut(clamp01((this.now - a.at) / ms));
  }

  // Segmentos do trace esticados até encostar nos obstáculos; guarda onde a luz bate.
  // Ponta do prisma aponta de onde vem a luz; sem luz chegando, fica como está. Gira pelo caminho mais curto.
  private aimPrisms(instant: boolean): void {
    for (const [k, c] of placeCells(this.level, this.rots).entries()) {
      if (c.t !== 'prism') continue;
      const inc = this.result.segments.find((s) => s.x2 === c.x && s.y2 === c.y);
      const cur = this.prismAngle.get(k)?.cur ?? -QUARTER;
      if (!inc) {
        this.prismAngle.set(k, { cur, to: this.prismAngle.get(k)?.to ?? cur });
        continue;
      }
      let to = Math.atan2(inc.y1 - inc.y2, inc.x1 - inc.x2);
      to = cur + ((((to - cur) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      this.prismAngle.set(k, { cur: instant ? to : cur, to });
    }
  }

  // Células como desenhadas: peças em trilho na posição deslizante (fracionária durante a animação).
  private drawnCells(): Cell[] {
    let pi = 0;
    return this.level.cells.map((c) => {
      if (!isPiece(c)) return c;
      const i = pi++;
      const rail = railOf(c);
      if (!rail) return c;
      const p = this.slide[i]!;
      return { ...c, x: c.x + (rail.axis === 'x' ? p : 0), y: c.y + (rail.axis === 'y' ? p : 0) };
    });
  }

  // Outro portal do par do portal em (x, y), como "x,y".
  private portalPair(x: number, y: number): string | undefined {
    const c = this.level.cells.find((q) => (q.t === 'portal' || q.t === 'fiber') && q.x === x && q.y === y);
    if (c?.t !== 'portal' && c?.t !== 'fiber') return undefined;
    const q = this.level.cells.find((o) => o !== c && o.t === c.t && o.pair === c.pair);
    return q && key(q.x, q.y);
  }

  private beamSegments(): Segment[] {
    const E = CONFIG.emitter.body;
    const W = CONFIG.piece.wallSize / 2;
    const { segs, hits } = extendToObstacles(this.result.segments, this.level.cells, (c) =>
      c.t === 'wall' || c.t === 'gate' ? W : c.t === 'emitter' ? E : c.t === 'diode' ? CONFIG.diode.half : 0.5,
    );
    this.hits = segs.flatMap((s, i) =>
      hits[i] ? [{ x: s.x2, y: s.y2, dx: Math.sign(s.x2 - s.x1), dy: Math.sign(s.y2 - s.y1), color: s.color }] : [],
    );
    return segs;
  }
}
