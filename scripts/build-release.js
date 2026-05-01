'use strict';

/**
 * Build the complete ShelfDeck v1.0.0 Windows release package.
 *
 * Output:  dist-release/ShelfDeck-v1.0.0/
 *   ├── ShelfDeck播放助手.exe           ← desktop portable
 *   ├── shelfdeck_service启动器.vbs     ← one-click service launcher + admin web
 *   └── media-service/                  ← service with bundled node.exe
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

// Copy desktop exe → ShelfDeck播放助手.exe
const desktopReleaseDir = path.join(ROOT, 'media-desktop', 'release');
const files = fs.readdirSync(desktopReleaseDir).filter(f => f.endsWith('.exe')).sort();
if (files.length === 0) throw new Error('No desktop exe found in media-desktop/release/');
const desktopExe = files[files.length - 1];
fs.copyFileSync(
  path.join(desktopReleaseDir, desktopExe),
  path.join(RELEASE, 'ShelfDeck播放助手.exe'),
);
console.log(`  copied ${desktopExe} → ShelfDeck播放助手.exe`);

// Copy service package
const svcSrc = path.join(ROOT, 'media-service', 'dist-pkg', 'media-service');
const svcDst = path.join(RELEASE, 'media-service');
execSync(`xcopy "${svcSrc}" "${svcDst}" /E /I /H /Q /Y`, { windowsHide: true, stdio: 'ignore' });
console.log('  copied media-service/');

// Copy VBS launcher to release root
const vbsSrc = path.join(ROOT, 'scripts', 'shelfdeck_service启动器.vbs');
fs.copyFileSync(vbsSrc, path.join(RELEASE, 'shelfdeck_service启动器.vbs'));
console.log('  copied shelfdeck_service启动器.vbs');

// ── done ───────────────────────────────────────────────────────────────────────

console.log(`\nDone → ${RELEASE}`);
console.log('Contents:');
for (const f of fs.readdirSync(RELEASE)) {
  const st = fs.statSync(path.join(RELEASE, f));
  const size = st.isFile() ? ` (${(st.size / 1024 / 1024).toFixed(1)}MB)` : '';
  console.log(`  ${f}${size}`);
}
