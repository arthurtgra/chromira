import { CONFIG } from '../config.ts';

const A = CONFIG.audio;

// Sons sintetizados com Web Audio. O AudioContext só nasce no primeiro toque (regra do navegador).
export class Synth {
  muted = false;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = Math.ceil((this.ctx.sampleRate * A.clickMs) / 1000);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ready(): AudioContext | null {
    return this.muted || !this.ctx ? null : this.ctx;
  }

  click(): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = A.clickFilterHz;
    const gain = ctx.createGain();
    gain.gain.value = A.volume * 1.5;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
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
