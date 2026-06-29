'use strict';

/**
 * Upload a locally built ShelfDeck image tarball to the NAS through SFTP.
 *
 * Usage:
 *   node scripts/upload-nas-image.js dist-image/shelfdeck-<tag>.tar
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const DEFAULT_REMOTE_DIR = '/vol1/1000/docker/shelfdeck';

function usage() {
  console.error('Usage: node scripts/upload-nas-image.js <local-shelfdeck-tar> [--remote-dir <nas-dir>]');
}

function parseArgs(argv) {
  const parsed = { localTar: '', remoteDir: DEFAULT_REMOTE_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--remote-dir') {
      parsed.remoteDir = argv[i + 1] || '';
      i += 1;
    } else if (arg.startsWith('--remote-dir=')) {
      parsed.remoteDir = arg.slice('--remote-dir='.length);
    } else if (!parsed.localTar) {
      parsed.localTar = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.localTar || !parsed.remoteDir) throw new Error('Local tarball and remote dir are required.');
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function connect() {
  const conn = new Client();
  return new Promise((resolve, reject) => {
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect(loadNasSshConfig({ readyTimeout: 15000 }));
  });
}

function run(conn, cmd) {
  return new Promise((resolve, reject) => {
    let out = '';
    let errOut = '';
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      stream.on('close', (code) => resolve({ code, out, errOut }));
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { errOut += d.toString(); });
    });
  });
}

function uploadSftp(conn, localTar, remoteTemp, totalBytes) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const input = fs.createReadStream(localTar, { highWaterMark: 1024 * 1024 });
      const output = sftp.createWriteStream(remoteTemp, { flags: 'w', mode: 0o644 });
      let sent = 0;
      let lastPct = -1;

      input.on('data', (chunk) => {
        sent += chunk.length;
        const pct = Math.floor((sent / totalBytes) * 100);
        if (pct === 100 || pct >= lastPct + 10) {
          lastPct = pct;
          console.log(`uploaded ${pct}% (${sent}/${totalBytes})`);
        }
      });
      input.on('error', reject);
      output.on('error', reject);
      output.on('close', resolve);
      input.pipe(output);
    });
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    throw err;
  }

  const localTar = path.resolve(args.localTar);
  const base = path.basename(localTar);
  if (!/^shelfdeck-.+\.tar$/.test(base)) {
    throw new Error('Local tarball must be named shelfdeck-<tag>.tar.');
  }
  const stat = fs.statSync(localTar);
  if (!stat.isFile()) throw new Error(`Local tarball is not a file: ${localTar}`);

  const remoteDir = args.remoteDir.replace(/\/+$/, '');
  const remotePath = `${remoteDir}/${base}`;
  const remoteTemp = `${remotePath}.uploading-${Date.now()}`;
  const localSha = await sha256File(localTar);

  console.log('ShelfDeck NAS image upload');
  console.log(`local : ${localTar}`);
  console.log(`remote: ${remotePath}`);
  console.log(`size  : ${stat.size}`);
  console.log(`sha256: ${localSha}`);

  const conn = await connect();
  try {
    const mkdir = await run(conn, `mkdir -p ${shellQuote(remoteDir)}`);
    if (mkdir.out) process.stdout.write(mkdir.out);
    if (mkdir.errOut) process.stderr.write(mkdir.errOut);
    if (mkdir.code !== 0) throw new Error(`Create remote dir failed with exit code ${mkdir.code}`);

    await uploadSftp(conn, localTar, remoteTemp, stat.size);

    const publishCmd = [
      `mv -f ${shellQuote(remoteTemp)} ${shellQuote(remotePath)}`,
      `test "$(sha256sum ${shellQuote(remotePath)} | awk '{print $1}')" = "${localSha}"`,
      `ls -lh ${shellQuote(remotePath)}`,
    ].join(' && ');
    const publish = await run(conn, publishCmd);
    if (publish.out) process.stdout.write(publish.out);
    if (publish.errOut) process.stderr.write(publish.errOut);
    if (publish.code !== 0) throw new Error(`Remote publish or SHA-256 verification failed with exit code ${publish.code}`);
  } finally {
    conn.end();
  }

  console.log('\nUpload complete and SHA-256 verified.');
  console.log('\nNext:');
  console.log(`  node scripts/deploy-nas.js ${remotePath} --sha256 ${localSha}`);
  console.log(`  node scripts/deploy-nas.js ${remotePath} --sha256 ${localSha} --apply`);
}

main().catch((err) => {
  console.error(`\nUPLOAD FAILED: ${err.message}`);
  process.exit(1);
});
