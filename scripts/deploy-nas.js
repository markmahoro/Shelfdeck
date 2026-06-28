'use strict';

/**
 * Safe production deploy for the NAS.
 *
 * Usage:
 *   node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-v1.1.0.tar
 *   node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-v1.1.0.tar --apply
 *
 * The script is dry-run by default. With --apply it:
 *   1. Refuses to proceed if the live container has an ffmpeg process.
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

async function main() {
  const tarball = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!tarball) {
    console.error('Usage: node scripts/deploy-nas.js <tarball-on-nas> [--apply]');
    process.exit(2);
  }

  const steps = [
    ['Check image tarball', `ls -l ${shellQuote(tarball)}`],
    ['Check compose file', `docker compose -f ${shellQuote(COMPOSE_FILE)} config >/dev/null`],
    ['Refuse if ffmpeg is active', 'if docker exec shelfdeck pgrep -a ffmpeg >/tmp/shelfdeck-ffmpeg.txt 2>/dev/null; then cat /tmp/shelfdeck-ffmpeg.txt; exit 42; fi'],
    ['Pre-flight data sizes', `wc -c ${DATA_DIR}/config.json ${DATA_DIR}/library.json ${DATA_DIR}/tasks.json`],
    ['Load image', `docker load -i ${shellQuote(tarball)}`],
    ['Snapshot data files', dataSnapshotCmd()],
    ['Recreate through compose', `cd ${shellQuote(COMPOSE_DIR)} && docker compose up -d --force-recreate`],
    ['Wait for boot', 'sleep 8'],
    ['Verify health', 'curl -fsS http://127.0.0.1:18080/v1/health'],
    ['Verify adult mount', 'docker exec shelfdeck sh -lc "test -d /adult_media/JAV && ls /adult_media/JAV | head -5"'],
    ['Verify code comes from image', 'docker inspect shelfdeck --format "{{json .Mounts}}" | grep -v "shelfdeck-releases"'],
    ['Verify scraper module', 'docker exec shelfdeck node -e "require(\'/app/src/services/japaneseJavScraper\'); require(\'/app/src/scrapeFlowExecutor\'); console.log(\'SCRAPER_OK\')"'],
    ['Post-flight data sizes', `wc -c ${DATA_DIR}/config.json ${DATA_DIR}/library.json ${DATA_DIR}/tasks.json`],
  ];

  console.log(`ShelfDeck NAS deploy (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`compose : ${COMPOSE_FILE}`);
  console.log(`tarball : ${tarball}`);
  console.log(`data dir: ${DATA_DIR}`);
  console.log('mount   : /vol02/1000-0-24018892 -> /adult_media');

  if (!apply) {
    for (const [label, cmd] of steps) {
      console.log(`\n${label}\n  ${cmd}`);
    }
    console.log('\nDry run only. Add --apply after the active transcode finishes.');
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
      if (code !== 0) {
        if (code === 42) {
          throw new Error('ffmpeg is active in the live container; wait for the transcode to finish before recreating.');
        }
        throw new Error(`${label} failed with exit code ${code}`);
      }
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
