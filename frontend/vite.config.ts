import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: 'all',
    proxy: {
      '/api/vs': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/api/dt': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/kip': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kip/, '/api'),
      },
      '/api/tyagachi': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tyagachi/, '/api'),
      },
      '/api/admin': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
      '/api/reports': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
