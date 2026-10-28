import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env.API_PORT ?? '4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs separately; Vite forwards /api calls to it.
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
});
