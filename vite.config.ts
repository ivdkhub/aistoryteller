import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import config from './config.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': `http://localhost:${config.port}` } },
  test: { include: ['server/**/*.test.ts'] },
} as never);
