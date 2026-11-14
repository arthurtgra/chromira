import { CONFIG } from '../config.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Pulse {
  x: number;
  y: number;
  age: number;
  color: string;
  radius: number;
}

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

export class Fx {
  private particles: Particle[] = [];
  private pulses: Pulse[] = [];
  private flashAge = Infinity;

  pulse(x: number, y: number, color: string, cell: number): void {
    this.pulses.push({ x, y, age: 0, color, radius: CONFIG.pulse.radius * cell });
  }

  // rainbow 0..1: fração das partículas pintadas com cores do espectro.
  burst(points: { x: number; y: number; color: string }[], rainbow = 0): void {
    const p = CONFIG.particles;
    const n = Math.round(rand(p.min, p.max));
    for (let i = 0; i < n && points.length > 0; i++) {
      const src = points[i % points.length]!;
      const a = Math.random() * Math.PI * 2;
      const v = rand(p.speed[0], p.speed[1]);
      const max = rand(p.lifeMs[0], p.lifeMs[1]);
      this.particles.push({
        x: src.x,
        y: src.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: max,
        max,
        size: rand(p.size[0], p.size[1]),
        color: Math.random() < rainbow ? `hsl(${Math.floor(Math.random() * 300)}, 100%, 62%)` : src.color,
      });
    }
  }

  flash(): void {
    this.flashAge = 0;
  }

  clear(): void {
    this.particles = [];
    this.pulses = [];
    this.flashAge = Infinity;
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    const drag = Math.exp(-CONFIG.particles.drag * dt);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dtMs;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.pulses) p.age += dtMs;
    this.pulses = this.pulses.filter((p) => p.age < CONFIG.pulse.ms);
    this.flashAge += dtMs;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pulses) {
      const k = p.age / CONFIG.pulse.ms;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2 + 4 * (1 - k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (0.3 + k), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    if (this.flashAge < CONFIG.flash.ms) {
      ctx.globalAlpha = CONFIG.flash.alpha * (1 - this.flashAge / CONFIG.flash.ms);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}
