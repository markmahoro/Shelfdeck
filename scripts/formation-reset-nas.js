'use strict';

/**
 * Offline Formation Reset for the fnOS ShelfDeck production project.
 *
 * Usage:
 *   node scripts/formation-reset-nas.js --mode normal
 *   node scripts/formation-reset-nas.js --mode nuclear --apply --confirm FORMATION_RESET_NUCLEAR_V1
 *
 * Dry-run connects read-only to print the live plan. Apply stops only the ShelfDeck
 * Compose service, creates and verifies a full data backup, runs the reset with the
 * currently deployed image, restarts ShelfDeck, and verifies health.
 */

const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const DATA_DIR = `${COMPOSE_DIR}/data`;
const BACKUP_ROOT = `${COMPOSE_DIR}/backups`;
const TRANSCODE_HOST = '/vol2/1000/shelfdeck_transcode';
const SERVICE = 'shelfdeck';
const HEALTH_URL = 'http://127.0.0.1:18080/v1/health';
const CONFIRMATIONS = Object.freeze({ normal:'FORMATION_RESET_NORMAL_V1', nuclear:'FORMATION_RESET_NUCLEAR_V1' });

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseArgs(argv) {
  const parsed = { mode:'', apply:false, confirm:'' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') parsed.apply = true;
    else if (argument === '--mode') { parsed.mode = argv[index + 1] || ''; index += 1; }
    else if (argument.startsWith('--mode=')) parsed.mode = argument.slice('--mode='.length);
    else if (argument === '--confirm') { parsed.confirm = argv[index + 1] || ''; index += 1; }
    else if (argument.startsWith('--confirm=')) parsed.confirm = argument.slice('--confirm='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Object.hasOwn(CONFIRMATIONS, parsed.mode)) throw new Error('Mode must be normal or nuclear.');
  if (parsed.apply && parsed.confirm !== CONFIRMATIONS[parsed.mode]) {
    throw new Error(`Apply requires --confirm ${CONFIRMATIONS[parsed.mode]}`);
  }
  return Object.freeze(parsed);
}

function connect() {
  const connection = new Client();
  return new Promise((resolve, reject) => {
    connection.on('ready', () => resolve(connection));
    connection.on('error', reject);
    connection.connect(loadNasSshConfig({ readyTimeout:20000 }));
  });
}

function run(connection, command) {
  return new Promise((resolve, reject) => {
    let output = '', errorOutput = '';
    connection.exec(command, { pty:true }, (error, stream) => {
      if (error) return reject(error);
      stream.on('close', (code) => resolve({ code, output, errorOutput }));
      stream.on('data', (chunk) => { output += chunk.toString(); });
      stream.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    });
  });
}

async function step(connection, label, command) {
  process.stdout.write(`\n>>> ${label}\n`);
  const result = await run(connection, command);
  if (result.output) process.stdout.write(result.output);
  if (result.errorOutput) process.stderr.write(result.errorOutput);
  if (result.code !== 0) throw new Error(`${label} failed with exit code ${result.code}`);
  return result.output.trim();
}

function resetCommand(image, mode, apply) {
  const args = [
    'docker run --rm',
    `--env-file ${shellQuote(`${COMPOSE_DIR}/secret.env`)}`,
    `-v ${shellQuote(`${DATA_DIR}:/app/data`)}`,
    `-v ${shellQuote(`${TRANSCODE_HOST}:/transcode`)}`,
    shellQuote(image),
    'node scripts/helix-formation-reset.js',
    `--mode ${shellQuote(mode)}`,
    '--data-dir /app/data',
    '--transcode-dir /transcode',
  ];
  if (apply) args.push('--apply', '--offline-confirmed', '--confirm', shellQuote(CONFIRMATIONS[mode]));
  return args.join(' ');
}

function backupCommand(backupDir) {
  const backupData = `${backupDir}/data`;
  return [
    'set -eu',
    `case ${shellQuote(backupDir)} in ${shellQuote(`${BACKUP_ROOT}/formation-reset-`)}*) ;; *) echo 'unsafe backup path' >&2; exit 31 ;; esac`,
    `test -d ${shellQuote(COMPOSE_DIR)} && test ! -L ${shellQuote(COMPOSE_DIR)}`,
    `test -d ${shellQuote(DATA_DIR)} && test ! -L ${shellQuote(DATA_DIR)}`,
    `test -f ${shellQuote(`${DATA_DIR}/shelfdeck.db`)}`,
    `mkdir -p ${shellQuote(BACKUP_ROOT)}`,
    `test ! -e ${shellQuote(backupDir)}`,
    `mkdir ${shellQuote(backupDir)}`,
    `cp -a ${shellQuote(DATA_DIR)} ${shellQuote(backupData)}`,
    `test -s ${shellQuote(`${backupData}/shelfdeck.db`)}`,
    `[ "$(sha256sum ${shellQuote(`${DATA_DIR}/shelfdeck.db`)} | awk '{print $1}')" = "$(sha256sum ${shellQuote(`${backupData}/shelfdeck.db`)} | awk '{print $1}')" ]`,
  ].join(' && ');
}

function imageCommand() {
  return `cd ${shellQuote(COMPOSE_DIR)} && container_id="$(docker compose ps -q ${SERVICE})" && test -n "$container_id" && docker inspect --format '{{.Image}}' "$container_id"`;
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const connection = await connect();
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupDir = `${BACKUP_ROOT}/formation-reset-${timestamp}-${parsed.mode}`;
  let image = '';
  try {
    await step(connection, 'Verify ShelfDeck application paths', [
      `test ${shellQuote(COMPOSE_DIR)} = /vol1/1000/docker/shelfdeck`,
      `test -d ${shellQuote(COMPOSE_DIR)} && test ! -L ${shellQuote(COMPOSE_DIR)}`,
      `test -d ${shellQuote(DATA_DIR)} && test ! -L ${shellQuote(DATA_DIR)}`,
      `test -d ${shellQuote(TRANSCODE_HOST)} && test ! -L ${shellQuote(TRANSCODE_HOST)}`,
      `test -f ${shellQuote(`${DATA_DIR}/shelfdeck.db`)}`,
    ].join(' && '));
    image = await step(connection, 'Resolve the exact deployed image', imageCommand());
    if (!image || /\s/.test(image)) throw new Error('Deployed image identity is invalid.');
    process.stdout.write(`\nmode   : ${parsed.mode}\nimage  : ${image}\nbackup : ${backupDir}\n`);
    if (!parsed.apply) {
      await step(connection, 'Inspect live Formation Reset plan', resetCommand(image, parsed.mode, false));
      process.stdout.write(`\nDry run only. Apply with --apply --confirm ${CONFIRMATIONS[parsed.mode]}.\n`);
      return Object.freeze({ mode:parsed.mode, applied:false, image, backupDir });
    }
    await step(connection, 'Stop only the ShelfDeck service', `cd ${shellQuote(COMPOSE_DIR)} && docker compose stop ${SERVICE}`);
    await step(connection, 'Verify ShelfDeck is stopped', `cd ${shellQuote(COMPOSE_DIR)} && test -z "$(docker compose ps -q --status running ${SERVICE})"`);
    await step(connection, 'Create and verify the full data backup', backupCommand(backupDir));
    await step(connection, 'Inspect the offline Formation Reset plan', resetCommand(image, parsed.mode, false));
    await step(connection, `Apply ${parsed.mode} Formation Reset`, resetCommand(image, parsed.mode, true));
    await step(connection, 'Verify the reset is idempotent', resetCommand(image, parsed.mode, false));
    await step(connection, 'Start only the ShelfDeck service', `cd ${shellQuote(COMPOSE_DIR)} && docker compose up -d ${SERVICE}`);
    await step(connection, 'Verify ShelfDeck Compose status', `cd ${shellQuote(COMPOSE_DIR)} && test -n "$(docker compose ps -q --status running ${SERVICE})"`);
    await step(connection, 'Verify ShelfDeck health', `curl --fail --silent --show-error --retry 12 --retry-delay 5 ${shellQuote(HEALTH_URL)}`);
    process.stdout.write(`\nFormation Reset complete. Rollback data: ${backupDir}/data\n`);
    return Object.freeze({ mode:parsed.mode, applied:true, image, backupDir, healthUrl:HEALTH_URL });
  } catch (error) {
    if (parsed.apply) {
      process.stderr.write(`\nShelfDeck may remain stopped. Verified backup path (if created): ${backupDir}/data\n`);
    }
    throw error;
  } finally { connection.end(); }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`\nFORMATION RESET BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ BACKUP_ROOT, COMPOSE_DIR, CONFIRMATIONS, DATA_DIR, HEALTH_URL,
  SERVICE, TRANSCODE_HOST, backupCommand, imageCommand, main, parseArgs, resetCommand, shellQuote });
