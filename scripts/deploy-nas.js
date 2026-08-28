'use strict';

/**
 * Safe production deploy for the NAS.
 *
 * Build the image on the workstation, upload the tar, then:
 *   node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <hash>
 *   node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <hash> --helix-clean-init --apply
 *
 * Helix-beta first cutover uses --helix-clean-init. Later upgrades omit it so
 * live data and Admin configuration stay in place. The script preserves the
 * media, upgrade, transcode, adult, and QSV mounts. /transcode is also this
 * NAS Production Workspace root.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const COMPOSE_FILE = `${COMPOSE_DIR}/docker-compose.yml`;
const DATA_DIR = `${COMPOSE_DIR}/data`;
const SECRET_FILE = `${COMPOSE_DIR}/secret.env`;
const MEDIA_HOST = '/vol02/1000-0-c5b736af';
const UPGRADE_HOST = '/vol2/1000/shelfdeck_upgrade';
const TRANSCODE_HOST = '/vol2/1000/shelfdeck_transcode';
const ADULT_HOST = '/vol02/1000-0-24018892';
const IMAGE_NAME = 'markmahoro/shelfdeck';
const LOCAL_SECRET_FILE = path.join(__dirname, '..', 'tests', '.env.nas-secret');
const LOCAL_ADMIN_KEY_FILE = path.join(__dirname, '..', 'tests', '.env.nas-admin');
const CLEAN_INIT_CONFIRM = 'INITIALIZE_HELIX_CLEAN_V1';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function redact(text) {
  return String(text || '')
    .replace(/("adminApiKey"\s*:\s*")[^"]*"/g, '$1***"')
    .replace(/("apiKey"\s*:\s*")[^"]*"/g, '$1***"')
    .replace(/("signingSecret"\s*:\s*")[^"]*"/g, '$1***"')
    .replace(/SHELFDECK_SECRET_ROOT=[^\s'"]+/g, 'SHELFDECK_SECRET_ROOT=***');
}

function imageFromTarball(tarball) {
  const base = path.posix.basename(String(tarball || ''));
  const match = base.match(/^shelfdeck-(.+)\.tar$/);
  if (!match || !match[1]) {
    throw new Error('Tarball must be named shelfdeck-<tag>.tar so the deploy script can update docker-compose.yml.');
  }
  return `${IMAGE_NAME}:${match[1]}`;
}

function parseArgs(argv) {
  const parsed = { tarball: '', apply: false, expectedSha256: '', helixCleanInit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--helix-clean-init') parsed.helixCleanInit = true;
    else if (arg === '--sha256') {
      parsed.expectedSha256 = argv[i + 1] || '';
      i += 1;
    } else if (arg.startsWith('--sha256=')) {
      parsed.expectedSha256 = arg.slice('--sha256='.length);
    } else if (!parsed.tarball) parsed.tarball = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.expectedSha256 && !/^[a-f0-9]{64}$/i.test(parsed.expectedSha256)) {
    throw new Error('Expected SHA-256 must be a 64-character hex string.');
  }
  return parsed;
}

function readEnvFile(filePath, key) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function loadOrCreateSecretRoot() {
  const fromEnv = String(process.env.SHELFDECK_SECRET_ROOT || '').trim();
  if (Buffer.byteLength(fromEnv, 'utf8') >= 32) return fromEnv;
  const fromFile = readEnvFile(LOCAL_SECRET_FILE, 'SHELFDECK_SECRET_ROOT');
  if (Buffer.byteLength(fromFile, 'utf8') >= 32) return fromFile;
  const generated = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(LOCAL_SECRET_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_SECRET_FILE, `SHELFDECK_SECRET_ROOT=${generated}\n`, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

function composeYaml(targetImage) {
  return [
    'services:',
    '  shelfdeck:',
    `    image: ${targetImage}`,
    '    platform: linux/amd64',
    '    container_name: shelfdeck',
    '    ports:',
    '      - "18080:18080"',
    '    env_file:',
    '      - secret.env',
    '    environment:',
    '      - MEDIA_SERVICE_PORT=18080',
    '      - MEDIA_SERVICE_DATA_DIR=/app/data',
    '      - FFMPEG_PATH=/usr/local/bin/ffmpeg',
    '      - FFPROBE_PATH=/usr/local/bin/ffprobe',
    '      - LIBVA_DRIVER_NAME=iHD',
    '    volumes:',
    `      - ${DATA_DIR}:/app/data`,
    `      - ${TRANSCODE_HOST}:/transcode`,
    `      - ${UPGRADE_HOST}:/upgrade`,
    `      - ${MEDIA_HOST}:/media`,
    `      - ${ADULT_HOST}:/adult_media`,
    '    devices:',
    '      - /dev/dri:/dev/dri',
    '    restart: unless-stopped',
    '',
  ].join('\n');
}

function connect() {
  const conn = new Client();
  return new Promise((resolve, reject) => {
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect(loadNasSshConfig({ readyTimeout: 20000 }));
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

function uploadText(conn, remotePath, contents, mode = 0o600) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remotePath, { flags: 'w', mode });
      stream.on('error', reject);
      stream.on('close', resolve);
      stream.end(contents);
    });
  });
}

function persistAdminApiKey(text) {
  try {
    const parsed = JSON.parse(String(text || '').replace(/^Could not chdir to home directory.*\r?\n/, ''));
    if (parsed && typeof parsed.adminApiKey === 'string' && parsed.adminApiKey) {
      fs.writeFileSync(LOCAL_ADMIN_KEY_FILE, `SHELFDECK_ADMIN_API_KEY=${parsed.adminApiKey}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
  } catch {
    // Non-JSON plan output is expected before --apply.
  }
}

async function execStep(conn, label, cmd) {
  console.log(`\n>>> ${label}`);
  const { code, out, errOut } = await run(conn, cmd);
  if (out) process.stdout.write(redact(out));
  if (errOut) process.stderr.write(redact(errOut));
  if (code !== 0) throw new Error(`${label} failed with exit code ${code}`);
  return { out, errOut };
}

async function main() {
  const { tarball, apply, expectedSha256, helixCleanInit } = parseArgs(process.argv.slice(2));
  if (!tarball) {
    console.error('Usage: node scripts/deploy-nas.js <tarball-on-nas> [--sha256 <hash>] [--helix-clean-init] [--apply]');
    process.exit(2);
  }
  const targetImage = imageFromTarball(tarball);
  const secretRoot = loadOrCreateSecretRoot();
  const yaml = composeYaml(targetImage);
  const secretEnv = `SHELFDECK_SECRET_ROOT=${secretRoot}\n`;

  const steps = [
    ['Check image tarball', `ls -l ${shellQuote(tarball)}`],
    ...(expectedSha256
      ? [['Verify image tarball SHA-256', `[ "$(sha256sum ${shellQuote(tarball)} | awk '{print $1}')" = "${expectedSha256.toLowerCase()}" ]`]]
      : []),
    ['Assert media, upgrade, transcode, adult, and QSV hosts', [
      `test -d ${shellQuote(MEDIA_HOST)}`,
      `mkdir -p ${shellQuote(UPGRADE_HOST)} ${shellQuote(TRANSCODE_HOST)} ${shellQuote(DATA_DIR)}`,
      `test -d ${shellQuote(UPGRADE_HOST)}`,
      `test -d ${shellQuote(TRANSCODE_HOST)}`,
      `test -d ${shellQuote(ADULT_HOST)}`,
      'test -e /dev/dri/renderD128',
    ].join(' && ')],
    ['Check compose file', `docker compose -f ${shellQuote(COMPOSE_FILE)} config >/dev/null`],
    ['Load image', `docker load -i ${shellQuote(tarball)}`],
    ...(helixCleanInit
      ? [['Helix clean initialization', [
          'docker run --rm',
          `--env-file ${shellQuote(SECRET_FILE)}`,
          `-v ${shellQuote(`${COMPOSE_DIR}:/run/helix-nas`)}`,
          shellQuote(targetImage),
          'node scripts/helix-clean-init.js',
          '--data-dir',
          '/run/helix-nas/data',
          '--apply',
          '--confirm',
          CLEAN_INIT_CONFIRM,
        ].join(' ')]]
      : [['Helix runtime readiness', [
          'docker run --rm',
          `--env-file ${shellQuote(SECRET_FILE)}`,
          `-v ${shellQuote(`${DATA_DIR}:/app/data:ro`)}`,
          shellQuote(targetImage),
          'node scripts/helix-clean-init.js',
          '--data-dir',
          '/app/data',
          '--readiness',
        ].join(' ')]]),
    ['Recreate through compose', `cd ${shellQuote(COMPOSE_DIR)} && docker compose up -d --force-recreate`],
    ['Wait for boot', 'sleep 8'],
    ['Verify health', [
      'for i in $(seq 1 36); do',
      'body=$(curl -fsS http://127.0.0.1:18080/v1/health) || { sleep 5; continue; };',
      'echo "$body";',
      'printf "%s" "$body" | grep -q \'"status":"ok"\' && exit 0;',
      'sleep 5;',
      'done;',
      'exit 1',
    ].join(' ')],
    ['Verify Admin Web', 'curl -fsS http://127.0.0.1:18080/admin | grep -q \'<div id="root"></div>\''],
    ['Verify media mount', `docker exec shelfdeck sh -lc 'test -d /media && test -d /upgrade && test -e /dev/dri/renderD128'`],
    ['Verify compose still binds required hosts', [
      `grep -F ${shellQuote(`${MEDIA_HOST}:/media`)} ${shellQuote(COMPOSE_FILE)}`,
      `grep -F ${shellQuote(`${UPGRADE_HOST}:/upgrade`)} ${shellQuote(COMPOSE_FILE)}`,
      `grep -F '/dev/dri:/dev/dri' ${shellQuote(COMPOSE_FILE)}`,
    ].join(' && ')],
    ['Verify running image tag', `docker inspect shelfdeck --format "{{.Config.Image}}" | grep -Fx ${shellQuote(targetImage)}`],
    ['Verify code comes from image', 'docker inspect shelfdeck --format "{{json .Mounts}}" | grep -v "shelfdeck-releases"'],
  ];

  console.log(`ShelfDeck NAS deploy (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`compose : ${COMPOSE_FILE}`);
  console.log(`tarball : ${tarball}`);
  console.log(`image   : ${targetImage}`);
  if (expectedSha256) console.log(`sha256 : ${expectedSha256.toLowerCase()}`);
  if (helixCleanInit) console.log('cutover: Helix clean initialization (INITIALIZE_HELIX_CLEAN_V1)');
  console.log(`data dir: ${DATA_DIR}`);
  console.log(`media   : ${MEDIA_HOST} -> /media`);
  console.log(`upgrade : ${UPGRADE_HOST} -> /upgrade`);
  console.log(`transcode: ${TRANSCODE_HOST} -> /transcode`);
  console.log(`adult   : ${ADULT_HOST} -> /adult_media`);
  console.log('qsv     : /dev/dri -> /dev/dri');
  console.log('secret  : env_file secret.env (not printed)');

  if (!apply) {
    console.log('\nCompose to write:\n');
    process.stdout.write(yaml);
    for (const [label, cmd] of steps) {
      console.log(`\n${label}\n  ${redact(cmd)}`);
    }
    console.log('\nDry run only. Re-run with --apply to execute these checks and deploy.');
    if (helixCleanInit) {
      console.log('This dry run includes --helix-clean-init; apply will reinitialize data.');
    }
    return;
  }

  const conn = await connect();
  try {
    console.log('\n>>> Upload secret.env and canonical compose');
    await uploadText(conn, SECRET_FILE, secretEnv, 0o600);
    await uploadText(conn, COMPOSE_FILE, yaml, 0o644);
    const chmod = await run(conn, `chmod 600 ${shellQuote(SECRET_FILE)}`);
    if (chmod.code !== 0) throw new Error('Protecting secret.env failed');

    for (const [label, cmd] of steps) {
      const result = await execStep(conn, label, cmd);
      if (label === 'Helix clean initialization') persistAdminApiKey(result.out);
    }
  } finally {
    conn.end();
  }

  console.log('\nDeploy complete.');
  if (fs.existsSync(LOCAL_ADMIN_KEY_FILE)) {
    console.log('Admin API key saved to tests/.env.nas-admin (gitignored).');
  }
}

main().catch((err) => {
  console.error(`\nDEPLOY BLOCKED: ${err.message}`);
  process.exit(1);
});
