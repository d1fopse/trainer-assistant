import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // У розробці запити /api йдуть на локальний сервер
    proxy: { '/api': 'http://localhost:3000' },
  },
});
