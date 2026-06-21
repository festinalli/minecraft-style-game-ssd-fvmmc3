import { defineConfig } from 'vite';

// base relativa para funcionar publicado em subpastas (ex.: GitHub Pages).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
