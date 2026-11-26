import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [preact()],
  resolve: { alias: { '@lib': fileURLToPath(new URL('../js', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../v2', emptyOutDir: true, target: 'es2020', assetsInlineLimit: 0, sourcemap: false, chunkSizeWarningLimit: 600 },
});
