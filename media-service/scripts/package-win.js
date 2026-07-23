'use strict';

/**
 * Package media-service for Windows distribution.
 *
 * Produces a self-contained directory with node.exe, start.bat,
 * and all dependencies.  No separate Node.js installation required.
 *
 * Usage:  node scripts/package-win.js
 * Output: dist-pkg/media-service/  (ready to zip)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-pkg', 'media-service');

// ── clean ──────────────────────────────────────────────────────────────────────

if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });

// ── build admin web ────────────────────────────────────────────────────────────

console.log('[package] building admin web...');
execSync('npm run build:web', { cwd: ROOT, stdio: 'inherit' });

// ── copy node.exe ──────────────────────────────────────────────────────────────

const nodeExe = process.execPath;
const destExe = path.join(OUT, 'node.exe');
console.log(`[package] copying node.exe from ${nodeExe}`);
fs.copyFileSync(nodeExe, destExe);

// ── copy service files ─────────────────────────────────────────────────────────

const INCLUDE = [
  'package.json',
  'package-lock.json',
  'dist',
  'node_modules',
];

for (const name of INCLUDE) {
  const src = path.join(ROOT, name);
  const dst = path.join(OUT, name);
  if (!fs.existsSync(src)) {
    console.warn(`[package] WARN: ${name} not found, skipping`);
    continue;
  }
  console.log(`[package] copying ${name}...`);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    execSync(`xcopy "${src}" "${dst}" /E /I /H /Q /Y`, { windowsHide: true, stdio: 'ignore' });
  } else {
    fs.copyFileSync(src, dst);
  }
}

const CLEAN_RUNTIME_FILES = [
  'src/server.js',
  'src/clean-service-host.js',
  'src/admin-credential-secret-store.js',
  'scripts/helix-clean-init.js',
  'scripts/helix-operational-safety.js',
];
for (const name of CLEAN_RUNTIME_FILES) {
  const src = path.join(ROOT, name);
  const dst = path.join(OUT, name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
const cleanHelixSource = path.join(ROOT, 'src', 'helix');
const cleanHelixTarget = path.join(OUT, 'src', 'helix');
execSync(`xcopy "${cleanHelixSource}" "${cleanHelixTarget}" /E /I /H /Q /Y`, {
  windowsHide: true,
  stdio: 'ignore',
});

// ── clean runtime data (fresh start for user) ──────────────────────────────────

const dataDir = path.join(OUT, 'data');
if (fs.existsSync(dataDir)) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

// ── create start.bat (fallback) ──────────────────────────────────────────────────

const bat = [
  '@echo off',
  'title ShelfDeck 媒体管理服务',
  'echo ============================================',
  'echo   ShelfDeck 媒体管理服务 v1.0.0',
  'echo   管理页面: http://127.0.0.1:18080/admin',
  'echo ============================================',
  'echo.',
  'cd /d "%~dp0"',
  'if "%SHELFDECK_SECRET_ROOT%"=="" (',
  '  echo ERROR: SHELFDECK_SECRET_ROOT must contain at least 32 bytes.',
  '  exit /b 1',
  ')',
  'node.exe src/server.js',
  'pause',
].join('\r\n');
fs.writeFileSync(path.join(OUT, 'start.bat'), bat, 'utf8');

// ── create start.vbs (no console window) ──────────────────────────────────────

const vbs = [
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'Set ws = CreateObject("WScript.Shell")',
  'ws.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)',
  '',
  "' Start service (hidden window)",
  'If Len(ws.ExpandEnvironmentStrings("%SHELFDECK_SECRET_ROOT%")) < 32 Then',
  '  MsgBox "SHELFDECK_SECRET_ROOT must contain at least 32 bytes.", 16, "ShelfDeck"',
  '  WScript.Quit 1',
  'End If',
  'ws.Run "node.exe src\\server.js", 0, False',
  '',
  "' Wait for server to start, then open admin page",
  'WScript.Sleep 2000',
  'ws.Run "http://127.0.0.1:18080/admin"',
].join('\r\n');
fs.writeFileSync(path.join(OUT, 'start.vbs'), vbs, 'utf8');
console.log('[package] created start.bat + start.vbs');

// ── done ───────────────────────────────────────────────────────────────────────

console.log(`[package] done → ${OUT}`);
console.log('[package] zip it with: Compress-Archive -Path dist-pkg/media-service -DestinationPath dist-pkg/media-service.zip');
