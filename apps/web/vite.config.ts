import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: 'auto',
      // Only precache the built app shell — API/socket traffic is always
      // network-only, this isn't an offline-data-sync app, just installable
      // + able to receive push notifications with no tab open.
      manifest: {
        name: 'Kretase',
        short_name: 'Kretase',
        description: 'High-performance game server management',
        start_url: '/dashboard',
        display: 'standalone',
        background_color: '#0a0a0c',
        theme_color: '#0a0a0c',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        // The custom SW imports workbox modules that only resolve against a
        // production build — running it in dev would 404 on every reload.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split vendor libs into their own long-lived chunk so browsers can
        // cache them across app deploys instead of re-downloading on every update.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', 'axios'],
          // recharts (with its d3 deps) is the single heaviest dependency and
          // is only used on a couple of chart-bearing pages — carving it into
          // its own chunk keeps it out of the ServerDetailPage bundle and lets
          // it stay cached across deploys that don't touch charting.
          'vendor-charts': ['recharts'],
          // socket.io-client is likewise only needed on the live-console page;
          // its own chunk means the rest of the app never pays for it.
          'vendor-socket': ['socket.io-client'],
          'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  // Mirrors server.proxy — `vite preview` doesn't inherit it automatically,
  // and testing the real service worker (PWA install, push) requires a
  // production build, which only `preview` serves.
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
