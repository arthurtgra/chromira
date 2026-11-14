const KEY = 'prisma.save.v1';

export interface Save {
  level: number; // fase atual (índice)
  muted: boolean;
  done: number[]; // índices das fases concluídas
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Partial<Save>) : {};
    const level = Number.isInteger(s.level) ? s.level! : 0;
    const done = Array.isArray(s.done) ? s.done.filter(Number.isInteger) : [];
    // Saves antigos não tinham 'done': tudo antes da fase atual conta como concluído.
    if (!Array.isArray(s.done)) for (let i = 0; i < level; i++) done.push(i);
    return { level, muted: s.muted === true, done };
  } catch {
    return { level: 0, muted: false, done: [] };
  }
}

export function writeSave(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // modo privado / armazenamento bloqueado: o jogo segue sem salvar
  }
}
