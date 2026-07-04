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
      // MVA/MIA sector-chart AIXM XML, published per-TRACON by FAA AJV under
      // faa.gov's digital_products/mva_mia page. UNVERIFIED: that page is
      // blocked from this sandbox's network egress, so the exact upstream
      // directory path below is a best guess, not a confirmed URL. If
      // requests through this proxy 404 in practice: open
      // https://www.faa.gov (search "MVA MIA charts" / digital products) in
      // a real browser, find an actual XML file's href, and update the
      // `rewrite` path to match (the `<FACILITY>_MVA_FUS3.xml` filename
      // convention itself — see src/utils/mvaFacilities.ts — was verified
      // against a real downloaded ABQ file, only the directory is a guess).
      '/api/faa-mva': {
        target: 'https://www.faa.gov',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/api\/faa-mva/,
            '/air_traffic/flight_info/aeronav/digital_products/mva_mia/mva',
          ),
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
