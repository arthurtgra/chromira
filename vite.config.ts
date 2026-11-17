import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Editor de fases: o botão Save do jogo (modo desenvolvedor) manda a fase para cá e ela é gravada em
// src/levels/edits.json (só no `npm run dev`). edits.json não dispara recarga: a página já tem a edição.
function levelEditor(): Plugin {
  const file = fileURLToPath(new URL('./src/levels/edits.json', import.meta.url));
  return {
    name: 'chromira-level-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__chromira/level', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          try {
            const { n, level } = JSON.parse(body) as { n: unknown; level: { cells?: unknown } | null };
            if (!Number.isInteger(n) || (n as number) < 1) throw new Error('bad level number');
            if (level !== null && !Array.isArray(level?.cells)) throw new Error('bad level');
            const edits = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
            if (level) edits[String(n)] = level;
            else delete edits[String(n)];
            const sorted = Object.fromEntries(Object.entries(edits).sort((a, b) => Number(a[0]) - Number(b[0])));
            writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
            res.setHeader('content-type', 'application/json');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
    handleHotUpdate(ctx) {
      if (normalizePath(ctx.file) === normalizePath(file)) return [];
    },
  };
}

export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [
    levelEditor(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Chromira',
        short_name: 'Chromira',
        description: 'Light puzzle: turn mirrors and light every target with the right color.',
        lang: 'en',
        start_url: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B0B12',
        theme_color: '#0B0B12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,json,woff2}'] },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
});
