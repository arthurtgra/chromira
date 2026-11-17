export type Dir = 'N' | 'E' | 'S' | 'W';
export type Color = 1 | 2 | 3 | 4 | 5 | 6 | 7; // bitmask R=1 G=2 B=4

export type Cell =
  | { x: number; y: number; t: 'emitter'; dir: Dir; color: Color }
  | { x: number; y: number; t: 'mirror'; rail?: Rail } // estado fica em rots
  | { x: number; y: number; t: 'filter' } // estado fica em rots
  | { x: number; y: number; t: 'splitter' } // vidro semi-espelhado: reflete e deixa passar; estado em rots
  // Espelho dicroico: reflete só a sua cor (componente R, G ou B) e deixa o resto atravessar; estado em rots.
  | { x: number; y: number; t: 'dichroic'; color: 1 | 2 | 4 }
  | { x: number; y: number; t: 'wall' }
  | { x: number; y: number; t: 'target'; color: Color }
  | { x: number; y: number; t: 'prism'; rail?: Rail };

// Trilho: a peça desliza de célula em célula a partir de (x, y) na direção do eixo, len posições.
// Estado da peça = rotação + base * posição (base = estados de rotação: espelho 2, prisma 1).
export interface Rail {
  axis: 'x' | 'y';
  len: number;
}

// start = estado inicial das peças móveis (ausente = todas no estado 0)
// difficulty = 1..5, calculada pelo script gen-levels
export interface Level {
  id: number;
  w: 7; // GRID em grid.ts: ímpar para ter coluna e linha do meio
  h: 9;
  cells: Cell[];
  start?: Rots;
  difficulty?: number;
}

// rots[i] = estado da i-ésima peça móvel (espelho, divisor ou filtro) em level.cells.
// espelho e divisor: 0 = '/', 1 = '\'. filtro: 0 = vermelho, 1 = verde, 2 = azul.
export type Rots = number[];

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: Color;
  d0?: number; // distância do lançador até (x1, y1), pelo caminho da própria luz
}

export interface TraceResult {
  segments: Segment[];
  received: Record<string, number>; // "x,y" do alvo -> OR das cores recebidas
  solved: boolean;
}
