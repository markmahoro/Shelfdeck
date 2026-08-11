'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  LIBRARY_ID,
  MANIFEST_SCHEMA,
  normalizedRoot,
  assertInside,
} = require('./build-helix-movie-test-library');

const CONTROL_DIRECTORY = '.shelfdeck-test-library';
const PHASES = Object.freeze({
  G04: Object.freeze({
    seedAsset:'seeds/G04-collision-target.mkv.seed',
    targetRelativePath:'SDT-G04-Collision (2008)/SDT-G04-Collision (2008).mkv',
    mode:'create_collision_target',
  }),
  G06: Object.freeze({
    seedAsset:'seeds/G06-poster-mutated.jpg.seed',
    targetRelativePath:'SDT-G06-Stale-Related (2008)/poster.jpg',
    mode:'replace_related_reality',
  }),
});

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseArguments(argv) {
  const options = { root:null, scenario:null, apply:false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = argv[++index];
    else if (argument === '--scenario') options.scenario = argv[++index];
    else if (argument === '--apply') options.apply = true;
    else throw new Error('Unknown argument: ' + argument);
  }
  if (!options.root || !options.scenario) throw new Error('--root and --scenario are required.');
  return options;
}

function loadManifest(root) {
  const manifestPath = path.join(root, CONTROL_DIRECTORY, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Movie test-library manifest is missing.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.libraryId !== LIBRARY_ID || path.resolve(manifest.root) !== root) {
    throw new Error('Movie test-library manifest is not the active recognized contract.');
  }
  return manifest;
}

function preparePhase(rootValue, scenarioId, apply = false) {
  const root = normalizedRoot(rootValue);
  const phase = PHASES[scenarioId];
  if (!phase) throw new Error('Scenario does not have a materialized phase helper: ' + scenarioId);
  const manifest = loadManifest(root);
  const scenario = manifest.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error('Scenario is absent from the active manifest: ' + scenarioId);
  const seed = assertInside(root, path.join(root, CONTROL_DIRECTORY, ...phase.seedAsset.split('/')));
  const target = assertInside(root, path.join(root, ...phase.targetRelativePath.split('/')));
  const seedContract = manifest.controlAssets.find((item) => item.relativePath === phase.seedAsset);
  if (!seedContract || !fs.existsSync(seed) || fs.statSync(seed).size !== Number(seedContract.sizeBytes) ||
      sha256File(seed) !== seedContract.sha256) {
    throw new Error('Phase seed does not match the active manifest: ' + phase.seedAsset);
  }
  const currentEntry = manifest.verification.entries.find((item) => item.relativePath === phase.targetRelativePath);
  const currentDigest = fs.existsSync(target) && fs.statSync(target).isFile() ? sha256File(target) : null;
  if (phase.mode === 'create_collision_target' && currentDigest && currentDigest !== seedContract.sha256) {
    throw new Error('Collision target already exists with an unexpected identity. Rebuild the library before retrying.');
  }
  if (phase.mode === 'replace_related_reality' && currentDigest && currentDigest !== seedContract.sha256 &&
      currentDigest !== currentEntry?.sha256) {
    throw new Error('Related mutation target is not at its manifest Reality. Rebuild the library before retrying.');
  }
  const replayed = currentDigest === seedContract.sha256;
  const result = { scenarioId, mode:phase.mode, root, seedAsset:phase.seedAsset,
    targetRelativePath:phase.targetRelativePath, expectedSeedDigest:seedContract.sha256, replayed };
  if (!apply || replayed) return Object.freeze({ action:apply ? 'applied' : 'dry_run', ...result });
  fs.mkdirSync(path.dirname(target), { recursive:true });
  fs.copyFileSync(seed, target, phase.mode === 'create_collision_target' ? fs.constants.COPYFILE_EXCL : 0);
  const committedDigest = sha256File(target);
  if (committedDigest !== seedContract.sha256) throw new Error('Phase target verification failed after materialization.');
  return Object.freeze({ action:'applied', ...result, replayed:false, committedDigest });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  console.log(JSON.stringify(preparePhase(options.root, options.scenario, options.apply), null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = Object.freeze({ PHASES, preparePhase, main });
