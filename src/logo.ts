// Logo: triângulo de Penrose com uma viga de cada cor RGB.
// Três vigas (eixos x, y, z) em projeção isométrica: (L,L,L) e (0,0,0) caem no mesmo ponto, então a escada
// de vigas fecha um triângulo. O começo da viga X é redesenhado por cima do fim da viga Z — é aí que mora a
// ilusão. Cada viga tem três tons (topo claro, lado, sombra) para parecer sólida.

export interface Poly {
  fill: string;
  pts: [number, number][]; // normalizado: cabe em [0,1] x [0,h], h = altura/largura
}

type V3 = [number, number, number];

const SHADES = {
  r: { z: '#ff7a92', x: '#ff3358', y: '#a8183a' },
  g: { z: '#7dffb6', x: '#29f58a', y: '#11935a' },
  b: { z: '#8eabff', x: '#4c7dff', y: '#2a43b0' },
} as const;

function boxFaces([x0, x1]: [number, number], [y0, y1]: [number, number], [z0, z1]: [number, number]): Record<'x' | 'y' | 'z', V3[]> {
  return {
    y: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    x: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    z: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
  };
}

// Isométrica girada -90°: ponta do triângulo para cima.
const project = ([x, y, z]: V3): [number, number] => [(x + y) / 2 - z, -(x - y) * (Math.sqrt(3) / 2)];

export function penrose(length = 7): { polys: Poly[]; h: number } {
  const L = length;
  const beams: ['r' | 'g' | 'b', ReturnType<typeof boxFaces>][] = [
    ['r', boxFaces([0, L], [0, 1], [0, 1])],
    ['g', boxFaces([L - 1, L], [0, L], [0, 1])],
    ['b', boxFaces([L - 1, L], [L - 1, L], [0, L])],
    ['r', boxFaces([0, 1], [0, 1], [0, 1])],
  ];
  const raw = beams.flatMap(([c, f]) => (['y', 'x', 'z'] as const).map((k) => ({ fill: SHADES[c][k], pts: f[k].map(project) })));
  const all = raw.flatMap((p) => p.pts);
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const w = maxX - minX;
  const polys = raw.map((p) => ({ fill: p.fill, pts: p.pts.map(([x, y]) => [(x - minX) / w, (y - minY) / w] as [number, number]) }));
  return { polys, h: (maxY - minY) / w };
}

export function logoSvg(size = 100): string {
  const { polys, h } = penrose();
  const f = (n: number): number => Math.round(n * size * 100) / 100;
  const paths = polys.map((p) => `<path fill="${p.fill}" d="M${p.pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${f(h)}">${paths}</svg>`;
}
