import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Ignore runtime-write directories so pipeline output never triggers
        // a full page reload. Without this, the ortho pipeline writing a plan
        // JSON / STL into its workspace makes Vite reload the page, which
        // re-runs the auto pipeline → writes again → reload again (crash loop).
        ignored: [
          '**/uploads/**',
          '**/storage/**',
          '**/server-data/**',
          '**/segmented_stls/**',
          '**/workspace/**',
          '**/ortho/aligner_pipeline/workspace/**',
          '**/ai cad/aligner_pipeline/**',
          '**/dist/**',
          '**/dist-server/**',
          '**/node_modules/**',
          '**/.git/**',
          '**/ai-config.json',
          '**/api-keys.json',
          '**/ai-providers.json',
        ],
      },
    },
  };
});
