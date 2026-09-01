'use strict';

/**
 * Pre-deck pipeline migration + Formation Reset + standard NAS upgrade (no --helix-clean-init).
 *
 * Usage:
 *   node scripts/predeck-pipeline-upgrade-nas.js <local-tar-path> --sha256 <hash> [--apply]
 */

const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const DATA_DIR = `${COMPOSE_DIR}/data`;
const TRANSCODE_HOST = '/vol2/1000/shelfdeck_transcode';
const MIGRATION_CONFIRM = 'PREDECK_PIPELINE_MIGRATION_V1';
const RESET_CONFIRM = 'FORMATION_RESET_V2';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function imageFromTarball(tarball) {
  const base = path.basename(String(tarball || ''));
  const match = base.match(/^shelfdeck-(.+)\.tar$/);
  if (!match || !match[1]) throw new Error('Tarball must be named shelfdeck-<tag>.tar');
  return `markmahoro/shelfdeck:${match[1]}`;
}

function parseArgs(argv) {
  const parsed = { localTar: '', remoteTar: '', apply: false, expectedSha256: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--sha256') {
      parsed.expectedSha256 = argv[i + 1] || '';
      i += 1;
    } else if (arg.startsWith('--sha256=')) parsed.expectedSha256 = arg.slice('--sha256='.length);
    else if (!parsed.localTar) parsed.localTar = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.localTar) throw new Error('Local tarball path is required.');
  parsed.remoteTar = `${COMPOSE_DIR}/${path.basename(parsed.localTar)}`;
  if (parsed.expectedSha256 && !/^[a-f0-9]{64}$/i.test(parsed.expectedSha256)) {
    throw new Error('Expected SHA-256 must be a 64-character hex string.');
  }
  return parsed;
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

async function execStep(conn, label, cmd) {
  console.log(`\n>>> ${label}`);
  const { code, out, errOut } = await run(conn, cmd);
  if (out) process.stdout.write(out);
  if (errOut) process.stderr.write(errOut);
  if (code !== 0) throw new Error(`${label} failed with exit code ${code}`);
  return { out, errOut };
}

function dockerRun(image, secretFile, script, extraArgs) {
  return [
    'docker run --rm',
    `--env-file ${shellQuote(secretFile)}`,
    `-v ${shellQuote(`${DATA_DIR}:/app/data`)}`,
    `-v ${shellQuote(`${TRANSCODE_HOST}:/transcode`)}`,
    shellQuote(image),
    `node scripts/${script}`,
    '--data-dir /app/data',
    '--transcode-dir /transcode',
    ...extraArgs,
  ].join(' ');
}

function runStandardDeploy(remoteTar, expectedSha256, apply) {
  const deploy = path.join(__dirname, 'deploy-nas.js');
  const deployArgs = [deploy, remoteTar];
  if (expectedSha256) deployArgs.push('--sha256', expectedSha256);
  if (apply) deployArgs.push('--apply');
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, deployArgs, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`deploy-nas.js exited ${code}`))));
  });
}

async function main() {
  const { localTar, remoteTar, apply, expectedSha256 } = parseArgs(process.argv.slice(2));
  const targetImage = imageFromTarball(remoteTar);
  const secretFile = `${COMPOSE_DIR}/secret.env`;
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupDir = `${COMPOSE_DIR}/data.backup-${timestamp}-predeck-pipeline`;

  console.log(`Pre-deck pipeline upgrade (${apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`image   : ${targetImage}`);
  console.log(`tarball : ${remoteTar}`);
  console.log(`backup  : ${backupDir}`);

  const steps = [
    ['Verify remote tarball', `test -f ${shellQuote(remoteTar)}`],
    ...(expectedSha256
      ? [['Verify tarball SHA-256', `[ "$(sha256sum ${shellQuote(remoteTar)} | awk '{print $1}')" = "${expectedSha256.toLowerCase()}" ]`]]
      : []),
    ['Stop shelfdeck', `cd ${shellQuote(COMPOSE_DIR)} && docker compose stop shelfdeck`],
    ['Backup data directory', `test ! -e ${shellQuote(backupDir)} && cp -a ${shellQuote(DATA_DIR)} ${shellQuote(backupDir)} && test -s ${shellQuote(`${backupDir}/shelfdeck.db`)} && [ "$(sha256sum ${shellQuote(`${DATA_DIR}/shelfdeck.db`)} | awk '{print $1}')" = "$(sha256sum ${shellQuote(`${backupDir}/shelfdeck.db`)} | awk '{print $1}')" ]`],
    ['Load target image', `docker load -i ${shellQuote(remoteTar)}`],
    ['Plan Pre-deck pipeline migration', dockerRun(targetImage, secretFile, 'helix-predeck-pipeline-migration.js', ['--plan'])],
    ['Apply Pre-deck pipeline migration', dockerRun(targetImage, secretFile, 'helix-predeck-pipeline-migration.js', [
      '--apply', '--confirm', MIGRATION_CONFIRM,
    ])],
    ['Plan Formation Reset', dockerRun(targetImage, secretFile, 'helix-formation-reset.js', [])],
    ['Apply Formation Reset', dockerRun(targetImage, secretFile, 'helix-formation-reset.js', [
      '--apply', '--offline-confirmed', '--confirm', RESET_CONFIRM,
    ])],
  ];

  if (!apply) {
    for (const [label, cmd] of steps) console.log(`\n${label}\n  ${cmd}`);
    console.log('\nDry run only. Upload tarball, then re-run with --apply.');
    console.log(`Then: node scripts/deploy-nas.js ${remoteTar} --sha256 ${expectedSha256 || '<hash>'} --apply`);
    return;
  }

  if (!fs.existsSync(localTar)) throw new Error(`Local tarball missing: ${localTar}`);
  console.log('\n>>> Standard deploy preflight (dry run)');
  await runStandardDeploy(remoteTar, expectedSha256, false);
  const conn = await connect();
  try {
    for (const [label, cmd] of steps) {
      await execStep(conn, label, cmd);
    }
  } finally {
    conn.end();
  }

  console.log('\n>>> Standard deploy (no --helix-clean-init)');
  await runStandardDeploy(remoteTar, expectedSha256, true);
  console.log('\nPre-deck pipeline upgrade complete.');
}

main().catch((err) => {
  console.error(`\nPREDECK PIPELINE UPGRADE BLOCKED: ${err.message}`);
  process.exit(1);
});
