import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Project pages live at https://<user>.github.io/wortschatz/
const BASE = '/wortschatz/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        name: 'Wortschatz',
        short_name: 'Wortschatz',
        description: 'Personal German vocabulary and grammar trainer',
        theme_color: '#1b1b1f',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        lang: 'de',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Android/Chrome: share a selected word straight into capture (Phase 7).
        share_target: {
          action: BASE + 'share-target',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        // Take control on the very first load, so even the first dictionary
        // lookup passes through the worker and lands in the offline cache.
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Dictionary shards are NOT precached (too large); cached on first use instead.
        globIgnores: ['**/dict/**'],
        navigateFallback: BASE + 'index.html',
        navigateFallbackDenylist: [/^\/wortschatz\/dict\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/dict/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wortschatz-dict',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
})
