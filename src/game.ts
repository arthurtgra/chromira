import { Synth } from './audio/synth.ts';
import { CONFIG } from './config.ts';
import { key, startRots, trace } from './core/trace.ts';
import type { Level, Rots, TraceResult } from './core/types.ts';
import { cellAt } from './input.ts';
import { drawBackground, drawBeams, drawDebug, drawHud, drawPieces } from './render/draw.ts';
import { Fx } from './render/fx.ts';
import { computeLayout, cx, cy, type Layout } from './render/layout.ts';
import { writeSave } from './save.ts';

const QUARTER = Math.PI / 2;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

interface Spin {
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
  private mirrorCells: { x: number; y: number }[] = [];
  private spins: Spin[] = [];
  private now = 0;
  private beamAt = 0;
  private pending = false;
  private pendingDown = false;
  private litAt = new Map<string, number>();
  private wonAt: number | null = null;
  private fps = 60;

  private readonly levels: Level[];

  constructor(levels: Level[]) {
    this.levels = levels;
  }

  get levelIndex(): number {
    return this.index;
  }

  load(index: number): void {
    this.index = ((index % this.levels.length) + this.levels.length) % this.levels.length;
    this.level = this.levels[this.index]!;
    this.rots = startRots(this.level);
    this.mirrorCells = this.level.cells.filter((c) => c.t === 'mirror');
    this.spins = this.rots.map((r) => {
      const a = r === 0 ? -QUARTER / 2 : QUARTER / 2;
      return { from: a, to: a, at: -Infinity };
    });
    this.result = trace(this.level, this.rots);
    this.litAt = new Map(this.litKeys(this.result).map((k) => [k, -Infinity]));
    this.pending = false;
    this.pendingDown = false;
    this.beamAt = this.now;
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
    const i = this.mirrorCells.findIndex((m) => m.x === c.x && m.y === c.y);
    if (i < 0) return;

    this.rots[i] = this.rots[i] === 0 ? 1 : 0;
    const s = this.spins[i]!;
    this.spins[i] = { from: this.spinAngle(s), to: s.to + QUARTER, at: this.now };
    this.synth.click();
    navigator.vibrate?.(CONFIG.vibrateMs);

    this.result = trace(this.level, this.rots);
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

    // Efeitos de alvo só disparam quando o feixe termina de ser desenhado.
    if (this.pending && this.beamT() >= 1) {
      this.pending = false;
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
    const bg = CONFIG.backgrounds[Math.floor(this.index / 5) % CONFIG.backgrounds.length]!;
    drawBackground(ctx, l, bg, this.level.w, this.level.h);
    const grow = this.wonAt === null ? 0 : easeOut(clamp01((this.now - this.wonAt) / CONFIG.beam.winGrowMs));
    drawBeams(ctx, l, this.result.segments, this.beamT(), 1 + (CONFIG.beam.winWidthMul - 1) * grow);
    drawPieces(ctx, l, this.level.cells, {
      mirrorAngle: (i) => this.spinAngle(this.spins[i]!),
      targetFill: (x, y) => {
        const at = this.litAt.get(key(x, y));
        return at === undefined ? 0 : easeOut(clamp01((this.now - at) / CONFIG.targetFillMs));
      },
    });
    this.fx.draw(ctx, l.w, l.h);
    drawHud(ctx, l, this.index + 1);
    if (this.debug) drawDebug(ctx, l, this.level.w, this.level.h, this.fps);
  }

  private win(): void {
    this.wonAt = this.now;
    const big = (this.index + 1) % 5 === 0;
    this.synth.chord(big);
    this.fx.flash();
    this.fx.burst(
      this.level.cells.flatMap((c) =>
        c.t === 'target' ? [{ x: cx(this.layout, c.x), y: cy(this.layout, c.y), color: CONFIG.colors[c.color] }] : [],
      ),
    );
  }

  private beamT(): number {
    return clamp01((this.now - this.beamAt) / CONFIG.beam.drawMs);
  }

  private spinAngle(s: Spin): number {
    return s.from + (s.to - s.from) * easeOut(clamp01((this.now - s.at) / CONFIG.mirrorSpinMs));
  }

  private litKeys(r: TraceResult): string[] {
    return this.level.cells.flatMap((c) =>
      c.t === 'target' && r.received[key(c.x, c.y)] === c.color ? [key(c.x, c.y)] : [],
    );
  }
}
