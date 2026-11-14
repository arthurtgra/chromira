// Todos os números de sensação. Ajuste à mão, salve e sinta no celular.
import type { Color } from './core/types.ts';

export const CONFIG = {
    // Fundo: [centro, borda] da vinheta, tons neutros. Muda a cada fase, com transição suave.
  // Um tom por bloco de 10 fases (1-10, 11-20...), escuros mas bem distintos entre si.
  backgrounds: [
    ['#1c1c22', '#0a0a0d'], // grafite
    ['#14202e', '#070b10'], // azul-noite
    ['#122522', '#060d0c'], // verde-petróleo
    ['#231a2e', '#0c0910'], // violeta
    ['#2a1a1f', '#0f090b'], // vinho
    ['#1a2416', '#090c07'], // musgo
    ['#2a2216', '#0e0b07'], // âmbar queimado
    ['#162028', '#070a0d'], // ardósia azul
    ['#281a28', '#0e090e'], // ameixa
  ],
  backgroundFadeMs: 900,
  gridDotAlpha: 0.1,
  gridDotRadius: 1.5,

  colors: {
    1: '#ff3358',
    2: '#29f58a',
    3: '#ffe23d', // amarelo limão: lê amarelo, não laranja
    4: '#4c7dff',
    5: '#e95cf0', // rosa puxado para o azul
    6: '#33e6ff',
    7: '#f4f6ff',
  } satisfies Record<Color, string>,

  piece: { stroke: 2, color: '#ffffff', mirrorLen: 0.78, splitterGap: 0.045, wallSize: 0.8, ringRadius: 0.3, prismSize: 0.36, filterRadius: 0.3 },

  // Lançador de luz, medidas em fração da célula.
  emitter: {
    body: 0.22, // meia largura do corpo
    radius: 0.35, // arredondamento, fração do corpo
    lens: 0.07, // espessura da lente na face de saída
    halo: 0.45, // brilho só em volta da lente, em células
    fill: '#0e0c1a',
    tinted: true, // corpo na cor que o lançador emite
    pulseHz: 0.6,
  },

  beam: {
    // Desenhado três vezes com 'lighter': largo/fraco, médio, fino/forte. Larguras em fração da célula.
    layers: [
      { width: 0.3, alpha: 0.035 }, // névoa bem fraca; o brilho de verdade vem das auras das ondas
      { width: 0.035, alpha: 0.25 }, // núcleo fraco: o corpo do feixe são as ondas
    ],
    // Crescimento da luz (células/s), com desaceleração no fim. Só o trecho que mudou cresce; o resto fica aceso.
    speed: 18, // ao abrir a fase
    turnSpeed: 9, // ao girar uma peça: mais devagar, vira transição
    growMs: [260, 1100], // duração mínima e máxima de um crescimento
    impact: { radius: 0.14, alpha: 0.6 }, // clarão onde a luz bate em parede/lançador
    // Faíscas na colisão: traços curtos na cor do feixe, ricocheteando para trás em leque.
    sparks: { perSec: 30, spread: 1.45, speed: [90, 230], lifeMs: [200, 450], len: 8, width: 1.6, drag: 4.5 },
    retractSpeed: 10, // trecho que deixou de existir é recolhido a partir do ponto que mudou
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
      tint: {} as Partial<Record<Color, number>>,
      // Tons das ondas componentes dentro de cada mistura. Amarelo: vermelho e verde nítidos e mais grossos
      // sobre um brilho amarelo (dá para ver as duas cores e o resultado). Rosa: azul saturado
      // e grosso, miolo rosa fraco — com 'lighter' muita camada clara vira branco e o azul some.
      comp: {
        3: { 1: { color: '#ff3b3b', width: 1.4, alpha: 1 }, 2: { color: '#3dff5a', width: 1.4, alpha: 1 } },
        5: { 1: { color: '#ff2f6e' }, 4: { color: '#3f5cff', width: 1.7, alpha: 1 } },
      } as Partial<Record<Color, Partial<Record<1 | 2 | 4, { color: string; width?: number; alpha?: number }>>>>,
      // Misturas (2+ componentes): miolo liso + brilho na cor da mistura entre as ondas.
      mixCore: { width: 0.05, alpha: 0.6 },
      mixGlow: { width: 0.2, alpha: 0.12 },
      mix: {
        3: { core: { width: 0.03, alpha: 0.22 }, glow: { width: 0.24, alpha: 0.1 } }, // só um tom amarelado
        5: { core: { width: 0.035, alpha: 0.3 }, glow: { width: 0.2, alpha: 0.07 } },
      } as Partial<Record<Color, { core: { width: number; alpha: number }; glow: { width: number; alpha: number } }>>,
      glowWidth: 0.15,
      glowAlpha: 0.13,
      driftAmp: 2.1, // multiplica amp
      driftLength: 1.7, // multiplica length
      driftSpeed: -0.45, // multiplica speed (negativo: anda contra o feixe)
      driftWidth: 0.11,
      driftAlpha: 0.09,
    },
    winWidthMul: 1, // vitória não engorda o feixe inteiro: quem engorda é o pulso que caminha
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
      core: 0.3, // brilho central (cor que entra), raio em células
      coreAlpha: 0.12, // fraco: com 'lighter' o miolo branco estourava
      halo: 0.62, // halo contínuo em volta, raio em células
      haloInner: 0.12, // fração do raio onde o halo começa a sumir
      haloAlpha: 1,
      mixAlpha: 0.68, // força das misturas (amarelo, ciano, rosa) relativa às cores puras
      rays: { count: 18, width: 1.3, from: 0.18, len: [0.22, 0.5], alpha: 0.85, spin: 0.015 },
    },
  },

  mirrorSpinMs: 80,
  filterSwapMs: 160,
  pulse: { ms: 450, radius: 0.9 },
  targetFillMs: 110,

  particles: { min: 60, max: 100, speed: [80, 320], lifeMs: [500, 1100], size: [1.5, 3.5], drag: 2.2 },
  flash: { alpha: 0.16, ms: 260 },
  winDelayMs: 1400,
  // Vitória: depois de uma pausa, todos os feixes renascem dos lançadores até o fim do caminho;
  // a próxima fase abre um pouco depois do replay terminar.
  // Vitória: depois de uma pausa, um pulso de luz caminha por cada feixe, do lançador até o fim:
  // as ondas engordam só num trecho estreito em volta dele, com um ponto de luz andando junto.
  // Trilho (fases 71+): cápsula por baixo da peça arrastável.
  rail: { width: 0.2, fill: 'rgba(10,10,14,0.35)', color: 'rgba(255,255,255,0.3)', line: 1, dot: 'rgba(255,255,255,0.8)', dotR: 0.06 },
  slideRate: 22, // deslize da peça até a célula do trilho (1/s, suavização exponencial)
  dragSlop: 8, // px de movimento antes de virar arrasto (menos que isso é toque)
  prismTurnRate: 12, // giro do prisma até a nova direção da luz (1/s, suavização exponencial)
  winPulse: { pauseMs: 300, speed: 11, width: 0.55, swell: 2.4, glow: 0.42, ms: [700, 1800], holdMs: 450 },

  audio: {
    volume: 0.22,
    clickMs: 30,
    clickFilterHz: 2400,
    // Girar peça: "tim" de vidro. Parciais inarmônicos de uma taça (agudos morrem antes) + estalo curtíssimo.
    // Frequência fixa com leve variação: nada de melodia, para não soar como piano.
    turn: {
      // Três tons (lá, dó, mi: acorde menor, combinam entre si), sorteados sem repetir o anterior.
      glassHz: [880, 1046.5, 1318.5],
      filterMul: 0.75, // filtro: mesmos tons, uma quarta abaixo (vidro mais grosso)
      detune: 0.006, // ± variação aleatória por toque
      volume: 0.42,
      attackMs: 6, // ataque um pouco mais macio
      partials: [
        [1, 1, 320], // [razão, volume, decaimento ms]
        [2.32, 0.32, 200], // parciais agudos mais fracos: menos estridente
        [4.25, 0.12, 120],
        [6.63, 0.04, 70],
      ],
      tickMs: 8,
      tickVolume: 0.14,
    },
    echo: { delayMs: 110, feedback: 0.25, wet: 0.2 },
    // Sons do menu: sino zen.
    ui: { tapHz: 659.25, selectHz: [523.25, 783.99], stepMs: 95, ms: 900, volume: 0.5 },
    // Música do menu: pad lento (Lá menor → Fá → Dó → Sol) + sinos pentatônicos esparsos e aleatórios.
    music: {
      volume: 0.5,
      fadeInMs: 2500,
      fadeOutMs: 1200,
      chordMs: 4000,
      chords: [
        [220.0, 261.63, 329.63], // Lá menor
        [174.61, 220.0, 261.63], // Fá
        [130.81, 196.0, 329.63], // Dó
        [196.0, 246.94, 293.66], // Sol
      ],
      padVolume: 0.035,
      padAttackMs: 1600,
      padReleaseMs: 2200,
      melody: [440.0, 523.25, 587.33, 659.25, 783.99, 880.0], // lá menor pentatônica
      noteChance: 0.7,
      noteGapMs: [900, 2200],
      noteMs: 2200,
      noteVolume: 0.06,
    },
    softHz: 5200, // passa-baixa no master: deixa tudo mais macio
    reverb: { seconds: 1.8, decay: 3.2, wet: 0.32, toneHz: 4200 }, // sala sintética em todos os sons
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
    winScale: 0.08,
    breathe: 0.015,
    barY: 92,
    barW: 14,
    barH: 3,
    barGap: 5,
  },
} as const;
