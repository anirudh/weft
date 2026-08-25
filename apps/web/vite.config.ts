import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API lives in the Fastify process; Vite only serves the UI in dev.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
