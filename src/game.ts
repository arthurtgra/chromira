import { Synth } from './audio/synth.ts';
import { CONFIG } from './config.ts';
import { key, pieceStates, pieces, startRots, trace } from './core/trace.ts';
import type { Cell, Level, Rots, Segment, TraceResult } from './core/types.ts';
import { cellAt } from './input.ts';
import { cut, planBeams, segLen, visibleSegments, type BeamPlan } from './render/beams.ts';
import {
  drawBackground,
  drawBeams,
  drawDebug,
  drawPieces,
  drawPrismGlow,
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
  private shown!: TraceResult; // o que os alvos exibem; alcança result quando o feixe termina de desenhar
  private pieceCells: Cell[] = [];
  private anims: Anim[] = [];
  private now = 0;
  private loadedAt = 0;
  private beamAt = 0;
  private bgFrom: readonly [string, string] | null = null;
  private bgAt = 0;
  private plan: BeamPlan = planBeams([], []);
  private fades: { seg: Segment; at: number; off: number }[] = [];
  private beamMs = 1;
  private pending = false;
  private pendingDown = false;
  private litAt = new Map<string, number>();
  private wonAt: number | null = null;
  private fps = 60;
  private readonly levels: Level[];

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
      const v = this.pieceCells[i]!.t === 'filter' ? r : r === 0 ? -QUARTER / 2 : QUARTER / 2;
      return { from: v, to: v, at: -Infinity };
    });
    this.result = trace(this.level, this.rots);
    this.shown = this.result;
    this.litAt = new Map(this.litKeys(this.result).map((k) => [k, -Infinity]));
    this.pending = false;
    this.pendingDown = false;
    this.plan = planBeams([], this.result.segments);
    this.fades = [];
    this.timeBeam(CONFIG.beam.speed);
    this.beamAt = this.now;
    this.loadedAt = this.now;
    this.wonAt = null;
    this.fx.clear();
    writeSave({ level: this.index, muted: this.synth.muted });
  }

  resize(w: number, h: number): void {
    this.layout = computeLayout(w, h, this.level.w, this.level.h);
  }

  setMuted(m: boolean): void {
    this.synth.muted = m;
    writeSave({ level: this.index, muted: m });
  }

  tap(px: number, py: number): void {
    this.synth.unlock();
    if (this.wonAt !== null) return;
    const c = cellAt(this.layout, px, py, this.level.w, this.level.h);
    if (!c) return;
    const i = this.pieceCells.findIndex((m) => m.x === c.x && m.y === c.y);
    if (i < 0) return;
    const cell = this.pieceCells[i]!;

    this.rots[i] = (this.rots[i]! + 1) % pieceStates(cell);
    const a = this.anims[i]!;
    if (cell.t !== 'filter') {
      this.anims[i] = { from: this.animValue(a, CONFIG.mirrorSpinMs), to: a.to + QUARTER, at: this.now };
      this.synth.turn();
    } else {
      this.anims[i] = { from: a.to, to: this.rots[i]!, at: this.now };
      this.synth.turn(true);
    }
    navigator.vibrate?.(CONFIG.vibrateMs);

    const before = visibleSegments(this.plan, this.front());
    this.result = trace(this.level, this.rots);
    this.plan = planBeams(before, this.result.segments);
    // Recolhe o que sumiu a partir do ponto que mudou: trechos encadeados recolhem em sequência.
    let off = 0;
    let prev: Segment | null = null;
    for (const seg of this.plan.fading) {
      off = prev && prev.x2 === seg.x1 && prev.y2 === seg.y1 ? off + segLen(prev) : 0;
      this.fades.push({ seg, at: this.now, off });
      prev = seg;
    }
    this.timeBeam(CONFIG.beam.turnSpeed);
    const lit = new Set(this.litKeys(this.result));
    for (const k of [...this.litAt.keys()]) {
      if (lit.has(k)) continue;
      this.litAt.delete(k);
      this.pendingDown = true;
    }
    this.pending = true;
    this.beamAt = this.now;
  }

  update(dtMs: number): void {
    this.now += dtMs;
    this.fps += (1000 / Math.max(1, dtMs) - this.fps) * 0.05;
    this.fx.update(dtMs);
    this.fades = this.fades.filter((f) => this.retracted(f) < segLen(f.seg));

    // Efeitos de alvo só disparam quando o feixe termina de ser desenhado.
    if (this.pending && this.front() >= this.plan.to) {
      this.pending = false;
      this.shown = this.result;
      if (this.pendingDown) this.synth.down();
      this.pendingDown = false;
      for (const k of this.litKeys(this.result)) {
        if (this.litAt.has(k)) continue;
        this.litAt.set(k, this.now);
        const [x, y] = k.split(',').map(Number) as [number, number];
        const t = this.level.cells.find((c) => c.x === x && c.y === y);
        if (t?.t === 'target') this.fx.pulse(cx(this.layout, x), cy(this.layout, y), CONFIG.colors[t.color], this.layout.cell);
        this.synth.note(this.litAt.size - 1);
      }
      if (this.result.solved) this.win();
    }

    if (this.wonAt !== null && this.now - this.wonAt > CONFIG.winDelayMs) this.load(this.index + 1);
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
    };
    const front = this.front();
    const fading = this.fades.map((f) => {
      const len = segLen(f.seg);
      const r = Math.max(0, this.retracted(f));
      return { seg: cut(f.seg, r, len), d0: r, alpha: 1 - 0.5 * clamp01(r / len) };
    });
    drawPrismGlow(ctx, l, this.level.cells, this.result.segments, style);
    drawBeams(ctx, l, this.plan, front, fading, style);
    drawPieces(ctx, l, this.level.cells, {
      mirrorAngle: (i) => this.animValue(this.anims[i]!, CONFIG.mirrorSpinMs),
      filterColor: (i) => {
        const a = this.anims[i]!;
        return { from: a.from, to: a.to, k: easeOut(clamp01((this.now - a.at) / CONFIG.filterSwapMs)) };
      },
      targetFill: (x, y) => {
        const at = this.litAt.get(key(x, y));
        return at === undefined ? 0 : easeOut(clamp01((this.now - at) / CONFIG.targetFillMs));
      },
      targetReceived: (x, y) => this.shown.received[key(x, y)] ?? 0,
      time: this.now / 1000,
    });
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
    this.wonAt = this.now;
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

  private litKeys(r: TraceResult): string[] {
    return this.level.cells.flatMap((c) =>
      c.t === 'target' && r.received[key(c.x, c.y)] === c.color ? [key(c.x, c.y)] : [],
    );
  }
}
