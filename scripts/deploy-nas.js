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
const OPERATOR_BACKUP_HOST = '/vol2/1000/shelfdeck_backups';
const ADULT_HOST = '/vol02/1000-0-24018892';
// Host package is install *input* only. Runtime authority is the installed copy
// under ShelfDeck data (DELETE journal). Do not mount the package as :ro runtime.
const US_ADULT_CATALOGUE_PACKAGE_HOST = `${COMPOSE_DIR}/us-adult-catalogue`;
const US_ADULT_CATALOGUE_INSTALLED_CONTAINER = '/app/data/us-adult-catalogue';
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
    else if (arg === '--verify-only') parsed.verifyOnly = true;
    else if (arg === '--runtime-reset-config') { parsed.runtimeResetConfig = argv[++i]; if (!parsed.runtimeResetConfig) throw new Error('Runtime Reset configuration file is required.'); }
    else if (arg === '--continue-people-reference-recovery') parsed.continuePeopleRecovery = true;
    else if (arg === '--recover-people-references') { parsed.peopleRecoveryFile = argv[++i]; if (!parsed.peopleRecoveryFile) throw new Error('People recovery scope file is required.'); }
    else if (arg === '--continue-fresh-reset') parsed.continueFreshReset = true;
    else if (arg === '--helix-clean-init') parsed.helixCleanInit = true;
    else if (arg === '--fresh-reset-config') { parsed.freshResetConfig = argv[++i]; if (!parsed.freshResetConfig) throw new Error('Fresh Reset configuration file is required.'); }
    else if (arg === '--capacity-plan') { parsed.capacityPlan = argv[++i]; if (!parsed.capacityPlan) throw new Error('Capacity plan file is required.'); }
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
  if (parsed.freshResetConfig && (parsed.helixCleanInit || !parsed.expectedSha256 || !parsed.capacityPlan))
    throw new Error('Fresh Reset deployment requires SHA-256 and capacity plan, and cannot initialize clean data.');
  if (parsed.runtimeResetConfig && (parsed.freshResetConfig || parsed.helixCleanInit || parsed.peopleRecoveryFile ||
      parsed.continueFreshReset || parsed.continuePeopleRecovery || !parsed.expectedSha256 || !parsed.capacityPlan))
    throw new Error('Ordinary stopped upgrades require SHA-256 and capacity, and cannot run Reset or dependency recovery.');
  if (parsed.continueFreshReset && !parsed.freshResetConfig) throw new Error('Cold continuation requires explicit Fresh Reset configuration.');
  if (parsed.peopleRecoveryFile && (!parsed.freshResetConfig || parsed.continueFreshReset || parsed.helixCleanInit))
    throw new Error('People recovery requires the explicit stopped configuration and cannot be combined with Reset or initialization.');
  if (parsed.continuePeopleRecovery && !parsed.peopleRecoveryFile) throw new Error('People recovery continuation requires its original scope.');
  if (parsed.verifyOnly && (parsed.apply || !parsed.expectedSha256 || parsed.helixCleanInit || parsed.continueFreshReset || parsed.continuePeopleRecovery))
    throw new Error('Read-only verification requires SHA-256 and cannot apply or continue a mutation.');
  return parsed;
}

