import { CONFIG } from '../config.ts';

const A = CONFIG.audio;

// Sons sintetizados com Web Audio. O AudioContext só nasce no primeiro toque (regra do navegador).
export class Synth {
  private _muted = false;
  private musicWanted = false;
  private music: { gain: GainNode; timer: number; nextChord: number; nextNote: number; chord: number } | null = null;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private echo: AudioNode | null = null;
  private lastTone = -1;
  private bus: AudioNode | null = null; // entrada do master: suaviza e manda para a reverberação

  unlock(): void {
    if (!this.ctx) {
      // Safari iOS: sem isso a chave de silencioso corta todo o Web Audio.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
      this.ctx = new AudioContext();
      const len = Math.ceil((this.ctx.sampleRate * A.clickMs) / 1000);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this.bus = this.makeBus(this.ctx);
      this.echo = this.makeEcho(this.ctx);
    }
    if (this.musicWanted && !this.music) this.startMusic();
    if (this.ctx.state !== 'running') {
      void this.ctx.resume().catch(() => {});
      // iOS só libera o áudio depois de tocar algo dentro do gesto.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      src.connect(this.ctx.destination);
      src.start();
    }
  }

  // Eco curto com realimentação: dá ar e cauda aos sons de toque.
  // Master: passa-baixa suave (tira o brilho áspero) + reverberação de sala sintética em paralelo
  // + compressor leve no fim para os acordes não estourarem.
  private makeBus(ctx: AudioContext): AudioNode {
    const R = A.reverb;
    const input = ctx.createGain();
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = A.softHz;
    soft.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    input.connect(soft);
    soft.connect(comp);

    const len = Math.floor(ctx.sampleRate * R.seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Ruído decaindo, com início suave (pré-delay) para a cauda não embolar o ataque.
        data[i] = (Math.random() * 2 - 1) * (1 - t) ** R.decay * Math.min(1, i / (ctx.sampleRate * 0.012));
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = R.wet;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = R.toneHz;
    soft.connect(conv).connect(dark).connect(wet).connect(comp);
    comp.connect(ctx.destination);
    return input;
  }

  private makeEcho(ctx: AudioContext): AudioNode {
    const input = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = A.echo.delayMs / 1000;
    const fb = ctx.createGain();
    fb.gain.value = A.echo.feedback;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3000;
    const wet = ctx.createGain();
    wet.gain.value = A.echo.wet;
    input.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(wet).connect(this.bus!);
    return input;
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    if (this.music && this.ctx) this.music.gain.gain.setTargetAtTime(m ? 0 : A.music.volume, this.ctx.currentTime, 0.2);
  }

  // Sino zen: seno com um harmônico fraco, ataque macio e cauda longa na reverberação.
  private bell(freq: number, at: number, vol: number, ms: number, out?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const t0 = ctx.currentTime + at / 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    g.connect(out ?? this.bus);
    for (const [mul, v] of [[1, 1], [2.01, 0.18], [3, 0.05]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * mul;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + ms / 1000 + 0.05);
    }
  }

  // Botões do menu: um sino suave.
  uiTap(): void {
    if (!this.ready()) return;
    this.bell(A.ui.tapHz, 0, A.volume * A.ui.volume, A.ui.ms);
  }

  // Escolher fase / jogar: duas notas subindo.
  uiSelect(): void {
    if (!this.ready()) return;
    const [a, b] = A.ui.selectHz;
    this.bell(a, 0, A.volume * A.ui.volume, A.ui.ms);
    this.bell(b, A.ui.stepMs, A.volume * A.ui.volume, A.ui.ms * 1.4);
  }

  // Música do menu: pedido fica guardado até o áudio ser liberado pelo primeiro toque.
  setMusic(on: boolean): void {
    this.musicWanted = on;
    if (on && !this.music && this.ctx) this.startMusic();
    if (!on && this.music) this.stopMusic();
  }

  private startMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const M = A.music;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(this._muted ? 0 : M.volume, ctx.currentTime + M.fadeInMs / 1000);
    gain.connect(this.bus);
    const m = { gain, timer: 0, nextChord: ctx.currentTime + 0.1, nextNote: ctx.currentTime + 1.5, chord: 0 };
    // Agenda com folga de 1 s à frente; o setInterval só precisa acordar de vez em quando.
    const tick = (): void => {
      const now = ctx.currentTime;
      while (m.nextChord < now + 1) {
        const chord = M.chords[m.chord % M.chords.length]!;
        for (const f of chord) this.pad(f, m.nextChord, M.chordMs / 1000, gain);
        m.chord++;
        m.nextChord += M.chordMs / 1000;
      }
      while (m.nextNote < now + 1) {
        if (Math.random() < M.noteChance) {
          const f = M.melody[Math.floor(Math.random() * M.melody.length)]!;
          this.bell(f, (m.nextNote - now) * 1000, M.noteVolume, M.noteMs, gain);
        }
        m.nextNote += M.noteGapMs[0] / 1000 + (Math.random() * (M.noteGapMs[1] - M.noteGapMs[0])) / 1000;
      }
    };
    tick();
    m.timer = window.setInterval(tick, 250);
    this.music = m;
  }

