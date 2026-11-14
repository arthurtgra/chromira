const KEY = 'prisma.save.v1';

export interface Save {
  level: number;
  muted: boolean;
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Partial<Save>) : {};
    return { level: Number.isInteger(s.level) ? s.level! : 0, muted: s.muted === true };
  } catch {
    return { level: 0, muted: false };
  }
}

export function writeSave(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // modo privado / armazenamento bloqueado: o jogo segue sem salvar
  }
}