function healthExpectation({ resetConfiguration, peopleRecoveryScope, runtimeResetConfig }) {
  return { status: resetConfiguration && !peopleRecoveryScope && !runtimeResetConfig ? 'maintenance' : 'ok', stopped: Boolean(resetConfiguration) };
}
function selectVerificationSteps(steps) {
  const allowed = new Set(['Check image tarball', 'Verify image tarball SHA-256', 'Check compose file',
    'Verify health', 'Verify Admin Web', 'Verify media mount', 'Verify US Adult catalogue installed', 'Verify compose still binds required hosts',
    'Verify running image tag', 'Verify code comes from image']);
  return steps.filter(([label]) => allowed.has(label));
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

function loadOrCreateSecretRoot({ allowCreate = false } = {}) {
  const fromEnv = String(process.env.SHELFDECK_SECRET_ROOT || '').trim();
  if (Buffer.byteLength(fromEnv, 'utf8') >= 32) return fromEnv;
  const fromFile = readEnvFile(LOCAL_SECRET_FILE, 'SHELFDECK_SECRET_ROOT');
  if (Buffer.byteLength(fromFile, 'utf8') >= 32) return fromFile;
  if (!allowCreate) {
    throw new Error('SHELFDECK_SECRET_ROOT is unavailable locally; refusing to rotate the production secret during an upgrade.');
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(LOCAL_SECRET_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_SECRET_FILE, `SHELFDECK_SECRET_ROOT=${generated}\n`, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

function composeYaml(targetImage, resetConfiguration, { coldBootstrap = true } = {}) {
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
    // US Adult face catalogue is product data under /app/data (installed DELETE-journal copy).
    // buffalo_l stays image-baked; vector package is not a Docker layer and not a :ro runtime mount.
    `      - SHELFDECK_US_ADULT_CATALOGUE_ROOT=${US_ADULT_CATALOGUE_INSTALLED_CONTAINER}`,
    `      - SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH=${US_ADULT_CATALOGUE_INSTALLED_CONTAINER}/generation.json`,
    ...(resetConfiguration ? ['      - SHELFDECK_RESET_CONFIG_FILE=/run/shelfdeck-reset/config.json',
      ...(coldBootstrap ? [`      - SHELFDECK_RESET_BOOTSTRAP_FILE=${resetConfiguration.operationRoot}/deployment-bootstrap.json`] : [])] : []),
    '    volumes:',
    `      - ${DATA_DIR}:/app/data`,
    `      - ${OPERATOR_BACKUP_HOST}:/app/data/operator-backups`,
    ...(resetConfiguration ? [`      - ${OPERATOR_BACKUP_HOST}:/operator-backups`,
      `      - ${COMPOSE_DIR}/reset-config.json:/run/shelfdeck-reset/config.json:ro`] : []),
    `      - ${TRANSCODE_HOST}:/transcode`,
    `      - ${UPGRADE_HOST}:/upgrade`,
    `      - ${MEDIA_HOST}:/media`,
    `      - ${ADULT_HOST}:/adult_media`,
    `      - ${ADULT_HOST}:/adult`,
    '    devices:',
    '      - /dev/dri:/dev/dri',
    '    restart: unless-stopped',
    '    stop_grace_period: 75s',
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
  const { tarball, apply, expectedSha256, helixCleanInit, freshResetConfig, capacityPlan, continueFreshReset,
    peopleRecoveryFile, continuePeopleRecovery, verifyOnly, runtimeResetConfig } = parseArgs(process.argv.slice(2));
  if (!tarball) {
    console.error('Usage: node scripts/deploy-nas.js <tarball-on-nas> [--sha256 <hash>] [--helix-clean-init] [--apply | --verify-only]');
    process.exit(2);
  }
  const targetImage = imageFromTarball(tarball);
  const secretRoot = loadOrCreateSecretRoot({ allowCreate: helixCleanInit });
  const configurationFile = freshResetConfig || runtimeResetConfig;
  const resetConfiguration = configurationFile ? require('./nas-reset-bootstrap').configurationForNas(JSON.parse(fs.readFileSync(configurationFile, 'utf8'))) : null;
  const peopleRecoveryScope = peopleRecoveryFile ? require('./nas-people-reference-recovery')
    .recoveryScope(JSON.parse(fs.readFileSync(peopleRecoveryFile, 'utf8'))) : null;
  const yaml = composeYaml(targetImage, resetConfiguration, { coldBootstrap: Boolean(freshResetConfig) && !peopleRecoveryScope });
  const expectedHealth = healthExpectation({ resetConfiguration, peopleRecoveryScope, runtimeResetConfig });
  const secretEnv = `SHELFDECK_SECRET_ROOT=${secretRoot}\n`;

  const steps = [
    ['Check image tarball', `ls -l ${shellQuote(tarball)}`],
    ...(expectedSha256
      ? [['Verify image tarball SHA-256', `[ "$(sha256sum ${shellQuote(tarball)} | awk '{print $1}')" = "${expectedSha256.toLowerCase()}" ]`]]
      : []),
    ['Assert media, upgrade, transcode, adult, catalogue package, and QSV hosts', [
      `test -d ${shellQuote(MEDIA_HOST)}`,
      `mkdir -p ${shellQuote(UPGRADE_HOST)} ${shellQuote(TRANSCODE_HOST)} ${shellQuote(DATA_DIR)}`,
      `test -d ${shellQuote(UPGRADE_HOST)}`,
      `test -d ${shellQuote(TRANSCODE_HOST)}`,
      `test -d ${shellQuote(ADULT_HOST)}`,
      `test -d ${shellQuote(US_ADULT_CATALOGUE_PACKAGE_HOST)}`,
      `test -f ${shellQuote(US_ADULT_CATALOGUE_PACKAGE_HOST + '/generation.json')}`,
      `test -f ${shellQuote(US_ADULT_CATALOGUE_PACKAGE_HOST + '/performers.db')}`,
      'test -e /dev/dri/renderD128',
    ].join(' && ')],
    ['Prepare dedicated operator backup volume', [
      'test "$(readlink -f /vol2/1000)" = /vol2/1000',
      `test ! -L ${shellQuote(OPERATOR_BACKUP_HOST)}`,
      `if [ ! -e ${shellQuote(OPERATOR_BACKUP_HOST)} ]; then mkdir -m 700 ${shellQuote(OPERATOR_BACKUP_HOST)}; fi`,
      `test "$(readlink -f ${shellQuote(OPERATOR_BACKUP_HOST)})" = ${shellQuote(OPERATOR_BACKUP_HOST)}`,
      `test -d ${shellQuote(OPERATOR_BACKUP_HOST)}`,
      `test ! -L ${shellQuote(DATA_DIR + '/operator-backups')}`,
      `if [ -e ${shellQuote(DATA_DIR + '/operator-backups')} ]; then test -d ${shellQuote(DATA_DIR + '/operator-backups')} && test -z "$(find ${shellQuote(DATA_DIR + '/operator-backups')} -mindepth 1 -maxdepth 1 -print -quit)" || { echo 'Existing in-data operator backups must be preserved and explicitly relocated before adding the backup mount.' >&2; exit 1; }; fi`,
    ].join(' && ')],
    ['Check compose file', `docker compose -f ${shellQuote(COMPOSE_FILE)} config >/dev/null`],
    ['Load image', `docker load -i ${shellQuote(tarball)}`],
    ['Install US Adult catalogue into ShelfDeck data', [
      'docker run --rm',
      `--env-file ${shellQuote(SECRET_FILE)}`,
      `-v ${shellQuote(`${DATA_DIR}:/app/data`)}`,
      `-v ${shellQuote(`${US_ADULT_CATALOGUE_PACKAGE_HOST}:/catalogue-package:ro`)}`,
      shellQuote(targetImage),
      'node scripts/install-us-adult-catalogue.js',
      '--source /catalogue-package',
      '--target /app/data/us-adult-catalogue',
      '--apply',
    ].join(' ')],
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
      : freshResetConfig ? [[peopleRecoveryScope ? 'Prepare cold People reference recovery' : 'Prepare cold Reset management',
        'Explicit stopped deployment proof and verified backup; no automatic Resume.']] : [['Helix runtime readiness', [
          'docker run --rm',
          `--env-file ${shellQuote(SECRET_FILE)}`,
          `-v ${shellQuote(`${DATA_DIR}:/run/shelfdeck-readiness-source:ro`)}`,
          shellQuote(targetImage),
          'sh -lc',
          shellQuote([
            'set -eu',
            `node -e ${shellQuote(fs.readFileSync(path.join(__dirname, '../media-service/scripts/create-readiness-snapshot.js'), 'utf8') + '\ncreateReadinessSnapshot("/run/shelfdeck-readiness-source", "/tmp/shelfdeck-readiness-data").catch(error => { console.error(error.code || error.message); process.exitCode = 1; });')}`,
            'readiness_output=$(node scripts/helix-clean-init.js --data-dir /tmp/shelfdeck-readiness-data --readiness)',
            'printf "%s\\n" "$readiness_output"',
            'printf "%s" "$readiness_output" | grep -q \'"state": "ready"\'',
          ].join(' && ')),
        ].join(' ')]]),
    ['Recreate through compose', `cd ${shellQuote(COMPOSE_DIR)} && docker compose up -d --force-recreate`],
    ['Wait for boot', 'sleep 8'],
    ['Verify health', [
      'for i in $(seq 1 180); do',
      'body=$(curl --max-time 5 -fsS http://127.0.0.1:18080/v1/health) || { sleep 5; continue; };',
      'echo "$body";',
      `printf "%s" "$body" | grep -q '${'"status":"' + expectedHealth.status + '"'}' && ` +
        (expectedHealth.stopped ? 'printf "%s" "$body" | grep -q \'"normalSupplyAllowed":false\' && ' : '') + 'exit 0;',
      'sleep 5;',
      'done;',
      'exit 1',
    ].join(' ')],
    ['Verify Admin Web', 'curl -fsS http://127.0.0.1:18080/admin | grep -q \'<div id="root"></div>\''],
    ['Verify media mount', `docker exec shelfdeck sh -lc 'test -d /media && test -d /upgrade && test -d /adult_media && test -d /adult && test "$(stat -c %d:%i /adult)" = "$(stat -c %d:%i /adult_media)" && test -e /dev/dri/renderD128'`],
    ['Verify US Adult catalogue installed', `docker exec shelfdeck sh -lc 'test -d /app/data/us-adult-catalogue && test -f /app/data/us-adult-catalogue/generation.json && test -f /app/data/us-adult-catalogue/performers.db && printenv SHELFDECK_US_ADULT_CATALOGUE_ROOT | grep -Fx /app/data/us-adult-catalogue && printenv SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH | grep -Fx /app/data/us-adult-catalogue/generation.json'`],
    ['Verify compose still binds required hosts', [
      `grep -F ${shellQuote(`${MEDIA_HOST}:/media`)} ${shellQuote(COMPOSE_FILE)}`,
      `grep -F ${shellQuote(`${UPGRADE_HOST}:/upgrade`)} ${shellQuote(COMPOSE_FILE)}`,
      `grep -F ${shellQuote(`${OPERATOR_BACKUP_HOST}:/app/data/operator-backups`)} ${shellQuote(COMPOSE_FILE)}`,
      `grep -Fx ${shellQuote(`      - ${ADULT_HOST}:/adult_media`)} ${shellQuote(COMPOSE_FILE)}`,
      `grep -Fx ${shellQuote(`      - ${ADULT_HOST}:/adult`)} ${shellQuote(COMPOSE_FILE)}`,
      `grep -F ${shellQuote('SHELFDECK_US_ADULT_CATALOGUE_ROOT=/app/data/us-adult-catalogue')} ${shellQuote(COMPOSE_FILE)}`,
      `grep -F ${shellQuote('SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH=/app/data/us-adult-catalogue/generation.json')} ${shellQuote(COMPOSE_FILE)}`,
      `! grep -E ${shellQuote('us-adult-catalogue:/us-adult-catalogue')} ${shellQuote(COMPOSE_FILE)}`,
      `grep -F '/dev/dri:/dev/dri' ${shellQuote(COMPOSE_FILE)}`,
    ].join(' && ')],
    ['Verify running image tag', `docker inspect shelfdeck --format "{{.Config.Image}}" | grep -Fx ${shellQuote(targetImage)}`],
    ['Verify code comes from image', 'docker inspect shelfdeck --format "{{json .Mounts}}" | grep -v "shelfdeck-releases"'],
  ];

  console.log(`ShelfDeck NAS deploy (${verifyOnly ? 'VERIFY ONLY' : apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`compose : ${COMPOSE_FILE}`);
  console.log(`tarball : ${tarball}`);
  console.log(`image   : ${targetImage}`);
  if (expectedSha256) console.log(`sha256 : ${expectedSha256.toLowerCase()}`);
  if (helixCleanInit) console.log('cutover: Helix clean initialization (INITIALIZE_HELIX_CLEAN_V1)');
  if (continueFreshReset) console.log('cutover: explicit cold continuation from the original closure and verified deployment backup');
  console.log(`data dir: ${DATA_DIR}`);
  console.log(`media   : ${MEDIA_HOST} -> /media`);
  console.log(`upgrade : ${UPGRADE_HOST} -> /upgrade`);
  console.log(`transcode: ${TRANSCODE_HOST} -> /transcode`);
  console.log(`backups : ${OPERATOR_BACKUP_HOST} -> /app/data/operator-backups`);
  console.log(`adult   : ${ADULT_HOST} -> /adult_media`);
  console.log(`adult   : ${ADULT_HOST} -> /adult`);
  console.log(`catalogue package (install input): ${US_ADULT_CATALOGUE_PACKAGE_HOST}`);
  console.log(`catalogue installed: ${DATA_DIR}/us-adult-catalogue -> ${US_ADULT_CATALOGUE_INSTALLED_CONTAINER}`);
  console.log('catalogue env: SHELFDECK_US_ADULT_CATALOGUE_ROOT=/app/data/us-adult-catalogue');
  console.log('capacity: /vol1 data plan must cover installed catalogue bytes');
  console.log('qsv     : /dev/dri -> /dev/dri');
  console.log('secret  : env_file secret.env (not printed)');

  if (!apply && !verifyOnly) {
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
    const execute = async command => {
      const result = await run(conn, command);
      if (result.code !== 0) throw new Error('Cold Reset deployment check failed: ' +
        ((result.errOut + '\n' + result.out).match(/\b(?:RESET|PEOPLE_RECOVERY)_[A-Z0-9_]+\b/g)?.join(', ') || `exit ${result.code}`));
      return result.out.replace(/^Could not chdir to home directory.*\r?\n/, '').trim();
    };
    if (resetConfiguration) {
      const plan = JSON.parse(fs.readFileSync(capacityPlan, 'utf8'));
      if (plan.schema !== 'shelfdeck.deployment-capacity@1' || !Array.isArray(plan.volumes) || plan.volumes.length !== 2 ||
          plan.volumes.map(row => row.path).sort().join(',') !== '/vol1,/vol2' ||
          plan.volumes.some(row => !/^[1-9][0-9]*$/.test(row.requiredAvailableBytes))) throw new Error('Explicit two-volume peak capacity plan is required.');
      // Check before the first production write, including Compose or secrets.
      for (const volume of plan.volumes) {
        const available = await execute(`df -B1 --output=avail -- ${shellQuote(volume.path)} | tail -n 1`);
        if (!/^[0-9]+$/.test(available) || BigInt(available) < BigInt(volume.requiredAvailableBytes)) throw new Error('Deployment peak capacity is insufficient.');
      }
    }
    async function publishConfiguration() {
      console.log('\n>>> Upload secret.env and canonical compose');
      await uploadText(conn, SECRET_FILE, secretEnv, 0o600);
      await uploadText(conn, COMPOSE_FILE, yaml, 0o644);
      if (resetConfiguration) await uploadText(conn, `${COMPOSE_DIR}/reset-config.json`, JSON.stringify(resetConfiguration), 0o600);
      const chmod = await run(conn, `chmod 600 ${shellQuote(SECRET_FILE)}`);
      if (chmod.code !== 0) throw new Error('Protecting secret.env failed');
    }
    if ((!resetConfiguration || runtimeResetConfig) && !verifyOnly) await publishConfiguration();

    for (const [label, cmd] of verifyOnly ? selectVerificationSteps(steps) : steps) {
      if (label === 'Prepare cold Reset management' || label === 'Prepare cold People reference recovery') {
        if (continueFreshReset || continuePeopleRecovery) {
          const expectedSecret = crypto.createHash('sha256').update(secretEnv).digest('hex');
          await execute(`[ "$(sha256sum ${shellQuote(SECRET_FILE)} | awk '{print $1}')" = ${shellQuote(expectedSecret)} ]`);
        }
        const prepareManagement = peopleRecoveryScope ? require('./nas-people-reference-recovery').prepareNasPeopleReferenceRecovery :
          require('./nas-reset-bootstrap')[continueFreshReset ? 'continueNasResetManagement' : 'prepareNasResetManagement'];
        const result = await prepareManagement({ execute,
          upload: (file, contents) => uploadText(conn, file, contents, 0o600), configuration: resetConfiguration,
          dataDir: DATA_DIR, transcodeDir: TRANSCODE_HOST, composeFile: COMPOSE_FILE,
          backupHost: OPERATOR_BACKUP_HOST, secretFile: SECRET_FILE, targetImage, publishConfiguration,
          ...(peopleRecoveryScope ? { recoveryScope: peopleRecoveryScope, continueRecovery: continuePeopleRecovery } : {}),
          async readRuntime() {
            const key = readEnvFile(LOCAL_ADMIN_KEY_FILE, 'SHELFDECK_ADMIN_API_KEY');
            if (!key) throw new Error('Admin API credential is required for the safe Stop proof.');
            const response = await fetch('http://192.168.12.230:18080/v1/admin/runtime', { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error('Runtime safe Stop proof is unavailable.');
            return response.json();
          } });
        console.log('Cold management closure proof:', result.closureDigest);
        continue;
      }
      const result = await execStep(conn, label, cmd);
      if (label === 'Helix clean initialization') persistAdminApiKey(result.out);
    }
  } finally {
    conn.end();
  }

  console.log(verifyOnly ? '\nRead-only deployment verification complete; no production changes.' : '\nDeploy complete.');
  if (!verifyOnly && fs.existsSync(LOCAL_ADMIN_KEY_FILE)) {
    console.log('Admin API key saved to tests/.env.nas-admin (gitignored).');
  }
}

if (require.main === module) main().catch((err) => {
  console.error(`\nDEPLOY BLOCKED: ${err.message}`);
  process.exit(1);
});
module.exports = Object.freeze({ parseArgs, composeYaml, healthExpectation, selectVerificationSteps });
