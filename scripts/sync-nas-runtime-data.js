'use strict';

/**
 * Sync ShelfDeck NAS runtime data into a local ignored directory for fast,
 * production-shaped debugging without deploying every slice.
 *
 * Usage:
 *   node scripts/sync-nas-runtime-data.js
 *   node scripts/sync-nas-runtime-data.js --out .codex/local-prod-data --rewrite-local-paths
 *   node scripts/sync-nas-runtime-data.js --no-db --rewrite-local-paths --emby-root Z:\ --adult-root Y:\
 */

const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const DEFAULT_REMOTE_DIR = '/vol1/1000/docker/shelfdeck/data';
const DEFAULT_OUT = path.join('.codex', 'local-prod-data');
const BASE_FILES = [
  'config.json',
  'douban-entries-cache.json',
];
const DB_FILES = [
  'library.db',
  'library.db-wal',
  'library.db-shm',
  'tasks.db',
  'tasks.db-wal',
  'tasks.db-shm',
];

function usage() {
  console.log(`Usage: node scripts/sync-nas-runtime-data.js [options]

Options:
  --out <dir>              Local output dir (default: ${DEFAULT_OUT})
  --remote-dir <dir>       NAS runtime data dir (default: ${DEFAULT_REMOTE_DIR})
  --no-db                  Only sync config/cache files, not SQLite DB files
  --rewrite-local-paths    Rewrite copied config for local Windows media roots
  --emby-root <path>       Local root for Emby libraries (default: Z:\\)
  --adult-root <path>      Local root for adult folder libraries (default: Y:\\)
  --help                   Show this help
`);
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    remoteDir: DEFAULT_REMOTE_DIR,
    includeDb: true,
    rewriteLocalPaths: false,
    embyRoot: 'Z:\\',
    adultRoot: 'Y:\\',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--out') {
      args.out = argv[++i] || '';
    } else if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length);
    } else if (arg === '--remote-dir') {
      args.remoteDir = argv[++i] || '';
    } else if (arg.startsWith('--remote-dir=')) {
      args.remoteDir = arg.slice('--remote-dir='.length);
    } else if (arg === '--no-db') {
      args.includeDb = false;
    } else if (arg === '--rewrite-local-paths') {
      args.rewriteLocalPaths = true;
    } else if (arg === '--emby-root') {
      args.embyRoot = argv[++i] || '';
    } else if (arg.startsWith('--emby-root=')) {
      args.embyRoot = arg.slice('--emby-root='.length);
    } else if (arg === '--adult-root') {
      args.adultRoot = argv[++i] || '';
    } else if (arg.startsWith('--adult-root=')) {
      args.adultRoot = arg.slice('--adult-root='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.out || !args.remoteDir) throw new Error('--out and --remote-dir are required');
  return args;
}

function connect() {
  const conn = new Client();
  return new Promise((resolve, reject) => {
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect(loadNasSshConfig({ readyTimeout: 15000 }));
  });
}

function openSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function stat(sftp, file) {
  return new Promise((resolve) => {
    sftp.stat(file, (err, stats) => resolve(err ? null : stats));
  });
}

function fastGet(sftp, remote, local) {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remote, local, {}, (err) => (err ? reject(err) : resolve()));
  });
}

function normalizeWindowsRoot(root) {
  const raw = String(root || '').trim();
  if (!raw) return raw;
  return raw.replace(/[\\/]+$/, '') + '\\';
}

function guessEmbySourceRoot(subLib = {}) {
  const from = String(subLib.pathMapFrom || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (from) return from;
  const to = String(subLib.pathMapTo || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (to) return to;
  return '/volume1/Media';
}

function rewriteConfigForLocal(config, args) {
  const embyRoot = normalizeWindowsRoot(args.embyRoot);
  const adultRoot = normalizeWindowsRoot(args.adultRoot);
  const subLibraries = Array.isArray(config.subLibraries) ? config.subLibraries : [];
  for (const subLib of subLibraries) {
    const source = subLib.source || 'emby';
    const mediaType = subLib.mediaType || '';
    if (source === 'emby') {
      subLib.pathMapFrom = guessEmbySourceRoot(subLib);
      subLib.pathMapTo = embyRoot;
    } else if (source === 'folder' || mediaType === 'adult') {
      if (subLib.watchRoot) subLib.watchRoot = adultRoot;
      subLib.pathMapFrom = subLib.pathMapFrom || subLib.watchRoot || adultRoot;
      subLib.pathMapTo = adultRoot;
    }
  }
  config.__localProfile = {
    generatedAt: new Date().toISOString(),
    source: 'scripts/sync-nas-runtime-data.js',
    embyRoot,
    adultRoot,
  };
  return config;
}

async function downloadFiles(args) {
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [...BASE_FILES, ...(args.includeDb ? DB_FILES : [])];
  const remoteDir = args.remoteDir.replace(/\/+$/, '');
  const conn = await connect();
  try {
    const sftp = await openSftp(conn);
    for (const name of files) {
      const remote = `${remoteDir}/${name}`;
      const local = path.join(outDir, name);
      const stats = await stat(sftp, remote);
      if (!stats) {
        console.log(`skip missing ${name}`);
        continue;
      }
      const started = Date.now();
      const mb = (stats.size / 1024 / 1024).toFixed(1);
      console.log(`download ${name} ${mb} MB`);
      await fastGet(sftp, remote, local);
      console.log(`done ${name} ${Date.now() - started}ms`);
    }
  } finally {
    conn.end();
  }
  return outDir;
}

function writeEnvFile(outDir) {
  const envPath = path.join(outDir, 'local-prod.env');
  const lines = [
    `CONTROL_PLANE_DATA_DIR=${outDir}`,
    `MEDIA_SERVICE_DATA_DIR=${outDir}`,
  ];
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
  return envPath;
}

function maybeRewriteConfig(outDir, args) {
  if (!args.rewriteLocalPaths) return null;
  const configPath = path.join(outDir, 'config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const rewritten = rewriteConfigForLocal(JSON.parse(raw), args);
  const backupPath = path.join(outDir, 'config.nas-original.json');
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, raw, 'utf8');
  fs.writeFileSync(configPath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf8');
  return backupPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const outDir = await downloadFiles(args);
  const backupPath = maybeRewriteConfig(outDir, args);
  const envPath = writeEnvFile(outDir);
  console.log('\nLocal runtime profile ready.');
  console.log(`data dir: ${outDir}`);
  console.log(`env file: ${envPath}`);
  if (backupPath) console.log(`original config backup: ${backupPath}`);
  console.log('\nPowerShell example:');
  console.log(`  $env:CONTROL_PLANE_DATA_DIR='${outDir}'; $env:MEDIA_SERVICE_DATA_DIR='${outDir}'; cd media-service; npm test`);
}

main().catch((err) => {
  console.error(`\nSYNC FAILED: ${err.message}`);
  process.exit(1);
});
