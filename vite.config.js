import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site under /colorado-trails/ — the deploy
  // workflow sets DEPLOY_BASE; local dev/preview stay at /
  base: process.env.DEPLOY_BASE ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Colorado Trails',
        short_name: 'CO Trails',
        description: 'Offline-first trail guide for Colorado hiking trails',
        theme_color: '#022c22',
        background_color: '#022c22',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // trail data (data/*.json) is deliberately NOT precached — it goes
        // to IndexedDB via the Download button; the map style IS precached
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', 'map-style/*.json'],
        // firebase's lazy chunks build as index.esm-*.js — they only load
        // during sign-in/sync (online by definition), so don't precache
        globIgnores: ['**/index.esm-*.js'],
        // maplibre-gl alone is ~800 KB minified; the default 2 MB precache
        // limit is too tight for comfort once trail code lands on top of it
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // sprite, glyphs, natural-earth raster: stable URLs, safe to
            // cache-first (vector tiles are NOT here — they go through the
            // ofm:// protocol with z/x/y-normalized keys in tileCache.js)
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/(fonts|sprites|natural_earth)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-assets',
              expiration: { maxEntries: 600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // TileJSON: small, changes weekly; prefer fresh but keep a copy
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/planet$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'map-tilejson',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
