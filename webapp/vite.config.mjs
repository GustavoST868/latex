import { defineConfig } from 'vite';

const API_PORT = process.env.PORT || 3000;

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Big libraries in their own files so they stay cached between app updates
        manualChunks(id) {
          if (id.includes('node_modules/@codemirror') || id.includes('node_modules/@lezer')) return 'codemirror';
          // pdf_viewer must stay a lazy chunk: it reads globalThis.pdfjsLib when it runs
          if (id.includes('node_modules/pdfjs-dist') && !id.includes('pdf_viewer')) return 'pdfjs';
        },
      },
    },
  },
  server: {
    // Em desenvolvimento (npm run dev), a API continua no server.js
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
    },
  },
});
