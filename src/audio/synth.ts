import { CONFIG } from '../config.ts';

const A = CONFIG.audio;

// Sons sintetizados com Web Audio. O AudioContext só nasce no primeiro toque (regra do navegador).
export class Synth {
  muted = false;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private echo: AudioNode | null = null;

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
    damp.connect(wet).connect(ctx.destination);
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
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  // Girar espelho/filtro: sopro de ar que varre o filtro + sino suave numa nota da escala.
  turn(filter = false): void {
    const ctx = this.ready();
    if (!ctx || !this.noise || !this.echo) return;
    const T = A.turn;
    const t0 = ctx.currentTime;

    const swish = ctx.createBufferSource();
    swish.buffer = this.noise;
    swish.playbackRate.value = A.clickMs / T.swishMs; // estica o ruído curto
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    const [lo, hi] = filter ? [T.swishHz[1], T.swishHz[0]] : T.swishHz;
    bp.frequency.setValueAtTime(lo, t0);
    bp.frequency.exponentialRampToValueAtTime(hi, t0 + T.swishMs / 1000);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t0);
    sg.gain.linearRampToValueAtTime(A.volume * T.swishVolume, t0 + 0.025);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + T.swishMs / 1000);
    swish.connect(bp).connect(sg).connect(ctx.destination);
    swish.start(t0);

    const oct = filter ? T.filterOctave : T.bellOctave;
    const f = A.scale[Math.floor(Math.random() * A.scale.length)]! * oct;
    const dur = T.bellMs / 1000;
    const bell = ctx.createGain();
    bell.gain.setValueAtTime(0, t0);
    bell.gain.linearRampToValueAtTime(A.volume * T.bellVolume, t0 + 0.006);
    bell.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    bell.connect(ctx.destination);
    bell.connect(this.echo);
    // Fundamental + parcial inarmônico fraco: timbre de vidro, não de apito.
    for (const [mul, vol] of [[1, 1], [2.76, 0.18]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.value = vol;
      osc.connect(g).connect(bell);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
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
    osc.connect(gain).connect(ctx.destination);
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
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + A.downMs / 1000 + 0.02);
  }

  chord(big = false): void {
    const ms = big ? A.bigChordMs : A.chordMs;
    const steps = big ? [0, 2, 4, 5, 7, 10] : [0, 2, 4, 5];
    steps.forEach((s, k) => this.tone(this.freq(s), ms, A.volume * 0.7, k * A.arpStepMs, 'triangle'));
  }
}
