'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IMAGE_NAME = 'markmahoro/shelfdeck';

function usage() {
  console.error('Usage: node scripts/build-image.js <tag>');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function humanBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function main(argv = process.argv.slice(2)) {
  const tag = String(argv[0] || '').trim();
  if (!tag || argv.length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(tag)) {
    usage();
    throw new Error('A single Docker-safe image tag is required.');
  }

  const root = path.resolve(__dirname, '..');
  const outputDir = path.join(root, 'dist-image');
  const tarPath = path.join(outputDir, `shelfdeck-${tag}.tar`);
  if (fs.existsSync(tarPath))
    throw new Error(
      `Refusing to reuse an existing production tarball: ${tarPath}`,
    );
  fs.mkdirSync(outputDir, { recursive: true });

  const taggedImage = `${IMAGE_NAME}:${tag}`;
  console.log(`==> Building ${taggedImage} (linux/amd64) from repository root`);
  await run(
    'docker',
    [
      'build',
      '--platform',
      'linux/amd64',
      '-f',
      'media-service/Dockerfile',
      '-t',
      taggedImage,
      '-t',
      `${IMAGE_NAME}:latest`,
      '.',
    ],
    { cwd: root },
  );

  console.log(`==> Exporting image to ${tarPath}`);
  await run(
    'docker',
    ['save', '-o', tarPath, taggedImage, `${IMAGE_NAME}:latest`],
    { cwd: root },
  );
  const stat = fs.statSync(tarPath);
  const sha256 = await sha256File(tarPath);
  console.log(`==> Done. Image tar: ${tarPath} (${humanBytes(stat.size)})`);
  console.log(`    SHA-256: ${sha256}`);
  console.log(`    Next: node scripts/upload-nas-image.js ${tarPath}`);
}

main().catch((error) => {
  console.error(`\nBUILD FAILED: ${error.message}`);
  process.exit(1);
});
