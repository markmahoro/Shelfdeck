const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const urlPath = path.join(root, '.vite-dev-server-url');

const viteUrl = fs.readFileSync(urlPath, 'utf8').trim();
if (!viteUrl) {
  console.error('run-electron-dev: empty .vite-dev-server-url');
  process.exit(1);
}

const electronPath = require('electron');
const env = {
  ...process.env,
  NODE_ENV: 'development',
  VITE_DEV_SERVER_URL: viteUrl,
};

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
