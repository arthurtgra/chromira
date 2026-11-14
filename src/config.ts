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

  // Lançador de luz, medidas em fração da célula.
  emitter: {
    body: 0.2, // meia largura do corpo
    barrel: 0.36, // ponta do cano (lente), a partir do centro
    core: 0.1,
    ring: 0.15,
    halo: 0.6,
    fill: '#0e0c1a',
    pulseHz: 0.8,
    spinHz: 0.35,
  },

  beam: {
    // Desenhado três vezes com 'lighter': largo/fraco, médio, fino/forte. Larguras em fração da célula.
    layers: [
      { width: 0.34, alpha: 0.1 },
      { width: 0.13, alpha: 0.32 },
      { width: 0.035, alpha: 0.25 }, // núcleo fraco: o corpo do feixe são as ondas
    ],
    speed: 36, // células por segundo: só o trecho que mudou cresce, o resto fica aceso
    fadeMs: 220, // trecho que deixou de existir apaga neste tempo
    // Faixas cromáticas que correm pelo feixe; matiz gira com o tempo.
    // Feixe = ondas das cores básicas sobrepostas, defasadas 120°, viajando no sentido da luz.
    // Onde se cruzam somam (R+G+B = branco). Amplitude some perto de cantos e pontas: as ondas se juntam ali.
    waves: {
      amp: 0.06, // fração da célula
      length: 0.95, // comprimento de onda, em células
      speed: 1.4, // ciclos por segundo
      width: 0.04,
      alpha: 0.95,
      taper: 0.38, // células até a amplitude cheia, a partir de cada canto
      step: 0.05, // resolução da curva, em células
    },
    winWidthMul: 1.8,
    winGrowMs: 300,
  },

  // Difração em arco-íris: liga a partir deste número de marcadores de dificuldade.
  rainbow: {
    fromDifficulty: 3,
    // Feixes brancos ganham ondas extras de espectro (laranja, amarelo, ciano, violeta) entre as RGB.
    hues: [30, 60, 180, 275],
    alpha: 0.55,
    ampMul: 1.35, // amplitude das ondas extras relativa às RGB, no arco-íris total
    // Prisma aceso: miolo e bordas em espectro, coroa colorida e raios vazando para fora.
    prism: {
      alpha: [0.75, 1], // [sem arco-íris, arco-íris total]
      spinHz: 0.15,
      rays: 12,
      rayLen: 0.75, // em células, além da borda
      rayWidth: 0.09, // meia abertura da cunha, radianos
      flickerHz: 0.7,
      corona: 0.62, // raio da coroa, em células
    },
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
    // Girar peça: "tim" de vidro. Parciais inarmônicos de uma taça (agudos morrem antes) + estalo curtíssimo.
    // Frequência fixa com leve variação: nada de melodia, para não soar como piano.
    turn: {
      glassHz: 1900,
      filterHz: 1250, // filtro: vidro mais grosso, mais grave
      detune: 0.025, // ± variação aleatória por toque
      volume: 0.55,
      partials: [
        [1, 1, 320], // [razão, volume, decaimento ms]
        [2.32, 0.5, 210],
        [4.25, 0.26, 130],
        [6.63, 0.12, 80],
      ],
      tickMs: 8,
      tickVolume: 0.35,
    },
    echo: { delayMs: 90, feedback: 0.22, wet: 0.22 },
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
