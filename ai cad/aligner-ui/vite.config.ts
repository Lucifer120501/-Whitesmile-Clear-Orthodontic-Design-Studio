import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When spawned by the WhiteSmile main system (AGLINER_WEB=1) the app is
// served under the /agliner/ base path and proxied from localhost:3000.
// Standalone/Electron runs keep the relative "./" base for file:// loading.
const base = process.env.AGLINER_WEB === '1' ? '/agliner/' : './'

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true as const,
  },
})
