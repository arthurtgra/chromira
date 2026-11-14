// Logo: triângulo de Penrose em traço, cada lado (viga) numa cor RGB.
// A figura tem simetria de rotação de 120°: as arestas de uma viga são definidas numa grade triangular
// e giradas 120° e 240° em torno do centro para formar as outras duas.
//
// Grade: triângulo de lado N (ponta para cima). Ponto (s, k) = s unidades na horizontal a partir do canto
// inferior esquerdo, k = altura em "faixas" (cada faixa = √3/2 unidade). Cada viga mostra duas faces,
// então cada lado tem três linhas paralelas: k = 0 (fora), 1 (meio), 2 (dentro).

export type Seg = { color: string; a: [number, number]; b: [number, number] };

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
    for (const [a, b] of BEAM) raw.push({ color, a: rot(toXY(a), t), b: rot(toXY(b), t) });
  }
  // y para baixo (tela) e normalizado para largura 1.
  const pts = raw.flatMap((s) => [s.a, s.b]);
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const w = maxX - minX;
  const map = ([x, y]: [number, number]): [number, number] => [(x - minX) / w, (maxY - y) / w];
  return { segs: raw.map((s) => ({ color: s.color, a: map(s.a), b: map(s.b) })), h: (maxY - minY) / w };
}

export function logoSvg(size = 100, stroke = 2.4): string {
  const { segs, h } = penroseSegments();
  const pad = stroke;
  const f = (n: number): number => Math.round((n * size + pad) * 100) / 100;
  const W = size + pad * 2;
  const Hh = Math.round((h * size + pad * 2) * 100) / 100;
  const byColor = new Map<string, string>();
  for (const s of segs) byColor.set(s.color, (byColor.get(s.color) ?? '') + `M${f(s.a[0])} ${f(s.a[1])}L${f(s.b[0])} ${f(s.b[1])}`);
  const paths = [...byColor]
    .map(([c, d]) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${stroke}" stroke-linecap="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}">${paths}</svg>`;
}
