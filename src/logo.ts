// Logo: triângulo de Penrose em traço, cada lado (viga) numa cor RGB.
// A figura tem simetria de rotação de 120°: as arestas de uma viga são definidas numa grade triangular
// e giradas 120° e 240° em torno do centro para formar as outras duas.
//
// Grade: triângulo de lado N (ponta para cima). Ponto (s, k) = s unidades na horizontal a partir do canto
// inferior esquerdo, k = altura em "faixas" (cada faixa = √3/2 unidade). Cada viga mostra duas faces,
// então cada lado tem três linhas paralelas: k = 0 (fora), 1 (meio), 2 (dentro).

// back: a linha nasce por baixo da viga anterior (as três primeiras de cada viga).
export type Seg = { color: string; a: [number, number]; b: [number, number]; back: boolean };

export const LOGO_COLORS = { r: '#ff3358', g: '#29f58a', b: '#4c7dff' } as const;

const N = 9;
const H = Math.sqrt(3) / 2;

// Viga de baixo: começa encostada na tampa da viga vermelha (canto esquerdo) e termina na sua própria tampa
// no canto direito. As três linhas nascem na linha de dentro da viga vermelha (passam por baixo dela).
const BEAM: [[number, number], [number, number]][] = [
  [[2, 0], [N - 1, 0]], // fora
  [[2.5, 1], [N - 0.5, 1]], // meio
  [[3, 2], [N - 1, 2]], // dentro
  [[N - 1, 0], [N - 0.5, 1]], // tampa: canto de fora
  [[N - 0.5, 1], [N - 1, 2]], // tampa: volta para dentro
];

export function penroseSegments(): { segs: Seg[]; h: number } {
  const cx = N / 2;
  const cy = (N * H) / 3;
  const toXY = ([s, k]: [number, number]): [number, number] => [s, k * H];
  const rot = ([x, y]: [number, number], t: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)];
  };
  const raw: Seg[] = [];
  const turns: [string, number][] = [
    [LOGO_COLORS.b, 0],
    [LOGO_COLORS.g, (2 * Math.PI) / 3],
    [LOGO_COLORS.r, (4 * Math.PI) / 3],
  ];
  for (const [color, t] of turns) {
    BEAM.forEach(([a, b], i) => raw.push({ color, a: rot(toXY(a), t), b: rot(toXY(b), t), back: i < 3 }));
  }
  // y para baixo (tela) e normalizado para largura 1.
  const pts = raw.flatMap((s) => [s.a, s.b]);
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const w = maxX - minX;
  const map = ([x, y]: [number, number]): [number, number] => [(x - minX) / w, (maxY - y) / w];
  const segs = raw.map((s) => ({ ...s, a: map(s.a), b: map(s.b) }));
  return { segs: [...segs, ...patches(segs)], h: (maxY - minY) / w };
}

// Onde uma linha termina encostada numa linha de outra cor, a ponta arredondada passa por cima dela.
// Ordem de desenho não resolve (as junções formam um ciclo — é a figura impossível), então cada junção
// ganha um remendo: um trechinho da linha que passa por cima, redesenhado no fim, cobrindo a ponta.
const PATCH = 0.035; // meio comprimento do remendo, na escala normalizada (maior que a espessura do traço)
const EPS = 1e-6;

function patches(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  const near = (p: [number, number], q: [number, number]): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) < EPS;
  for (const a of segs) {
    for (const p of [a.a, a.b]) {
      for (const b of segs) {
        if (b.color === a.color) continue;
        const dx = b.b[0] - b.a[0];
        const dy = b.b[1] - b.a[1];
        const len = Math.hypot(dx, dy);
        const t = ((p[0] - b.a[0]) * dx + (p[1] - b.a[1]) * dy) / (len * len);
        const dist = Math.abs((p[0] - b.a[0]) * dy - (p[1] - b.a[1]) * dx) / len;
        if (dist > EPS || t < -EPS || t > 1 + EPS) continue;
        // Junção de pontas (p é ponta das duas): cobre quem não nasce por baixo.
        const atEnd = near(p, b.a) || near(p, b.b);
        if (atEnd && !(a.back && !b.back)) continue;
        const h = PATCH / len;
        const t0 = Math.max(0, t - h);
        const t1 = Math.min(1, t + h);
        out.push({
          color: b.color,
          a: [b.a[0] + dx * t0, b.a[1] + dy * t0],
          b: [b.a[0] + dx * t1, b.a[1] + dy * t1],
          back: false,
        });
      }
    }
  }
  return out;
}

export function logoSvg(size = 100, stroke = 2.4): string {
  const { segs, h } = penroseSegments();
  const pad = stroke;
  const f = (n: number): number => Math.round((n * size + pad) * 100) / 100;
  const W = size + pad * 2;
  const Hh = Math.round((h * size + pad * 2) * 100) / 100;
  // Em ordem: linhas e depois os remendos por cima.
  const paths = segs
    .map((s) => `<path d="M${f(s.a[0])} ${f(s.a[1])}L${f(s.b[0])} ${f(s.b[1])}" stroke="${s.color}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}"><g fill="none" stroke-width="${stroke}" stroke-linecap="round">${paths}</g></svg>`;
}
