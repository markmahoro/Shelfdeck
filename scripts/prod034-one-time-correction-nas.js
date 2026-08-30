'use strict';

/**
 * PROD-034 bounded one-time data correction plus standard NAS deployment.
 *
 * Usage:
 *   node scripts/prod034-one-time-correction-nas.js <local-tar-path> --sha256 <hash> [--apply]
 */

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const COMPOSE_DIR = '/vol1/1000/docker/shelfdeck';
const DATA_DIR = `${COMPOSE_DIR}/data`;
const CONFIRMATION = 'PROD034_RELEASE_ABORTED_HANDOFFS_V1';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseArgs(argv) {
  const parsed = { localTar:'', apply:false, expectedSha256:'' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') parsed.apply = true;
    else if (argument === '--sha256') { parsed.expectedSha256 = argv[index + 1] || ''; index += 1; }
    else if (argument.startsWith('--sha256=')) parsed.expectedSha256 = argument.slice('--sha256='.length);
    else if (!parsed.localTar) parsed.localTar = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!parsed.localTar) throw new Error('Local tarball path is required.');
  if (!/^[a-f0-9]{64}$/i.test(parsed.expectedSha256)) throw new Error('A 64-character SHA-256 is required.');
  parsed.remoteTar = `${COMPOSE_DIR}/${path.basename(parsed.localTar)}`;
  const match = path.basename(parsed.localTar).match(/^shelfdeck-(.+)\.tar$/);
  if (!match?.[1]) throw new Error('Tarball must be named shelfdeck-<tag>.tar');
  parsed.image = `markmahoro/shelfdeck:${match[1]}`;
  return parsed;
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
    let output = '';
    let errorOutput = '';
    connection.exec(command, { pty:true }, (error, stream) => {
      if (error) return reject(error);
      stream.on('close', (code) => resolve({ code, output, errorOutput }));
      stream.on('data', (chunk) => { output += chunk.toString(); });
      stream.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    });
  });
}

async function step(connection, label, command) {
  console.log(`\n>>> ${label}`);
  const result = await run(connection, command);
  if (result.output) process.stdout.write(result.output);
  if (result.errorOutput) process.stderr.write(result.errorOutput);
  if (result.code !== 0) throw new Error(`${label} failed with exit code ${result.code}`);
}

function correctionCommand(image, args) {
  return [
    'docker run --rm',
    `--env-file ${shellQuote(`${COMPOSE_DIR}/secret.env`)}`,
    `-v ${shellQuote(`${DATA_DIR}:/app/data`)}`,
    shellQuote(image),
    'node scripts/helix-prod034-one-time-correction.js',
    '--data-dir /app/data',
    ...args,
  ].join(' ');
}

function standardDeploy(remoteTar, sha256, apply) {
  const args = [path.join(__dirname, 'deploy-nas.js'), remoteTar, '--sha256', sha256];
  if (apply) args.push('--apply');
  return new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(process.execPath, args, {
      cwd:path.join(__dirname, '..'), stdio:'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`deploy-nas.js exited ${code}`)));
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupDir = `${COMPOSE_DIR}/data.backup-${timestamp}-prod034-one-time-correction`;
  const commands = [
    ['Verify remote tarball', `test -f ${shellQuote(parsed.remoteTar)}`],
    ['Verify tarball SHA-256', `[ "$(sha256sum ${shellQuote(parsed.remoteTar)} | awk '{print $1}')" = "${parsed.expectedSha256.toLowerCase()}" ]`],
    ['Stop shelfdeck', `cd ${shellQuote(COMPOSE_DIR)} && docker compose stop shelfdeck`],
    ['Backup data directory', `test ! -e ${shellQuote(backupDir)} && cp -a ${shellQuote(DATA_DIR)} ${shellQuote(backupDir)} && test -s ${shellQuote(`${backupDir}/shelfdeck.db`)} && [ "$(sha256sum ${shellQuote(`${DATA_DIR}/shelfdeck.db`)} | awk '{print $1}')" = "$(sha256sum ${shellQuote(`${backupDir}/shelfdeck.db`)} | awk '{print $1}')" ]`],
    ['Load target image', `docker load -i ${shellQuote(parsed.remoteTar)}`],
    ['Plan one-time correction', correctionCommand(parsed.image, ['--plan'])],
    ['Apply one-time correction', correctionCommand(parsed.image, ['--apply', '--confirm', CONFIRMATION])],
    ['Verify one-time correction', correctionCommand(parsed.image, ['--plan'])],
  ];

  console.log(`PROD-034 one-time correction (${parsed.apply ? 'APPLY' : 'DRY RUN'})`);
  console.log(`image  : ${parsed.image}`);
  console.log(`backup : ${backupDir}`);
  if (!parsed.apply) {
    for (const [label, command] of commands) console.log(`\n${label}\n  ${command}`);
    console.log('\nDry run only. Upload the tarball, then re-run with --apply.');
    return;
  }
  if (!fs.existsSync(parsed.localTar)) throw new Error('Local tarball is missing.');
  console.log('\n>>> Standard deployment preflight');
  await standardDeploy(parsed.remoteTar, parsed.expectedSha256, false);
  const connection = await connect();
  try {
    for (const [label, command] of commands) await step(connection, label, command);
  } finally { connection.end(); }
  console.log('\n>>> Standard deployment');
  await standardDeploy(parsed.remoteTar, parsed.expectedSha256, true);
}

main().catch((error) => {
  console.error(`\nPROD-034 ONE-TIME CORRECTION BLOCKED: ${error.message}`);
  process.exitCode = 1;
});
