'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const assetsDir = path.join(__dirname, '..', 'electron', 'assets');
const names = [
  ['#22c55e', 'status-running.png'],
  ['#ef4444', 'status-unhealthy.png'],
  ['#9ca3af', 'status-stopped.png'],
];

fs.mkdirSync(assetsDir, { recursive: true });

if (process.platform === 'win32') {
  const ps1 = path.join(__dirname, 'generate-tray-icons.ps1');
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { stdio: 'inherit' },
  );
} else {
  for (const [, file] of names) {
    const target = path.join(assetsDir, file);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, Buffer.alloc(0));
      console.warn('[tray-supervisor] placeholder', file, '(run on Windows to generate PNGs)');
    }
  }
}
