import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works from any static host or subpath.
  base: './',
  server: { port: 5173, open: false },
});
