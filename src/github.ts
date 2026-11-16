// Publicação das fases editadas direto no repositório (site estático, sem servidor):
// o editor grava src/levels/edits.json pela API do GitHub e o push dispara o deploy do site.
// O token (fine-grained, só "Contents: write" neste repositório) fica guardado só no aparelho.
const REPO = 'arthurtgra/chromira';
const FILE = 'src/levels/edits.json';
const BRANCH = 'main';
const TOKEN_KEY = 'chromira.github.token';

export function githubToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setGithubToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // armazenamento bloqueado
  }
}

const toBase64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const fromBase64 = (b: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

type Edits = Record<string, unknown>;

// Lê edits.json do repositório, aplica a mudança e grava num commit. Tenta de novo se o arquivo
// mudou no meio (outro save ao mesmo tempo).
export async function publishEdits(change: (e: Edits) => void, message: string): Promise<void> {
  const token = githubToken();
  if (!token) throw new Error('no GitHub token');
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${url}?ref=${BRANCH}`, { headers, cache: 'no-store' });
    if (r.status === 401) throw new Error('token rejected by GitHub: paste it again');
    if (r.status === 403 || r.status === 404) throw new Error(`token has no access to ${REPO} (${r.status})`);
    if (!r.ok) throw new Error(`GitHub read ${r.status}`);
    const cur = (await r.json()) as { content: string; sha: string };
    const edits = JSON.parse(fromBase64(cur.content)) as Edits;
    change(edits);
    const sorted = Object.fromEntries(Object.entries(edits).sort((a, b) => Number(a[0]) - Number(b[0])));
    const w = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message,
        content: toBase64(JSON.stringify(sorted, null, 2) + '\n'),
        sha: cur.sha,
        branch: BRANCH,
      }),
    });
    if (w.ok) return;
    if (w.status === 403) throw new Error('token can read but not write: needs Contents: Read and write');
    if (w.status !== 409 && w.status !== 422) throw new Error(`GitHub write ${w.status}`);
  }
  throw new Error('GitHub write conflict');
}
