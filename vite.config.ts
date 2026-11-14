import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Prisma',
        short_name: 'Prisma',
        description: 'Puzzle de luz: gire espelhos e acenda cada alvo com a cor certa.',
        lang: 'pt-BR',
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
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,json}'] },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
});
