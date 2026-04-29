import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    // Integration tests need longer timeout (service startup)
    testTimeout: 15000,
    hookTimeout: 15000,
    // Ensure sequential execution (shared service process)
    fileParallelism: false,
    // Env for getBaseUrl() fallback
    env: {
      VITE_MEDIA_SERVICE_URL: 'http://127.0.0.1:18090',
    },
  },
});
