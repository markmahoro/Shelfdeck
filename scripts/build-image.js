'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');

const IMAGE_NAME = 'markmahoro/shelfdeck';

function usage() {
  console.error('Usage: node scripts/build-image.js <tag> [--reuse-runtime <image> <source-commit> <image-id>]');
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

function consolidateRuntimeCopies(root, copies) {
  const groups = new Map();
  const output = [];
  for (const line of copies) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3 || parts[0] !== 'COPY' ||
        !fs.statSync(path.join(root, parts[1])).isFile() ||
        path.posix.basename(parts[1]) !== path.posix.basename(parts[2])) {
      output.push(line);
      continue;
    }
    const parent = path.posix.dirname(parts[2]);
    if (!groups.has(parent)) {
      groups.set(parent, []);
      output.push({ parent });
    }
    groups.get(parent).push(parts[1]);
  }
  return output.map(item => typeof item === 'string' ? item :
    `COPY ${groups.get(item.parent).join(' ')} ${item.parent}/`);
}

function consolidateCanonicalRecipe(root, recipe) {
  let runtime = false, pending = [];
  const result = [], flush = () => { result.push(...consolidateRuntimeCopies(root, pending)); pending = []; };
  for (const line of recipe.split(/\r?\n/)) {
    if (line === 'FROM service-base AS service-runtime') runtime = true;
    if (runtime && line.startsWith('COPY ') && !line.startsWith('COPY --from=')) pending.push(line);
    else { flush(); result.push(line); }
  }
  flush();
  return result.join('\n');
}

function assertExportableLayerCount(count) {
  // Leave headroom below overlay2's lower-directory limit, including the
  // container writable layer. Desktop's containerd store accepts deeper images.
  if (!Number.isInteger(count) || count < 1 || count > 96)
    throw new Error(`Production image has ${count} layers; the export budget is 96.`);
}

async function main(argv = process.argv.slice(2)) {
  const tag = String(argv[0] || '').trim();
  if (!tag || ![1,5].includes(argv.length) || (argv.length===5 && argv[1]!=='--reuse-runtime') || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(tag)) {
    usage();
    throw new Error('A single Docker-safe image tag is required.');
  }

  const root = path.resolve(__dirname, '..');
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (status.trim()) {
    throw new Error('Refusing to build a production image from a dirty worktree. Commit or remove every change first.');
  }
  const commit = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (tag.startsWith('helix-beta-') && !tag.endsWith(`-${commit}`)) {
    throw new Error(`Helix beta image tag must end with the exact git commit ${commit}.`);
  }
  const outputDir = path.join(root, 'dist-image');
  const tarPath = path.join(outputDir, `shelfdeck-${tag}.tar`);
  if (fs.existsSync(tarPath))
    throw new Error(
      `Refusing to reuse an existing production tarball: ${tarPath}`,
    );
  fs.mkdirSync(outputDir, { recursive: true });

  let dockerfile='media-service/Dockerfile';
  if(argv.length===5) {
    const [, ,image,sourceCommit,imageId]=argv;
    if(!/^markmahoro\/shelfdeck:helix-beta-\d{8}-[a-f0-9]{10}$/.test(image)||
        !/^[a-f0-9]{10,40}$/.test(sourceCommit)||!/^sha256:[a-f0-9]{64}$/.test(imageId))
      throw new Error('Runtime reuse requires an exact release image, source commit, and immutable image ID.');
    const source=execFileSync('git',['rev-parse','--short=10',sourceCommit],{cwd:root,encoding:'utf8'}).trim();
    if(!image.endsWith('-'+source))throw new Error('Runtime source commit does not match its release image.');
    const unchanged=execFileSync('git',['diff','--name-only',sourceCommit,'HEAD','--',
      'media-service/package.json','media-service/package-lock.json','media-service/web','media-service/Dockerfile'],{cwd:root,encoding:'utf8'});
    if(unchanged.trim())throw new Error('Runtime reuse is forbidden when dependencies, frontend, or runtime recipe changed.');
    const removed=execFileSync('git',['diff','--name-only','--diff-filter=D',sourceCommit,'HEAD','--',
      'media-service/src','media-service/scripts'],{cwd:root,encoding:'utf8'});
    if(removed.trim())throw new Error('Runtime reuse cannot retain deleted service files.');
    const actual=execFileSync('docker',['image','inspect',image,'--format','{{.Id}}'],{cwd:root,encoding:'utf8'}).trim();
    if(actual!==imageId)throw new Error('Runtime image identity changed.');
    const lock=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'media-service/package-lock.json'))).digest('hex');
    const observed=execFileSync('docker',['run','--rm','--network','none','--entrypoint','node',image,'-e',
      "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/package-lock.json')).digest('hex'))"],{cwd:root,encoding:'utf8'}).trim();
    if(observed!==lock)throw new Error('Runtime dependency lock does not match the source tree.');
    const recipe=fs.readFileSync(path.join(root,dockerfile),'utf8').split('FROM service-base AS service-runtime')[1];
    if(!recipe)throw new Error('Canonical runtime stage is missing.');
    const copies=recipe.split(/\r?\n/).filter(line=>line.startsWith('COPY ')&&!line.startsWith('COPY --from='));
    dockerfile=path.join(outputDir,'runtime-reuse.Dockerfile');
    // Preserve every canonical destination while avoiding a new layer for each
    // source file on an already layered, identity-verified runtime image.
    const consolidatedCopies=consolidateRuntimeCopies(root,copies);
    fs.writeFileSync(dockerfile,[`FROM ${image}`,'WORKDIR /app',...consolidatedCopies,
      `LABEL org.opencontainers.image.revision="${execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}"`,
      'ENTRYPOINT []','CMD ["node", "src/server.js"]',''].join('\n'));
    console.log(`==> Verified unchanged runtime ${image} (${imageId}); rebuilding all canonical service sources`);
  } else {
    const recipe = fs.readFileSync(path.join(root, dockerfile), 'utf8');
    dockerfile = path.join(outputDir, 'runtime.Dockerfile');
    fs.writeFileSync(dockerfile, consolidateCanonicalRecipe(root, recipe));
  }

  const taggedImage = `${IMAGE_NAME}:${tag}`;
  console.log(`==> Building ${taggedImage} (linux/amd64) from repository root`);
  await run(
    'docker',
    [
      'build',
      '--platform',
      'linux/amd64',
      '--label',
      `org.opencontainers.image.revision=${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}`,
      '-f',
      dockerfile,
      '-t',
      taggedImage,
      '-t',
      `${IMAGE_NAME}:latest`,
      '.',
    ],
    { cwd: root },
  );

  const layerCount = Number(execFileSync('docker', ['image', 'inspect', taggedImage, '--format', '{{len .RootFS.Layers}}'],
    { cwd: root, encoding: 'utf8' }).trim());
  assertExportableLayerCount(layerCount);
  console.log(`==> Runtime layer budget passed: ${layerCount}/96`);
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

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nBUILD FAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { consolidateRuntimeCopies, consolidateCanonicalRecipe, assertExportableLayerCount };
