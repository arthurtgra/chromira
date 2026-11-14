import { CONFIG } from '../config.ts';

const A = CONFIG.audio;

// Sons sintetizados com Web Audio. O AudioContext só nasce no primeiro toque (regra do navegador).
export class Synth {
  muted = false;
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

  private ready(): AudioContext | null {
    return this.muted || !this.ctx ? null : this.ctx;
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

  chord(big = false): void {
    const ms = big ? A.bigChordMs : A.chordMs;
    const steps = big ? [0, 2, 4, 5, 7, 10] : [0, 2, 4, 5];
    steps.forEach((s, k) => this.tone(this.freq(s), ms, A.volume * 0.7, k * A.arpStepMs, 'triangle'));
  }
}
