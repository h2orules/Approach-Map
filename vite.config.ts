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
      // MVA/MIA sector-chart AIXM XML, published per-TRACON by FAA AJV. The
      // faa.gov digital_products/mva_mia page is just an HTML index; the
      // actual `<FACILITY>_MVA_FUS3.xml` / `_FUS5.xml` files it links to are
      // hosted on aeronav.faa.gov (verified by fetching the index page and
      // inspecting its <a href> list directly, e.g. .../MVA_Charts/aixm/
      // S46_MVA_FUS3.xml for Seattle) — a different host+path than
      // faa-cifp's aeronav.faa.gov/Upload_313-d/cifp above.
      '/api/faa-mva': {
        target: 'https://aeronav.faa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/faa-mva/, '/MVA_Charts/aixm'),
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
