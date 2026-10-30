'use strict';

const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const SOURCE = '906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a';
const TARGET = '572bd48d999c83c86ffd5c2ccc496e7177b14df2edfd09ebcffadf56e2706cb9';
function assert(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
function regular(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.resolve(fs.realpathSync(file)) === path.resolve(file), 'CUTOVER_FILE_UNSAFE');
  return stat;
}
async function hash(file) {
  const before = regular(file), digest = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  const after = regular(file);
  assert(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'CUTOVER_FILE_CHANGED');
  return digest.digest('hex');
}
function syncDirectory(directory) {
  if (process.platform !== 'linux') return;
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// The deployment wrapper must stop the sole service before invoking this offline
// operator. Both preparation and the complete cold backup remain beside data.
async function publishPreparedDatabase({ Database, dataDir, preparedDir, apply = false, afterRename }) {
  dataDir = path.resolve(dataDir);
  preparedDir = path.resolve(preparedDir);
  for (const dir of [dataDir, preparedDir])
    assert(path.resolve(fs.realpathSync(dir)) === dir && !fs.lstatSync(dir).isSymbolicLink(), 'CUTOVER_DIRECTORY_UNSAFE');
  assert(dataDir !== preparedDir, 'CUTOVER_DIRECTORY_CONFLICT');
  const target = path.join(dataDir, 'shelfdeck.db');
  const prepared = path.join(preparedDir, 'prepared.sqlite');
  const source = path.join(preparedDir, 'source.sqlite');
  const markerPath = path.join(preparedDir, 'cutover.json');
  const schema = file => {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT schema_digest FROM platform_schema_marker').get()?.schema_digest; }
    finally { db.close(); }
  };
  const marker = value => {
    const temporary = markerPath + '.next';
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, markerPath);
    syncDirectory(preparedDir);
  };
  const receipt = JSON.parse(fs.readFileSync(path.join(preparedDir, 'copy-receipt.json')));
  const rollback = JSON.parse(fs.readFileSync(path.join(preparedDir, 'rollback-receipt.json')));
  assert(receipt.prepared === true && receipt.applied === false && receipt.rollback === false &&
    receipt.copiedTableCount === 238 && receipt.tableProofs.length === 238 &&
    rollback.prepared === true && rollback.rollback === true && rollback.copiedTableCount === 238, 'CUTOVER_COPY_UNQUALIFIED');
  assert(receipt.source.schemaDigest === SOURCE && receipt.target.schemaDigest === TARGET &&
    rollback.source.schemaDigest === TARGET && rollback.target.schemaDigest === SOURCE, 'CUTOVER_SCHEMA_PROOF_MISMATCH');
  assert(JSON.stringify(receipt.tableProofs) === JSON.stringify(rollback.tableProofs), 'CUTOVER_ROLLBACK_FACTS_CHANGED');
  const sourceFiles = JSON.parse(fs.readFileSync(path.join(preparedDir, 'source-files.json')));
  assert(sourceFiles.schema === 'shelfdeck.frozen-sqlite-files@1' && sourceFiles.files.length >= 1 && sourceFiles.files.length <= 4, 'CUTOVER_INPUT_PROOF_INVALID');
  const allowed = ['shelfdeck.db', 'shelfdeck.db-wal', 'shelfdeck.db-shm', 'shelfdeck.db-journal'];
  assert(sourceFiles.files[0].name === 'shelfdeck.db' && new Set(sourceFiles.files.map(v => v.name)).size === sourceFiles.files.length &&
    sourceFiles.files.every(v => allowed.includes(v.name) && /^[a-f0-9]{64}$/.test(v.sha256)), 'CUTOVER_INPUT_PROOF_INVALID');
  const sourceFilesDigest = crypto.createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex');
  const originalHash = await hash(source);
  const existing = fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath)) : null;
  assert(sourceFiles.snapshotSha256 === originalHash, 'CUTOVER_SNAPSHOT_PROOF_CHANGED');
  assert(regular(target).dev === regular(source).dev, 'CUTOVER_VOLUME_MISMATCH');
  if (existing && await hash(target) === existing.targetHash && schema(target) === TARGET) {
    assert(existing.sourceHash === originalHash && existing.sourceFilesDigest === sourceFilesDigest &&
      existing.sourceSchema === SOURCE && existing.targetSchema === TARGET, 'CUTOVER_MARKER_CONFLICT');
    if (apply) marker({ ...existing, state: 'installed', recoveredAt: new Date().toISOString() });
    return { installed: true, recovered: apply, applied: apply, targetHash: existing.targetHash };
  }
  assert(!existing || existing.sourceHash === originalHash && existing.sourceFilesDigest === sourceFilesDigest, 'CUTOVER_MARKER_CONFLICT');
  for (const name of allowed) {
    const expected = sourceFiles.files.find(v => v.name === name);
    const live = path.join(dataDir, name);
    const retained = path.join(preparedDir, 'retained-source' + name.slice('shelfdeck.db'.length));
    const moved = name !== 'shelfdeck.db' && fs.existsSync(retained);
    assert(!moved || existing && existing.sourceFilesDigest === sourceFilesDigest && !fs.existsSync(live), 'CUTOVER_RETAINED_FILE_CONFLICT');
    const file = moved ? retained : live;
    assert(Boolean(expected) === fs.existsSync(file), 'CUTOVER_SOURCE_FILE_SET_DRIFT');
    if (expected) assert(regular(file).size === expected.bytes && await hash(file) === expected.sha256, 'CUTOVER_SOURCE_DRIFT');
  }
  assert(schema(source) === SOURCE, 'CUTOVER_SOURCE_SCHEMA_INVALID');
  assert(regular(prepared).dev === regular(target).dev && schema(prepared) === TARGET, 'CUTOVER_TARGET_INVALID');
  const targetHash = await hash(prepared);
  assert(!existing || existing.targetHash === targetHash, 'CUTOVER_TARGET_DRIFT');
  // Frozen WAL bytes are preserved beside the prepared copy, never discarded.
  const plan = {
    schema: 'shelfdeck.us-adult-catalogue-database-cutover@1',
    sourceHash: originalHash,
    sourceFilesDigest,
    targetHash,
    sourceSchema: SOURCE,
    targetSchema: TARGET,
    state: 'qualified',
    at: new Date().toISOString(),
  };
  if (!apply) return { ...plan, applied: false };
  marker(plan);
  for (const suffix of ['-wal', '-shm', '-journal']) if (fs.existsSync(target + suffix)) {
    regular(target + suffix);
    const retained = path.join(preparedDir, 'retained-source' + suffix);
    assert(!fs.existsSync(retained), 'CUTOVER_RETAINED_FILE_CONFLICT');
    fs.renameSync(target + suffix, retained);
  }
  syncDirectory(dataDir);
  syncDirectory(preparedDir);
  const previous = regular(target);
  fs.chmodSync(prepared, previous.mode & 0o777);
  if (process.platform === 'linux' && (regular(prepared).uid !== previous.uid || regular(prepared).gid !== previous.gid))
    fs.chownSync(prepared, previous.uid, previous.gid);
  fs.renameSync(prepared, target);
  syncDirectory(dataDir);
  syncDirectory(preparedDir);
  afterRename?.();
  assert(await hash(target) === targetHash && schema(target) === TARGET, 'CUTOVER_PUBLISHED_BYTES_CHANGED');
  marker({ ...plan, state: 'installed', installedAt: new Date().toISOString() });
  return { installed: true, applied: true, targetHash, sourceRetained: true, schemaDigest: TARGET };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (![2, 3].includes(args.length) || args.length === 3 && args[2] !== '--apply')
    throw Error('Usage: us-adult-catalogue-schema-cutover.js <data-dir> <prepared-dir> [--apply]');
  const serviceRoot = process.env.SHELFDECK_SERVICE_ROOT || path.resolve(__dirname, '../media-service');
  const Database = require('node:module').createRequire(path.join(serviceRoot, 'package.json'))('better-sqlite3');
  publishPreparedDatabase({ Database, dataDir: args[0], preparedDir: args[1], apply: args[2] === '--apply' })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ code: error.code || error.message })); process.exitCode = 1; });
}
module.exports = { publishPreparedDatabase };
