// Todos os números de sensação. Ajuste à mão, salve e sinta no celular.
import type { Color } from './core/types.ts';

export const CONFIG = {
  // Fundo muda um tom a cada 5 fases.
  backgrounds: ['#0B0B12', '#0B0E14', '#100B14', '#0B1210', '#120F0B', '#0E0B16'],
  gridDotAlpha: 0.08,
  gridDotRadius: 1.5,

  colors: {
    1: '#ff2a3a',
    2: '#2aff5a',
    3: '#ffee30',
    4: '#3a6aff',
    5: '#ff3af0',
    6: '#30f6ff',
    7: '#ffffff',
  } satisfies Record<Color, string>,

  piece: { stroke: 2, color: '#ffffff', mirrorLen: 0.78, wallSize: 0.56, ringRadius: 0.3, prismSize: 0.36 },

  beam: {
    // Desenhado três vezes com 'lighter': largo/fraco, médio, fino/forte. Larguras em fração da célula.
    layers: [
      { width: 0.32, alpha: 0.1 },
      { width: 0.12, alpha: 0.3 },
      { width: 0.035, alpha: 1 },
    ],
    drawMs: 150,
    winWidthMul: 1.8,
    winGrowMs: 300,
  },

  mirrorSpinMs: 80,
  pulse: { ms: 450, radius: 0.9 },
  targetFillMs: 200,

  particles: { min: 60, max: 100, speed: [80, 320], lifeMs: [500, 1100], size: [1.5, 3.5], drag: 2.2 },
  flash: { alpha: 0.16, ms: 260 },
  winDelayMs: 1400,

  audio: {
    volume: 0.22,
    clickMs: 30,
    clickFilterHz: 2400,
    scale: [261.63, 293.66, 329.63, 392.0, 440.0], // dó ré mi sol lá
    noteMs: 320,
    downMs: 140,
    downVolume: 0.35,
    chordMs: 600,
    bigChordMs: 1400,
    arpStepMs: 70,
  },
  vibrateMs: 10,

  layout: { pad: 16, top: 72, bottom: 32 },
  hudFont: '600 20px system-ui, sans-serif',
  hudAlpha: 0.55,
} as const;
