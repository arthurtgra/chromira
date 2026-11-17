// Todos os números de sensação. Ajuste à mão, salve e sinta no celular.
import type { Color } from './core/types.ts';

// Cor da dificuldade 1..5: azul (fácil) → ciano → verde → amarelo → vermelho (difícil).
export const difficultyHue = (d: number): number => 220 - (Math.min(5, Math.max(1, d)) - 1) * 55;

export const CONFIG = {
    // Fundo: [centro, borda] da vinheta, tons neutros. Muda a cada fase, com transição suave.
  // Um tom por bloco de 10 fases, seguindo a cor da dificuldade: azul (fácil) até vermelho (fase 100).
  backgrounds: [
    ['#151f37', '#070a10'], // azul
    ['#152937', '#070c10'], // azul-ciano
    ['#142f34', '#070f10'], // ciano
    ['#132f28', '#080f0d'], // verde-água
    ['#152e1b', '#080f0a'], // verde
    ['#232e15', '#0c0f08'], // verde-oliva
    ['#352e13', '#100e07'], // âmbar
    ['#3a2612', '#100b07'], // laranja
    ['#3f1d12', '#110906'], // vermelho-laranja
    ['#4a1111', '#150707'], // vermelho
  ],
  backgroundFadeMs: 900,
  gridDotAlpha: 0.1,
  gridDotRadius: 1.5,

  colors: {
    1: '#ff3358',
    2: '#4cf542', // verde puxado para o lima: separa bem do azul
    3: '#ffe23d', // amarelo limão: lê amarelo, não laranja
    4: '#3a5cff', // azul profundo (longe do ciano e do verde)
    5: '#e95cf0', // rosa puxado para o azul
    6: '#33e6ff',
    7: '#f4f6ff',
  } satisfies Record<Color, string>,

  // Peças ligadas (giram juntas): fio pontilhado e pontinho, uma cor por grupo.
  link: { colors: ['#ffd36b', '#9be7ff', '#ff9bd2'], alpha: 0.75, width: 1.5, dash: [2, 4], dotR: 0.065 },
  portal: { colors: ['#b48cff', '#ffb347', '#6bffd8'], radius: 0.3 },
  sensor: { size: 0.24 },
  bender: { radius: 0.27, width: 0.07 },
  combiner: { radius: 0.3 },
  shifter: { radius: 0.3, spin: 0.8 },
  diode: { size: 0.22, half: 0.2 },
  well: { radius: 0.36, color: '#b9a6ff', speed: 0.35 },
  fiber: {
    mouth: 0.18,
    color: 'rgba(255,255,255,0.85)',
    tube: 'rgba(255,255,255,0.12)',
    width: 0.16,
    bend: 1.6, // quanto o tubo sai reto de cada ponta antes de curvar (células)
    glow: [
      [0.22, 0.25],
      [0.08, 0.8],
    ] as [number, number][],
  },
  auto: { periodMs: 1800, ring: 0.44, color: '#ffd36b' }, // espelho automático: período e anel do tempo
  piece: { stroke: 2, color: '#ffffff', mirrorLen: 0.78, splitterGap: 0.045, wallSize: 0.8, ringRadius: 0.3, prismSize: 0.36, filterRadius: 0.3 },
  // Espelho: placa fina de vidro transparente, mesmo estilo de degradê do prisma (frações da célula).
  mirror: {
    thick: 0.085, // espessura
    corner: 0.015, // raio dos cantos: quase reto
    base: '#1c2436', // cor sólida por baixo do vidro: esconde as ondas dentro do espelho
    tint: '225,238,255', // branco levemente azulado (RGB)
    // Degradê ao longo da placa: [posição 0..1, opacidade]. Claro numa ponta, faixa de brilho no meio.
    glass: [
      [0, 0.6],
      [0.3, 0.22],
      [0.5, 0.5],
      [0.7, 0.2],
      [1, 0.35],
    ],
    edgeAlpha: 0.8, // contorno fino
  },

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
      { width: 0.1, alpha: 0.3 }, // núcleo: preenche o espaço entre as ondas da trança
    ],
    thickness: 1.2, // espessura geral de todos os feixes (multiplica as larguras das linhas)
    softSteps: 2, // brilhos (névoa, núcleo, auras) em degradê: passadas sobrepostas, da larga para a fina
    softCenter: 1.6, // força no centro do degradê em relação à opacidade configurada (a borda fica bem fraca)
    white: { width: 1.15, amp: 1.15, core: { width: 0.14, alpha: 0.28 } }, // feixe branco (3 cores): mais grosso, ondas mais abertas e núcleo que fecha os espaços sem esconder as cores
    pairCore: { width: 0.1, alpha: 0.12 }, // núcleo das misturas de 2 cores: fraco, para não virar branco ao somar com as ondas
    // Crescimento da luz (células/s), constante. Só o trecho que mudou cresce; o resto fica aceso.
    speed: 18, // ao abrir a fase
    turnSpeed: 10, // ao girar uma peça: mais devagar, vira transição
    impact: { radius: 0.14, alpha: 0.6 }, // clarão onde a luz bate em parede/lançador
    // Faíscas na colisão: traços curtos na cor do feixe, ricocheteando para trás em leque.
    sparks: { lead: 0.15, perSec: 30, spread: 1.45, speed: [90, 230], lifeMs: [200, 450], len: 8, width: 1.6, drag: 4.5 },
    retractSpeed: 10, // trecho que deixou de existir é recolhido a partir do ponto que mudou
    // Faixas cromáticas que correm pelo feixe; matiz gira com o tempo.
    // Feixe = ondas das cores básicas sobrepostas, defasadas 120°, viajando no sentido da luz.
    // Onde se cruzam somam (R+G+B = branco). Nos espelhos a onda reflete como imagem espelhada; só afina nas pontas.
    waves: {
      amp: 0.066, // fração da célula
      length: 0.95, // comprimento de onda, em células
      speed: 2.1, // ciclos por segundo
      width: 0.04,
      alpha: 0.95,
      taper: 0.38, // células até a amplitude cheia, a partir do começo e do fim do feixe
      step: 0.05, // resolução da curva, em células
      // Aura: cada onda repetida larga e fraca (segue a onda) + uma deriva lenta, mais aberta, que respira.
      // Quanto as ondas de cada mistura puxam para a cor da mistura (0 = cores puras, 1 = tudo da mistura).
      tint: {} as Partial<Record<Color, number>>,
      // Misturas de duas cores (amarelo, rosa, ciano): todas iguais em largura e disposição. Duas ondas
      // nas cores puras (mais grossas que numa cor só) sobre um miolo e um brilho fracos na cor da mistura.
      pairWidth: 1.4, // largura das ondas componentes numa mistura de duas cores
      // Cores das ondas: vermelho, verde e azul puros. Somadas dão exatamente a mistura (amarelo, ciano, rosa,
      // branco); com as cores do jogo, que têm um pouco das outras, a soma clareava até o branco.
      pure: { 1: '#ff2b3a', 2: '#33ff2b', 4: '#2b4fff' } as Record<1 | 2 | 4, string>,
      pairAlpha: 1,
      // Ajustes por mistura (vazio = todas iguais).
      comp: {} as Partial<Record<Color, Partial<Record<1 | 2 | 4, { color: string; width?: number; alpha?: number }>>>>,
      mixCore: { width: 0.05, alpha: 0.18 }, // miolo na cor da mistura (fraco: com as ondas por cima, forte vira branco)
      mixGlow: { width: 0.22, alpha: 0.08 },
      mix: {} as Partial<Record<Color, { core: { width: number; alpha: number }; glow: { width: number; alpha: number } }>>,
      lineSoft: 1.7, // largura da onda em degradê relativa a "width" (a borda some, o centro mantém a força)
      glowWidth: 0.15,
      glowAlpha: 0.13,
      driftAmp: 1.5, // multiplica amp (abre um pouco mais que o feixe)
      driftLength: 1.7, // multiplica length
      driftSpeed: -0.9, // multiplica speed (negativo: anda contra o feixe)
      driftWidth: 0.08,
      driftAlpha: 0.22, // cor mais forte, deriva menor
      // Deriva (a onda larga que corre contra o feixe): uma só, na cor combinada. Grossura pelo número de
      // cores no feixe: 1 cor sem deriva, 2 cores média, branco (3) a mais grossa.
      driftByColors: [0, 0, 1, 1.25],
      // Recheio entre as ondas (névoa, miolos e deriva na cor da mistura) por cor. Ciano: verde + azul somam um
      // ciano muito claro que enchia o vão da trança e as ondas viravam só contorno; mais fraco, a trança aparece.
      fill: { 4: 0.6, 6: 0.35 } as Partial<Record<Color, number>>,
      blueBoost: 1.3, // ondas azuis mais grossas: o azul é escuro e parece mais fraco que as outras cores
      // Azul também mais forte: o olho vê pouco o azul puro, então a aura e a onda azuis ganham opacidade
      // e o miolo do feixe azul (na cor do jogo, que puxa para o branco) fica mais fraco, para não desbotar.
      blueGlow: 1.9,
      blueLine: 1.1,
    },
    winWidthMul: 1, // vitória não engorda o feixe inteiro: quem engorda é o pulso que caminha
    winGrowMs: 300,
  },

  // Difração em arco-íris: liga a partir deste número de marcadores de dificuldade.
  rainbow: {
    fromDifficulty: 3,
    // Feixes brancos ganhavam ondas extras de espectro (laranja, amarelo, ciano, violeta) entre as RGB nas
    // fases difíceis; desligado: o feixe é o mesmo em todas as fases (o validado na fase 9).
    beamWaves: false,
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
  maxDpr: 2, // densidade máxima do canvas
  idleFps: 30, // quadros por segundo quando nada está mudando
  busyMs: 1500, // depois de um toque, quanto tempo segue a 60/120 fps

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
  // Vitória: cada alvo solta um anel fino na sua cor que atravessa a tela; os pontos da grade acendem
  // (maiores, na cor do anel) quando ele passa. Alvos disparam em sequência, stagger ms entre eles.
  winWave: {
    speed: 7,
    ms: 2200,
    stagger: 140,
    width: 2.2,
    alpha: 0.95,
    glowWidth: 14,
    glowAlpha: 0.22,
    echoes: [[0, 1]] as [number, number][], // [atraso ms, força]; um anel só (dois poluía)
    band: 1,
    dotR: 4.5,
    dotAlpha: 1,
  },
  prismTurnRate: 12, // giro do prisma até a nova direção da luz (1/s, suavização exponencial)
  winPulse: { pauseMs: 300, speed: 11, width: 0.55, swell: 2.4, glow: 0.42, ms: [700, 1800], holdMs: 450 },

  audio: {
    volume: 0.22,
    clickMs: 30,
    clickFilterHz: 2400,
    // Girar peça: "tim" de vidro. Parciais inarmônicos de uma taça (agudos morrem antes) + estalo curtíssimo.
    // Frequência fixa com leve variação: nada de melodia, para não soar como piano.
    turn: {
      // Quatro tons (sol, lá, dó, mi: combinam entre si), sorteados sem repetir o anterior.
      glassHz: [783.99, 880, 1046.5, 1318.5], // sol, lá, dó, mi (Lá menor com sétima)
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
    // Trocar a cor do filtro: roda de filtros girando (dois cliques de trava) + tom abafado da nova cor.
    filter: {
      clicks: [
        [0, 2600, 0.9], // [ms, Hz do clique, volume]: trava saindo
        [48, 1800, 1.0], // encaixe na nova cor, mais grave
      ],
      clickMs: 22,
      clickQ: 6,
      hz: [196, 246.94, 293.66], // vermelho sol, verde si, azul ré (graves, abafados)
      toneAtMs: 48,
      toneMs: 160,
      toneLowpassHz: 900,
      toneVolume: 0.35,
      volume: 0.7,
    },
    // Luz atravessando o prisma: tigela de vidro grave + três taças (lá, dó, mi) se abrindo, ressoando longo.
    prism: {
      rootHz: 220, // tigela grave: lá (luz branca)
      rootVolume: 0.9,
      notes: [440, 523.25, 659.25], // as taças: vermelho lá, verde dó, azul mi (mesmos tons do giro, oitava abaixo)
      noteVolume: 0.5,
      splitMs: 140, // quando a primeira taça soa
      stepMs: 90, // intervalo entre as taças
      // Parciais de vidro (mesmas razões do giro), decaimento longo: [razão, volume, ms]
      partials: [
        [1, 1, 3200],
        [2.32, 0.35, 1900],
        [4.25, 0.12, 1000],
        [6.63, 0.04, 500],
      ],
      ring: 1, // multiplica os decaimentos
      beatHz: 1.6, // batimento entre os pares de senos: o som pulsa enquanto ressoa
      attackMs: 5,
      pan: 0.7,
      ms: 3400,
      space: { leftMs: 150, rightMs: 230, feedback: 0.42, toneHz: 2200, wet: 0.35, tailMs: 2500 },
      volume: 0.5,
      minGapMs: 250,
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
    family: '"Outfit Variable", "SF Pro Display", system-ui, sans-serif',
    numberPx: 60,
    numberWeight: 200,
    stepDx: 74, // distância das setas (fase anterior/seguinte) ao centro do número
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
