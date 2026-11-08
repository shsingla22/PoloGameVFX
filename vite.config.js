import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// base: './' makes the build work from any static host (GitHub Pages, itch.io, a LAN server).
// HTTPS=1 serves over a self-signed cert: WebXR in the Meta Quest Browser requires a secure origin.
export default defineConfig({
  base: './',
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  server: { host: true },
  preview: { host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
