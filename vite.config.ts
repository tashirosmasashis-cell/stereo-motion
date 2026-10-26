import { defineConfig } from 'vite';

// GitHub Pages（https://tashirosmasashis-cell.github.io/stereo-motion/）から配る
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
