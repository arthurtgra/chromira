// Todos os números de sensação. Ajuste à mão, salve e sinta no celular.
import type { Color } from './core/types.ts';

export const CONFIG = {
  // Fundo: [centro, borda] da vinheta; muda um tom a cada 5 fases.
  backgrounds: [
    ['#141428', '#07070D'],
    ['#10203A', '#06080F'],
    ['#22123A', '#09060F'],
    ['#0E2A2A', '#050B0B'],
    ['#2A1A10', '#0B0705'],
    ['#1E1040', '#07050F'],
    ['#2A0F2A', '#0B050B'],
    ['#0F1F40', '#05070F'],
  ],
  gridDotAlpha: 0.1,
  gridDotRadius: 1.5,

  colors: {
    1: '#ff3358',
    2: '#29f58a',
    3: '#ffd93d',
    4: '#4c7dff',
    5: '#ff4fd1',
    6: '#33e6ff',
    7: '#f4f6ff',
  } satisfies Record<Color, string>,

  piece: { stroke: 2, color: '#ffffff', mirrorLen: 0.78, wallSize: 0.56, ringRadius: 0.3, prismSize: 0.36, filterRadius: 0.3 },

  beam: {
    // Desenhado três vezes com 'lighter': largo/fraco, médio, fino/forte. Larguras em fração da célula.
    layers: [
      { width: 0.34, alpha: 0.1 },
      { width: 0.13, alpha: 0.32 },
      { width: 0.035, alpha: 1 },
    ],
    speed: 36, // células por segundo: só o trecho que mudou cresce, o resto fica aceso
    fadeMs: 220, // trecho que deixou de existir apaga neste tempo
    // Faixas cromáticas que correm pelo feixe; matiz gira com o tempo.
    chroma: { band: 0.5, speed: 1.1, hueHz: 0.12, alpha: 0.3, width: 0.09, sat: 95, light: 62 },
    winWidthMul: 1.8,
    winGrowMs: 300,
  },

  // Difração em arco-íris: liga a partir deste número de marcadores de dificuldade.
  rainbow: {
    fromDifficulty: 3,
    fringes: 7, // franjas coloridas em volta do feixe branco
    spread: 0.16, // afastamento máximo das franjas, fração da célula
    alpha: 0.7,
    shimmerHz: 0.6,
    fanRadius: 1.25, // leque do prisma, em células
    fanAlpha: [0.12, 0.38], // [sem arco-íris, arco-íris total]
  },

  mirrorSpinMs: 80,
  filterSwapMs: 160,
  pulse: { ms: 450, radius: 0.9 },
  targetFillMs: 200,

  particles: { min: 60, max: 100, speed: [80, 320], lifeMs: [500, 1100], size: [1.5, 3.5], drag: 2.2 },
  flash: { alpha: 0.16, ms: 260 },
  winDelayMs: 1400,

  audio: {
    volume: 0.22,
    clickMs: 30,
    clickFilterHz: 2400,
    // Girar peça: sopro de ar filtrado + sino curto com eco. Notas sorteadas da escala, oitava acima.
    turn: {
      swishMs: 140,
      swishHz: [700, 2600], // varredura do filtro do sopro
      swishVolume: 0.5,
      bellMs: 380,
      bellVolume: 0.45,
      bellOctave: 2, // multiplica a escala
      filterOctave: 1, // filtro soa uma oitava abaixo do espelho
    },
    echo: { delayMs: 120, feedback: 0.28, wet: 0.3 },
    scale: [261.63, 293.66, 329.63, 392.0, 440.0], // dó ré mi sol lá
    noteMs: 320,
    downMs: 140,
    downVolume: 0.35,
    chordMs: 600,
    bigChordMs: 1400,
    arpStepMs: 70,
  },
  vibrateMs: 10,

  layout: { pad: 16, top: 116, bottom: 28 },
  hud: {
    fontPx: 56,
    font: '800 56px system-ui, -apple-system, "Segoe UI", sans-serif',
    y: 50,
    appearMs: 650,
    winScale: 0.22,
    breathe: 0.03,
    pipY: 92,
    pipSize: 5,
    pipGap: 18,
  },
} as const;
