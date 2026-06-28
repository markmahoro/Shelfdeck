'use strict';

/**
 * Safe production deploy for the NAS.
 *
 * Usage:
 *   node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-v1.1.0.tar
 *   node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-v1.1.0.tar --apply
 *   node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-v1.1.0.tar --sha256 <hash> --apply
 *
 * The script is dry-run by default. With --apply it:
 *   1. Prints currently active ffmpeg processes for awareness.
 *   2. Loads the supplied image tarball.
 *   3. Backs up config.json, library.json, and tasks.json.
 *   4. Recreates ShelfDeck through the NAS compose file.
 *   5. Verifies health, image-based code, preserved data, and /adult_media.
 */

const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));

const NAS = {
  host: '192.168.12.230',
  port: 22,
  username: 'gezhu',
  password: '3R632z33!!',
  readyTimeout: 15000,
};

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const COMPOSE_FILE = `${COMPOSE_DIR}/docker-compose.yml`;
const DATA_DIR = '/vol1/1000/docker/shelfdeck/data';
const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const IMAGE_NAME = 'markmahoro/shelfdeck';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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

function dataSnapshotCmd() {
  const files = ['config.json', 'library.json', 'tasks.json'];
  return files.map((file) => {
    const src = `${DATA_DIR}/${file}`;
    const dst = `${src}.pre-image-adult-${STAMP}.bak`;
    return `[ -f ${shellQuote(src)} ] && cp -p ${shellQuote(src)} ${shellQuote(dst)} && echo backed-up:${file}`;
  }).join(' ; ');
}

function imageFromTarball(tarball) {
  const base = path.posix.basename(String(tarball || ''));
  const m = base.match(/^shelfdeck-(.+)\.tar$/);
  if (!m || !m[1]) {
    throw new Error('Tarball must be named shelfdeck-<tag>.tar so the deploy script can update docker-compose.yml.');
  }
  return `${IMAGE_NAME}:${m[1]}`;
}

function activeFfmpegCheckCmd() {
  return [
    'docker exec shelfdeck sh -lc',
    shellQuote('ps -eo pid,stat,comm,args | awk \'NR>1 && $3=="ffmpeg" && $2 !~ /^Z/ {print}\' || true'),
  ].join(' ');
}

function updateComposeImageCmd(targetImage) {
  const compose = shellQuote(COMPOSE_FILE);
  const backup = shellQuote(`${COMPOSE_FILE}.pre-image-${STAMP}.bak`);
  const image = String(targetImage).replace(/[&/\\]/g, '\\$&');
  return [
    `test "$(grep -c '^[[:space:]]*image:' ${compose})" = "1"`,
    `cp -p ${compose} ${backup}`,
    `sed -i -E 's#(^[[:space:]]*image:[[:space:]]*).*$#\\1${image}#' ${compose}`,
    `grep -n 'image:' ${compose}`,
  ].join(' && ');
}

function waitForHealthCmd() {
  return [
    'for i in $(seq 1 12); do',
    'body=$(curl -fsS http://127.0.0.1:18080/v1/health) || { sleep 5; continue; };',
    'echo "$body";',
    'if ! printf "%s" "$body" | grep -q \'"status":"red"\'; then exit 0; fi;',
    'sleep 5;',
    'done;',
    'exit 1',
  ].join(' ');
}

function parseArgs(argv) {
  const parsed = { tarball: '', apply: false, expectedSha256: '' };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      parsed.apply = true;
    } else if (arg === '--sha256') {
      parsed.expectedSha256 = argv[i + 1] || '';
      i += 1;
    } else if (arg.startsWith('--sha256=')) {
      parsed.expectedSha256 = arg.slice('--sha256='.length);
    } else if (!parsed.tarball) {
      parsed.tarball = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.expectedSha256 && !/^[a-f0-9]{64}$/i.test(parsed.expectedSha256)) {
    throw new Error('Expected SHA-256 must be a 64-character hex string.');
  }

  return parsed;
}

async function main() {
  const { tarball, apply, expectedSha256 } = parseArgs(process.argv.slice(2));
  if (!tarball) {
    console.error('Usage: node scripts/deploy-nas.js <tarball-on-nas> [--sha256 <hash>] [--apply]');
    process.exit(2);
  }

  const targetImage = imageFromTarball(tarball);

  const steps = [
    ['Check image tarball', `ls -l ${shellQuote(tarball)}`],
    ...(expectedSha256
      ? [['Verify image tarball SHA-256', `[ "$(sha256sum ${shellQuote(tarball)} | awk '{print $1}')" = "${expectedSha256.toLowerCase()}" ]`]]
      : []),
    ['Check compose file', `docker compose -f ${shellQuote(COMPOSE_FILE)} config >/dev/null`],
    ['Show active ffmpeg processes', activeFfmpegCheckCmd()],
    ['Pre-flight data sizes', `wc -c ${DATA_DIR}/config.json ${DATA_DIR}/library.json ${DATA_DIR}/tasks.json`],
    ['Load image', `docker load -i ${shellQuote(tarball)}`],
    ['Update compose image', updateComposeImageCmd(targetImage)],
    ['Snapshot data files', dataSnapshotCmd()],
    ['Recreate through compose', `cd ${shellQuote(COMPOSE_DIR)} && docker compose up -d --force-recreate`],
    ['Wait for boot', 'sleep 8'],
    ['Verify health', waitForHealthCmd()],
    ['Verify adult mount', 'docker exec shelfdeck sh -lc "test -d /adult_media/JAV && ls /adult_media/JAV | head -5"'],
    ['Verify code comes from image', 'docker inspect shelfdeck --format "{{json .Mounts}}" | grep -v "shelfdeck-releases"'],
    ['Verify running image tag', `docker inspect shelfdeck --format "{{.Config.Image}}" | grep -Fx ${shellQuote(targetImage)}`],
    ['Verify scraper module', 'docker exec shelfdeck node -e "require(\'/app/src/services/japaneseJavScraper\'); require(\'/app/src/scrapeFlowExecutor\'); console.log(\'SCRAPER_OK\')"'],
    ['Post-flight data sizes', `wc -c ${DATA_DIR}/config.json ${DATA_DIR}/library.json ${DATA_DIR}/tasks.json`],
  ];

  console.log(`ShelfDeck NAS deploy (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`compose : ${COMPOSE_FILE}`);
  console.log(`tarball : ${tarball}`);
  console.log(`image   : ${targetImage}`);
  if (expectedSha256) console.log(`sha256 : ${expectedSha256.toLowerCase()}`);
  console.log(`data dir: ${DATA_DIR}`);
  console.log('mount   : /vol02/1000-0-24018892 -> /adult_media');

  if (!apply) {
    for (const [label, cmd] of steps) {
      console.log(`\n${label}\n  ${cmd}`);
    }
    console.log('\nDry run only. Re-run with --apply to execute these checks and deploy.');
    return;
  }

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect(NAS);
  });

  try {
    for (const [label, cmd] of steps) {
      console.log(`\n>>> ${label}`);
      const { code, out, errOut } = await run(conn, cmd);
      if (out) process.stdout.write(out);
      if (errOut) process.stderr.write(errOut);
      if (code !== 0) throw new Error(`${label} failed with exit code ${code}`);
    }
  } finally {
    conn.end();
  }

  console.log('\nDeploy complete.');
}

main().catch((err) => {
  console.error(`\nDEPLOY BLOCKED: ${err.message}`);
  process.exit(1);
});
