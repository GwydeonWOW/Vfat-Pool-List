import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/vfat-api': {
        target: 'https://api.vfat.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vfat-api/, ''),
        headers: {
          Origin: 'https://vfat.io',
          Referer: 'https://vfat.io/yield',
        },
      },
      '/gecko-api': {
        target: 'https://api.geckoterminal.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gecko-api/, '/api/v2'),
      },
    },
  },
});
