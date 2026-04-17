import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 供 `npm run dev`：写入实际监听地址（端口被占用时 Vite 会顺延） */
function writeDevServerUrlPlugin() {
  return {
    name: 'write-dev-server-url',
    configureServer(server: { httpServer?: import('node:http').Server | null }) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === 'object' && 'port' in addr) {
          const url = `http://127.0.0.1:${addr.port}`;
          fs.writeFileSync(path.join(__dirname, '.vite-dev-server-url'), `${url}\n`, 'utf8');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
  },
  plugins: [react(), writeDevServerUrlPlugin()],
  server: {
    host: '127.0.0.1',
    /** 首选 5174；被占用时自动尝试后续端口，避免调试反复 EADDRINUSE */
    port: 5174,
    strictPort: false,
  },
}));
