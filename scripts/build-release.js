'use strict';

/**
 * Build the complete ShelfDeck v1.0.0 Windows release package.
 *
 * Output:  dist-release/ShelfDeck-v1.0.0/
 *   ├── ShelfDeck 播放助手.exe    ← desktop portable
 *   ├── media-service/
 *   │   ├── node.exe              ← bundled Node.js runtime
 *   │   ├── start.bat             ← double-click to start service
 *   │   └── ...
 *   └── start-all.bat             ← start service + desktop together
 *
 * Usage:  node scripts/build-release.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RELEASE = path.join(ROOT, 'dist-release', 'ShelfDeck-v1.0.0');

// ── clean ──────────────────────────────────────────────────────────────────────

if (fs.existsSync(path.join(ROOT, 'dist-release'))) {
  fs.rmSync(path.join(ROOT, 'dist-release'), { recursive: true, force: true });
}
fs.mkdirSync(RELEASE, { recursive: true });

// ── 1. build admin web ─────────────────────────────────────────────────────────

console.log('=== [1/4] Building admin web ===');
execSync('npm run build:web', { cwd: path.join(ROOT, 'media-service'), stdio: 'inherit' });

// ── 2. build desktop portable exe ──────────────────────────────────────────────

console.log('\n=== [2/4] Building desktop exe ===');
execSync('npm run dist:win', { cwd: path.join(ROOT, 'media-desktop'), stdio: 'inherit' });

// ── 3. package service ─────────────────────────────────────────────────────────

console.log('\n=== [3/4] Packaging service ===');
execSync('node scripts/package-win.js', { cwd: path.join(ROOT, 'media-service'), stdio: 'inherit' });

// ── 4. assemble release ────────────────────────────────────────────────────────

console.log('\n=== [4/4] Assembling release ===');

// Copy desktop exe — find the latest build
const desktopReleaseDir = path.join(ROOT, 'media-desktop', 'release');
const files = fs.readdirSync(desktopReleaseDir).filter(f => f.endsWith('.exe')).sort();
if (files.length === 0) throw new Error('No desktop exe found in media-desktop/release/');
const desktopExe = files[files.length - 1];
fs.copyFileSync(
  path.join(desktopReleaseDir, desktopExe),
  path.join(RELEASE, 'ShelfDeck 播放助手.exe'),
);
console.log(`  copied ${desktopExe} → ShelfDeck 播放助手.exe`);

// Copy service package
const svcSrc = path.join(ROOT, 'media-service', 'dist-pkg', 'media-service');
const svcDst = path.join(RELEASE, 'media-service');
execSync(`xcopy "${svcSrc}" "${svcDst}" /E /I /H /Q /Y`, { windowsHide: true, stdio: 'ignore' });
console.log('  copied media-service/');

// ── create start-all.bat ───────────────────────────────────────────────────────

const bat = [
  '@echo off',
  'title ShelfDeck v1.0.0',
  'echo ============================================',
  'echo   ShelfDeck 媒体库管家 v1.0.0',
  'echo ============================================',
  'echo.',
  'echo 启动媒体管理服务...',
  'cd /d "%~dp0media-service"',
  'start "ShelfDeck Service" node.exe src/server.js',
  'echo 服务已启动 (http://127.0.0.1:18080/admin)',
  'echo.',
  'echo 启动桌面客户端...',
  'cd /d "%~dp0"',
  'start "" "ShelfDeck 播放助手.exe"',
  'echo 桌面客户端已启动',
  'echo.',
  'echo ShelfDeck 已就绪。关闭本窗口可退出。',
  'pause',
].join('\r\n');

fs.writeFileSync(path.join(RELEASE, 'start-all.bat'), bat, 'utf8');
console.log('  created start-all.bat');

// ── done ───────────────────────────────────────────────────────────────────────

console.log(`\nDone → ${RELEASE}`);
console.log('Contents:');
for (const f of fs.readdirSync(RELEASE)) {
  const st = fs.statSync(path.join(RELEASE, f));
  const size = st.isFile() ? ` (${(st.size / 1024 / 1024).toFixed(1)}MB)` : '';
  console.log(`  ${f}${size}`);
}
