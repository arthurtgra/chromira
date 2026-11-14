import { Synth } from './audio/synth.ts';
import { CONFIG } from './config.ts';
import { baseStates, isPiece, key, pieces, placeCells, posOf, railOf, rotOf, startRots, trace } from './core/trace.ts';
import type { Cell, Color, Level, Rots, Segment, TraceResult } from './core/types.ts';
import { cellAt } from './input.ts';
import { arrived, cut, extendToObstacles, planBeams, segLen, visibleSegments, type BeamPlan } from './render/beams.ts';
import {
  drawBackground,
  drawBeams,
  drawDebug,
  drawPieces,
  drawImpacts,
  drawPrismGlow,
  drawRails,
  mix,
  type BeamStyle,
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
  private beamAt = 0;
  private bgFrom: readonly [string, string] | null = null;
  private bgAt = 0;
  private plan: BeamPlan = planBeams([], []);
  private fades: { seg: Segment; at: number; off: number }[] = [];
  private beamMs = 1;
  private quiet = true; // sem notas enquanto a fase abre
  private litAt = new Map<string, number>();
  private prismAngle = new Map<number, { cur: number; to: number }>(); // por índice em level.cells; // ponta do prisma virada para a luz que chega
  private wonAt: number | null = null;
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

  constructor(levels: Level[]) {
    this.levels = levels;
  }

  load(index: number): void {
    if (this.level) this.bgFrom = this.background();
    this.bgAt = this.now;
    this.index = ((index % this.levels.length) + this.levels.length) % this.levels.length;
    this.level = this.levels[this.index]!;
    this.rots = startRots(this.level);
    this.pieceCells = pieces(this.level);
    this.anims = this.rots.map((r, i) => {
      const c = this.pieceCells[i]!;
      const v = c.t === 'filter' ? rotOf(c, r) : rotOf(c, r) === 0 ? -QUARTER / 2 : QUARTER / 2;
      return { from: v, to: v, at: -Infinity };
    });
    this.slide = this.rots.map((r, i) => posOf(this.pieceCells[i]!, r));
    this.drag = null;
    this.result = trace(this.level, this.rots);
    this.prismAngle = new Map();
    this.aimPrisms(true);
    this.litAt = new Map();
    this.quiet = true;
    this.plan = planBeams([], this.beamSegments());
    this.fades = [];
    this.timeBeam(CONFIG.beam.speed);
    this.beamAt = this.now;
    this.loadedAt = this.now;
    this.wonAt = null;
    this.replayAt = Infinity;
    this.pulseAt = Infinity;
    this.nextAt = Infinity;
    this.fx.clear();
    this.persist();
    this.onLoad?.();
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
    if (this.wonAt !== null) return;
    const c = cellAt(this.layout, px, py, this.level.w, this.level.h);
    if (!c) return;
    const placed = placeCells(this.level, this.rots).filter(isPiece);
    const i = placed.findIndex((m) => m.x === c.x && m.y === c.y);
    if (i < 0) return;
    if (railOf(this.pieceCells[i]!)) this.drag = { i, px, py, moved: false };
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
    const cell = this.pieceCells[i]!;
    const s = this.rots[i]!;
    const r = rotOf(cell, s);
    this.rots[i] = s - r + ((r + 1) % baseStates(cell));
    const a = this.anims[i]!;
    if (cell.t !== 'filter') {
      this.anims[i] = { from: this.animValue(a, CONFIG.mirrorSpinMs), to: a.to + QUARTER, at: this.now };
      this.synth.turn();
    } else {
      this.anims[i] = { from: a.to, to: this.rots[i]!, at: this.now };
      this.synth.turn(true);
    }
    navigator.vibrate?.(CONFIG.vibrateMs);
    this.retrace();
  }

  private retrace(): void {
    const before = visibleSegments(this.plan, this.front());
    this.result = trace(this.level, this.rots);
    this.aimPrisms(false);
    this.plan = planBeams(before, this.beamSegments());
    this.quiet = false;
    // Recolhe o que sumiu a partir do ponto que mudou: trechos encadeados recolhem em sequência.
    let off = 0;
    let prev: Segment | null = null;
    for (const seg of this.plan.fading) {
      off = prev && prev.x2 === seg.x1 && prev.y2 === seg.y1 ? off + segLen(prev) : 0;
      this.fades.push({ seg, at: this.now, off });
      prev = seg;
    }
    this.timeBeam(CONFIG.beam.turnSpeed);
    this.beamAt = this.now;
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

    // Faíscas: onde a luz já chegou num obstáculo, ricocheteiam de volta (contra a direção do feixe).
    const reached = arrived(this.plan, this.front());
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

    // Cada alvo reage no instante em que a luz chega nele (ou deixa de chegar).
    const front = this.front();
    const got = arrived(this.plan, front);
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
    if (front >= this.plan.to) {
      this.quiet = false;
      if (this.result.solved && this.wonAt === null) this.win();
    }

  }

  render(ctx: CanvasRenderingContext2D): void {
    const l = this.layout;
    drawBackground(ctx, l, this.background(), this.level.w, this.level.h);
    const grow = this.wonAt === null ? 0 : easeOut(clamp01((this.now - this.wonAt) / CONFIG.beam.winGrowMs));
    const style: BeamStyle = {
      t: this.beamT(),
      widthMul: 1 + (CONFIG.beam.winWidthMul - 1) * grow,
      rainbow: this.rainbow(),
      time: this.now / 1000,
      pulse: this.now >= this.pulseAt ? (this.now - this.pulseAt) * this.pulseSpeed - CONFIG.winPulse.width : undefined,
    };
    const front = this.front();
    const fading = this.fades.map((f) => {
      const len = segLen(f.seg);
      const r = Math.max(0, this.retracted(f));
      return { seg: cut(f.seg, r, len), d0: r, alpha: 1 - 0.5 * clamp01(r / len) };
    });
    drawPrismGlow(ctx, l, placeCells(this.level, this.rots), visibleSegments(this.plan, front), style);
    drawBeams(ctx, l, this.plan, front, fading, style);
    const got = arrived(this.plan, front);
    drawRails(ctx, l, this.level.cells);
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
      prismAngle: (ci) => this.prismAngle.get(ci)?.cur ?? -QUARTER,
      time: this.now / 1000,
    });
    drawImpacts(ctx, l, this.hits, this.plan, front, style);
    this.fx.draw(ctx, l.w, l.h);
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

  // Cor de fundo atual: transição suave da fase anterior para a desta.
  private background(): readonly [string, string] {
    const to = CONFIG.backgrounds[this.index % CONFIG.backgrounds.length]!;
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

  // Distância da fonte já alcançada pela frente de luz, em células.
  // Distância da fonte já alcançada pela frente de luz: rápida no começo, desacelera no fim.
  private front(): number {
    const { from, to } = this.plan;
    return from + (to - from) * easeOut(clamp01((this.now - this.beamAt) / this.beamMs));
  }

  private timeBeam(speed: number): void {
    const [lo, hi] = CONFIG.beam.growMs;
    this.beamMs = Math.min(hi, Math.max(lo, ((this.plan.to - this.plan.from) / speed) * 1000));
  }

  private retracted(f: { at: number; off: number }): number {
    return ((this.now - f.at) / 1000) * CONFIG.beam.retractSpeed - f.off;
  }

  private beamT(): number {
    const { from, to } = this.plan;
    return to > from ? clamp01((this.front() - from) / (to - from)) : 1;
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

  private beamSegments(): Segment[] {
    const E = CONFIG.emitter.body;
    const W = CONFIG.piece.wallSize / 2;
    const { segs, hits } = extendToObstacles(this.result.segments, this.level.cells, (c) =>
      c.t === 'wall' ? W : c.t === 'emitter' ? E : 0.5,
    );
    this.hits = segs.flatMap((s, i) =>
      hits[i] ? [{ x: s.x2, y: s.y2, dx: Math.sign(s.x2 - s.x1), dy: Math.sign(s.y2 - s.y1), color: s.color }] : [],
    );
    return segs;
  }
}
