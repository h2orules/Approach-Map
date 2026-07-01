import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/adsbx': {
        target: 'https://adsbexchange-com1.p.rapidapi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/adsbx/, '/v2'),
      },
      '/api/aviationapi': {
        target: 'https://www.aviationapi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/aviationapi/, '/api/v1'),
      },
      '/api/faa-cifp': {
        target: 'https://aeronav.faa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/faa-cifp/, '/Upload_313-d/cifp'),
      },
      '/api/adsbdb': {
        target: 'https://api.adsbdb.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/adsbdb/, '/v0'),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mapbox: ['mapbox-gl'],
          turf: ['@turf/turf'],
          'react-vendor': ['react', 'react-dom', 'react-map-gl'],
        },
      },
    },
  },
})
