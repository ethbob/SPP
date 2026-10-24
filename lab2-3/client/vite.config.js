import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В режиме разработки (npm run dev) запросы /api проксируются на API-сервер.
// В Docker ту же роль выполняет nginx (см. nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL || 'http://localhost:4000' },
  },
});
