import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only proxies for the six upstream APIs. In production these same
// /api/* paths are served by the Azure Functions proxy in api/ — keep the
// two route tables in sync (see api/src/functions/proxy.ts).
export default defineConfig(({ mode }) => {
  // ADSBX_API_KEY is deliberately NOT VITE_-prefixed: it must never be
  // inlined into the client bundle. The dev server attaches it here, on
  // the server side of the proxy, exactly like the production Functions do.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/adsbx': {
          target: 'https://adsbexchange-com1.p.rapidapi.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/adsbx/, '/v2'),
          headers: {
            'X-RapidAPI-Key': env.ADSBX_API_KEY ?? '',
            'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
          },
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
        '/api/datis': {
          target: 'https://atis.info',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/datis/, '/api'),
        },
        '/api/dtpp': {
          target: 'https://aeronav.faa.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/dtpp/, '/d-tpp'),
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
  }
})