  private stopMusic(): void {
    const m = this.music;
    const ctx = this.ctx;
    if (!m || !ctx) return;
    this.music = null;
    window.clearInterval(m.timer);
    m.gain.gain.cancelScheduledValues(ctx.currentTime);
    m.gain.gain.setTargetAtTime(0, ctx.currentTime, A.music.fadeOutMs / 3000);
    window.setTimeout(() => m.gain.disconnect(), A.music.fadeOutMs + 4000);
  }

  // Nota de pad: dois senos levemente desafinados, entrada e saída bem lentas.
  private pad(freq: number, t0: number, dur: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const M = A.music;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(M.padVolume, t0 + M.padAttackMs / 1000);
    g.gain.setValueAtTime(M.padVolume, t0 + dur);
    g.gain.linearRampToValueAtTime(0, t0 + dur + M.padReleaseMs / 1000);
    g.connect(out);
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur + M.padReleaseMs / 1000 + 0.05);
    }
  }

  private ready(): AudioContext | null {
    return this._muted || !this.ctx ? null : this.ctx;
  }

  click(hz: number = A.clickFilterHz): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.value = A.volume * 1.5;
    src.connect(filter).connect(gain).connect(this.bus!);
    src.start();
  }

  // Girar espelho/filtro: tim de vidro.
  turn(filter = false): void {
    const ctx = this.ready();
    if (!ctx || !this.noise || !this.echo) return;
    const T = A.turn;
    const t0 = ctx.currentTime;
    const n = T.glassHz.length;
    let pick = Math.floor(Math.random() * (this.lastTone < 0 ? n : n - 1));
    if (this.lastTone >= 0 && pick >= this.lastTone) pick++; // nunca o mesmo tom duas vezes seguidas
    this.lastTone = pick;
    const base = T.glassHz[pick]! * (filter ? T.filterMul : 1) * (1 + (Math.random() * 2 - 1) * T.detune);

    const out = ctx.createGain();
    out.gain.value = A.volume * T.volume;
    out.connect(this.bus!);
    out.connect(this.echo);

    const tick = ctx.createBufferSource();
    tick.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(T.tickVolume, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + T.tickMs / 1000);
    tick.connect(hp).connect(tg).connect(out);
    tick.start(t0);
    tick.stop(t0 + T.tickMs / 1000 + 0.01);

    for (const [ratio, vol, ms] of T.partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + T.attackMs / 1000);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + ms / 1000 + 0.02);
    }
  }

  private tone(freq: number, ms: number, vol: number, at = 0, type: OscillatorType = 'sine'): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t0 = ctx.currentTime + at / 1000;
    const dur = ms / 1000;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.bus!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private freq(i: number): number {
    const n = A.scale.length;
    return A.scale[((i % n) + n) % n]! * 2 ** Math.floor(i / n);
  }

  // i-ésimo grau da escala pentatônica; cada alvo aceso sobe um grau.
  note(i: number): void {
    this.tone(this.freq(i), A.noteMs, A.volume, 0, 'triangle');
  }

  down(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(this.freq(2), t0);
    osc.frequency.exponentialRampToValueAtTime(this.freq(-2), t0 + A.downMs / 1000);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(A.volume * A.downVolume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + A.downMs / 1000);
    osc.connect(gain).connect(this.bus!);
    osc.start(t0);
    osc.stop(t0 + A.downMs / 1000 + 0.02);
  }

  // Luz atravessando o prisma, em três tempos:
  // 1. Impacto: soco grave (seno caindo) + estalo de vidro (ruído agudo curtíssimo) — a luz bate no vidro.
  // 2. Divisão: um acorde branco (três vozes em uníssono, levemente desafinadas, filtro abrindo) que em
  //    splitMs se abre em três notas — vermelho desce e vai para a esquerda, azul sobe e vai para a
  //    direita, verde fica no meio — e some devagar.
  // 3. Dispersão: cascata rápida de pings de cristal subindo pelo espectro, da esquerda para a direita,
  //    como o leque de cores saindo do prisma. Um sopro de ruído subindo costura tudo.
  prism(): void {
    const ctx = this.ready();
    if (!ctx || !this.echo) return;
    const P = A.prism;
    const t0 = ctx.currentTime;
    const split = t0 + P.splitMs / 1000;
    const end = t0 + P.ms / 1000;
    const out = ctx.createGain();
    out.gain.value = A.volume * P.volume;
    out.connect(this.bus!);
    out.connect(this.echo);
    const stop = (n: AudioScheduledSourceNode, at: number): void => {
      n.start(t0);
      n.stop(at + 0.05);
    };
    const panned = (x: number): AudioNode => {
      const pan = ctx.createStereoPanner?.();
      if (!pan) return out;
      pan.pan.value = x;
      pan.connect(out);
      return pan;
    };

    // 1. Impacto.
    const I = P.impact;
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(I.fromHz, t0);
    thump.frequency.exponentialRampToValueAtTime(I.toHz, t0 + I.ms / 1000);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(I.volume, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + I.ms / 1000);
    thump.connect(tg).connect(out);
    stop(thump, t0 + I.ms / 1000);
    const crack = ctx.createBufferSource();
    crack.buffer = this.whooshNoise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = I.crackHz;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(I.crackVolume, t0);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + I.crackMs / 1000);
    crack.connect(hp).connect(cg).connect(out);
    stop(crack, t0 + I.crackMs / 1000);

    // 2. Divisão.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = P.filterQ;
    lp.frequency.setValueAtTime(P.filterHz[0], t0);
    lp.frequency.exponentialRampToValueAtTime(P.filterHz[1], split);
    lp.frequency.exponentialRampToValueAtTime(P.filterHz[2], end);
    const body = ctx.createGain();
    body.gain.setValueAtTime(0.0001, t0);
    body.gain.exponentialRampToValueAtTime(P.bodyVolume, t0 + P.attackMs / 1000);
    body.gain.setValueAtTime(P.bodyVolume, split);
    body.gain.exponentialRampToValueAtTime(0.0001, end);
    lp.connect(body);
    P.spread.forEach((ratio, k) => {
      const x = (k - (P.spread.length - 1) / 2) * P.pan;
      const pan = ctx.createStereoPanner?.();
      const g = ctx.createGain();
      g.gain.value = 1 / P.spread.length;
      for (const det of P.unison) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(P.hz * det, t0);
        o.frequency.setValueAtTime(P.hz * det, split - P.glideMs / 1000);
        o.frequency.exponentialRampToValueAtTime(P.hz * ratio * det, split);
        o.connect(g);
        stop(o, end);
      }
      if (pan) {
        pan.pan.setValueAtTime(0, t0);
        pan.pan.setValueAtTime(0, split - P.glideMs / 1000);
        pan.pan.linearRampToValueAtTime(x, split);
        g.connect(pan).connect(lp);
      } else g.connect(lp);
    });
    body.connect(out);

    // 3. Dispersão: pings de cristal (seno + parcial inarmônico) em cascata.
    const C = P.cascade;
    C.notes.forEach((hz, i) => {
      const t = split + (i * C.stepMs) / 1000;
      const x = (i / (C.notes.length - 1) - 0.5) * 2 * P.pan;
      const dest = panned(x);
      for (const [ratio, vol] of C.partials) {
        const o = ctx.createOscillator();
        o.frequency.value = hz * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(C.volume * vol, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + C.decayMs / 1000);
        o.connect(g).connect(dest);
        stop(o, t + C.decayMs / 1000);
      }
    });

    const W = P.whoosh;
    const noise = ctx.createBufferSource();
    noise.buffer = this.whooshNoise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = W.q;
    bp.frequency.setValueAtTime(W.fromHz, t0);
    bp.frequency.exponentialRampToValueAtTime(W.toHz, end);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(W.volume, split);
    ng.gain.exponentialRampToValueAtTime(0.0001, end);
    noise.connect(bp).connect(ng).connect(out);
    stop(noise, end);
  }

  // Trocar a cor do filtro: roda de filtros de lente girando até o próximo encaixe. Dois cliques
  // mecânicos curtos (a trava saindo e entrando) e, por baixo, um tom abafado e curto da nova cor,
  // sem deslizar a nota. Nada de vidro (é o som do espelho).
  filter(color: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const F = A.filter;
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = A.volume * F.volume;
    out.connect(this.bus!);

    F.clicks.forEach(([atMs, hz, vol]) => {
      const t = t0 + atMs / 1000;
      const src = ctx.createBufferSource();
      src.buffer = this.whooshNoise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = F.clickQ;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + F.clickMs / 1000);
      src.connect(bp).connect(g).connect(out);
      src.start(t);
      src.stop(t + F.clickMs / 1000 + 0.01);
    });

    const t = t0 + F.toneAtMs / 1000;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = F.hz[color] ?? F.hz[0]!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = F.toneLowpassHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(F.toneVolume, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + F.toneMs / 1000);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + F.toneMs / 1000 + 0.02);
  }

  private longNoise: AudioBuffer | null = null;
  private whooshNoise(ctx: AudioContext): AudioBuffer {
    if (!this.longNoise) {
      const len = Math.ceil(ctx.sampleRate * 2);
      this.longNoise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.longNoise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.longNoise;
  }

  chord(big = false): void {
    const ms = big ? A.bigChordMs : A.chordMs;
    const steps = big ? [0, 2, 4, 5, 7, 10] : [0, 2, 4, 5];
    steps.forEach((s, k) => this.tone(this.freq(s), ms, A.volume * 0.7, k * A.arpStepMs, 'triangle'));
  }
}
