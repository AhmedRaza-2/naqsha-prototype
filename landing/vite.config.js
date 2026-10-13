import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' so the build works from any folder (GitHub Pages sub-path, file preview, etc.)
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: ['three', 'three/examples/jsm/environments/RoomEnvironment.js', 'motion/react', 'lenis'] },
  build: { target: 'es2020', chunkSizeWarningLimit: 700 },
});
