'use strict';

/**
 * Package media-service for Windows distribution.
 *
 * Produces a self-contained directory with node.exe, start.bat,
 * and all dependencies.  No separate Node.js installation required.
 *
 * Usage:  node scripts/package-win.js [--output <new-directory>]
 * Output: dist-pkg/media-service/  (ready to zip)
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
  throw new Error('Supply only --output with a new package directory.');
}
if (process.platform !== 'win32') throw new Error('Windows packaging requires its Windows runtime and native dependencies.');
const OUT = args.length ? path.resolve(args[1]) : path.join(ROOT, 'dist-pkg', 'media-service');
for (const input of ['src', 'scripts', 'dist', 'node_modules', 'resources']) {
  const relative = path.relative(path.join(ROOT, input), OUT);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Package output cannot be nested in its source inputs.');
  }
}

// ── clean ──────────────────────────────────────────────────────────────────────

if (fs.existsSync(OUT)) throw new Error('Package output already exists; use a new directory.');
let existingParent = path.dirname(OUT);
while (!fs.existsSync(existingParent)) existingParent = path.dirname(existingParent);
if (fs.realpathSync(existingParent).toLowerCase() !== path.resolve(existingParent).toLowerCase()) {
  throw new Error('Package output parents must not use symbolic links or junctions.');
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(OUT);

// ── build admin web ────────────────────────────────────────────────────────────

console.log('[package] verifying the local face model pack...');
execFileSync(process.execPath, [path.join(ROOT, 'scripts/install-face-models.js')], { cwd: ROOT, stdio: 'inherit' });
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
  'resources',
];

for (const name of INCLUDE) {
  const src = path.join(ROOT, name);
  const dst = path.join(OUT, name);
  if (!fs.existsSync(src)) {
    throw new Error(`Required package input is missing: ${name}`);
  }
  console.log(`[package] copying ${name}...`);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  } else {
    fs.copyFileSync(src, dst);
  }
}

const CLEAN_RUNTIME_FILES = [
  'src/server.js',
  'src/clean-service-host.js',
  'src/clean-admin-static.js',
  'src/clean-runtime-operations.js',
  'src/clean-maintenance-window.js',
  'src/clean-people-image-port.js',
  'src/clean-us-adult-frame-extractor.js',
  'src/clean-us-adult-inventory-analysis-port.js',
  'src/clean-formation-reset-port.js',
  'src/clean-arca-inventory-port.js',
  'src/clean-arca-recycle-port.js',
  'src/clean-arca-target-commit-slot.js',
  'src/clean-compute-device-runtime.js',
  'src/clean-ffmpeg-process-registry.js',
  'src/clean-field-access-binding-probe.js',
  'src/clean-field-observation-enumerator.js',
  'src/clean-layout-observer.js',
  'src/clean-local-filesystem-mount-probe.js',
  'src/clean-media-probe.js',
  'src/clean-media-production-effect-port.js',
  'src/clean-offdeck-deletion-port.js',
  'src/clean-product-production-port.js',
  'src/clean-shelf-target-folder-probe.js',
  'src/clean-western-analysis-port.js',
  'src/clean-us-adult-recommendation-image-port.js',
  'src/clean-workspace-product-port.js',
  'src/clean-workspace-root-admin.js',
  'scripts/helix-formation-reset.js',
  'scripts/user-formation-reset.js',
  'scripts/user-formation-reset-worker.js',
  'src/admin-credential-secret-store.js',
  'scripts/helix-clean-init.js',
  'scripts/helix-jav-schema-copy.js',
  'scripts/helix-libra-schema-copy.js',
  'scripts/helix-us-adult-schema-copy.js',
  'scripts/helix-architecture/us-adult-schema-copy.js',
  'scripts/helix-architecture/libra-workshop-schema-copy.js',
  'scripts/helix-architecture/jav-release-schema-copy.js',
  'scripts/helix-architecture/jav-release-effect-history-proof.js',
  'scripts/helix-architecture/readonly-history-projections.js',
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
fs.cpSync(cleanHelixSource, cleanHelixTarget, { recursive: true, errorOnExist: true, force: false });

// ── clean runtime data (fresh start for user) ──────────────────────────────────

const dataDir = path.join(OUT, 'data');
if (fs.existsSync(dataDir)) {
  throw new Error('A distributable package cannot contain runtime data.');
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
const quotePowerShell = value => "'" + value.replace(/'/g, "''") + "'";
console.log(`[package] zip it with: Compress-Archive -Path ${quotePowerShell(OUT)} -DestinationPath ${quotePowerShell(OUT + '.zip')}`);
