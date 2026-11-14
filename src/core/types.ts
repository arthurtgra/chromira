export type Dir = 'N' | 'E' | 'S' | 'W';
export type Color = 1 | 2 | 3 | 4 | 5 | 6 | 7; // bitmask R=1 G=2 B=4

export type Cell =
  | { x: number; y: number; t: 'emitter'; dir: Dir; color: Color }
  | { x: number; y: number; t: 'mirror' } // estado fica em rots
  | { x: number; y: number; t: 'wall' }
  | { x: number; y: number; t: 'target'; color: Color }
  | { x: number; y: number; t: 'prism' };

// start = estado inicial dos espelhos (ausente = todos '/')
export interface Level {
  id: number;
  w: 6;
  h: 8;
  cells: Cell[];
  start?: Rots;
}

// rots[i] = estado do i-ésimo espelho em level.cells: 0 = '/', 1 = '\'
export type Rots = (0 | 1)[];

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: Color;
}

export interface TraceResult {
  segments: Segment[];
  received: Record<string, number>; // "x,y" do alvo -> OR das cores recebidas
  solved: boolean;
}
