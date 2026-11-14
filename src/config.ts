// Todos os números de sensação. Ajuste à mão, salve e sinta no celular.
import type { Color } from './core/types.ts';

export const CONFIG = {
    // Fundo: [centro, borda] da vinheta, tons neutros. Muda a cada fase, com transição suave.
  backgrounds: [
    ['#1c1c22', '#0a0a0d'], // grafite
    ['#1a1f24', '#090b0d'], // ardósia
    ['#221f1c', '#0c0b0a'], // pedra quente
    ['#1d211e', '#0a0c0b'], // sálvia
    ['#201c22', '#0c0a0d'], // malva
    ['#1b1e26', '#090a0e'], // cinza azulado
    ['#24201d', '#0d0b0a'], // taupe
    ['#1e1e1e', '#0b0b0b'], // neutro
  ],
  backgroundFadeMs: 900,
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

  piece: { stroke: 2, color: '#ffffff', mirrorLen: 0.78, wallSize: 0.8, ringRadius: 0.3, prismSize: 0.36, filterRadius: 0.3 },

  // Lançador de luz, medidas em fração da célula.
  emitter: {
    body: 0.22, // meia largura do corpo
    radius: 0.35, // arredondamento, fração do corpo
    lens: 0.07, // espessura da lente na face de saída
    halo: 0.45, // brilho só em volta da lente, em células
    fill: '#0e0c1a',
    pulseHz: 0.6,
  },

  beam: {
    // Desenhado três vezes com 'lighter': largo/fraco, médio, fino/forte. Larguras em fração da célula.
    layers: [
      { width: 0.3, alpha: 0.035 }, // névoa bem fraca; o brilho de verdade vem das auras das ondas
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
      // Aura: cada onda repetida larga e fraca (segue a onda) + uma deriva lenta, mais aberta, que respira.
      // Quanto as ondas de cada mistura puxam para a cor da mistura (0 = cores puras, 1 = tudo da mistura).
      // Magenta (vermelho + azul) fica indefinido com as duas puras; puxa para o rosa.
      tint: { 5: 0.6 } as Partial<Record<Color, number>>,
      glowWidth: 0.15,
      glowAlpha: 0.13,
      driftAmp: 2.1, // multiplica amp
      driftLength: 1.7, // multiplica length
      driftSpeed: -0.45, // multiplica speed (negativo: anda contra o feixe)
      driftWidth: 0.11,
      driftAlpha: 0.09,
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
    // Prisma aceso: brilho macio da cor que entra + um lóbulo de cada cor que sai, puxado para o lado dela.
    prism: {
      alpha: [0.8, 1], // [sem arco-íris, arco-íris total]
      pulseHz: 0.55,
      core: 0.45, // brilho central (cor que entra), raio em células
      coreAlpha: 0.45,
      lobe: 0.38, // brilho de cada cor que sai, raio em células
      lobeOffset: 0.2, // deslocamento do lóbulo para o lado de saída, em células
      lobeAlpha: 0.75,
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
    family: '"SF Pro Display", system-ui, -apple-system, "Segoe UI", sans-serif',
    numberPx: 58,
    numberWeight: 250,
    y: 50,
    appearMs: 650,
    winScale: 0.16,
    breathe: 0.015,
    glow: { w: 70, h: 26, dy: 4, rest: 0.1, flare: 0.45, win: 0.4, decayMs: 1100 }, // halo elíptico atrás do número
    barY: 92,
    barW: 14,
    barH: 3,
    barGap: 5,
  },
} as const;
