'use strict';

// Offline operator tool for exact, unreferenced NFO/poster placement conflicts.
// SQLite and accepted product files are read-only; originals remain recoverable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const CONFIRMATION = 'QUARANTINE_EXACT_STAGE_CONFLICTS';
const SCHEMA = 'shelfdeck.stage-conflict-quarantine@1';
function fail(code) { const error=new Error(code); error.code=code; throw error; }
function contained(root, target) {
  const relative=path.relative(root,target);
  return relative && relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);
}
function checkedPath(root, target, allowMissing=false) {
  const base=path.resolve(root), resolved=path.resolve(target);
  if (!contained(base,resolved) || fs.lstatSync(base).isSymbolicLink() || fs.realpathSync(base)!==base) fail('QUARANTINE_PATH_OUTSIDE_ROOT');
  let cursor=base;
  for (const part of path.relative(base,resolved).split(path.sep)) {
    cursor=path.join(cursor,part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) fail('QUARANTINE_SYMLINK_REFUSED'); }
    catch(error) { if (allowMissing && error.code==='ENOENT') break; throw error; }
  }
  return resolved;
}
function fingerprint(file) {
  const before=fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size>16*1024*1024) fail('QUARANTINE_NOT_BOUNDED_SIDECAR');
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const after=fs.lstatSync(file);
  if (before.ino!==after.ino || before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs) fail('QUARANTINE_FILE_CHANGED');
  return { sizeBytes:after.size, sha256, inode:String(after.ino), device:String(after.dev), mtimeMs:after.mtimeMs, ctimeMs:after.ctimeMs };
}
function matches(observed, expected) { return observed.sizeBytes===expected.sizeBytes && observed.sha256===expected.sha256; }
function validateManifest(value) {
  if (value?.schema!==SCHEMA || typeof value.onDeckRunId!=='string' || !/^[a-zA-Z0-9_-]+$/.test(value.onDeckRunId) ||
      !Array.isArray(value.targets) || value.targets.length<1 || value.targets.length>8 ||
      value.targets.some(item=>!item || typeof item.path!=='string' || !path.isAbsolute(item.path) ||
        !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes<1 || !/^[0-9a-f]{64}$/.test(item.sha256||'')) ||
      new Set(value.targets.map(item=>path.resolve(item.path))).size!==value.targets.length) fail('QUARANTINE_MANIFEST_INVALID');
}
function assertUnreferenced(database, file, observed) {
  const collate=process.platform==='win32'?' COLLATE NOCASE':'';
  for (const [table,predicate] of [['arca_inventory_materials','active_guard=1'],['arca_material_bindings','current=1'],['libra_material_bindings','current=1']]) {
    if (database.prepare(`SELECT 1 FROM ${table} WHERE ${predicate} AND (location=?${collate} OR (CAST(inode AS TEXT)=? AND size_bytes=?)) LIMIT 1`)
      .get(file,observed.inode,observed.sizeBytes)) fail('QUARANTINE_REFERENCED_FILE');
  }
  for (const table of ['libra_offload_context_materials','libra_product_package_materials']) {
    if (database.prepare(`SELECT 1 FROM ${table} WHERE location=?${collate} LIMIT 1`).get(file)) fail('QUARANTINE_REFERENCED_FILE');
  }
}
function inspectQuarantine({ database, manifest, mediaRoot, applicationRoot }) {
  validateManifest(manifest);
  const run=database.prepare(`SELECT r.state,c.on_deck_package_id FROM arca_ondeck_runs r
    JOIN arca_ondeck_custodies c USING(custody_id) WHERE r.on_deck_run_id=?`).get(manifest.onDeckRunId);
  if (!run || run.state!=='blocked' || database.prepare('SELECT 1 FROM arca_ondeck_commit_receipts WHERE on_deck_run_id=?').get(manifest.onDeckRunId)) fail('QUARANTINE_RUN_NOT_BLOCKED');
  if (database.prepare("SELECT 1 FROM fx_supporting_works WHERE owner_domain='arca' AND process_id=? AND state NOT IN ('failed','cancelled','succeeded') LIMIT 1")
    .get(manifest.onDeckRunId)) fail('QUARANTINE_ACTIVE_EXECUTION');
  const decision=database.prepare('SELECT decision_json FROM arca_final_inventory_decisions WHERE on_deck_run_id=?').get(manifest.onDeckRunId);
  const members=JSON.parse(decision?.decision_json||'null')?.members;
  if (!Array.isArray(members)) fail('QUARANTINE_FINAL_DECISION_MISSING');
  const manifestDigest=canonicalDigest(manifest);
  const backupDirectory=checkedPath(applicationRoot,path.join(applicationRoot,'backups','stage-conflict-'+manifestDigest),true);
  if (path.resolve(mediaRoot)===path.resolve(applicationRoot) || contained(path.resolve(mediaRoot),backupDirectory) ||
      contained(backupDirectory,path.resolve(mediaRoot))) fail('QUARANTINE_BACKUP_OVERLAPS_MEDIA');
  const targets=manifest.targets.map((expected,index)=>{
    const file=checkedPath(mediaRoot,expected.path);
    const member=members.find(item=>path.resolve(item.targetLocation)===file);
    if (!member || !['metadata_sidecar','poster'].includes(member.role)) fail('QUARANTINE_NOT_DECLARED_SIDECAR_TARGET');
    const product=database.prepare('SELECT role,size_bytes FROM libra_product_package_materials WHERE on_deck_package_id=? AND material_key=?')
      .get(run.on_deck_package_id,member.sourceMaterialKey);
    if (!product || product.role!==member.role) fail('QUARANTINE_PRODUCT_LINK_MISMATCH');
    const observed=fingerprint(file);
    if (!matches(observed,expected)) fail('QUARANTINE_EXPECTED_IDENTITY_CHANGED');
    // This operator intentionally handles the proven size-different conflicts only.
    if (observed.sizeBytes===product.size_bytes) fail('QUARANTINE_CONFLICT_NOT_PROVEN');
    assertUnreferenced(database,file,observed);
    return { ...expected, path:file, role:member.role, observed,
      backupPath:path.join(backupDirectory,String(index)+'-'+path.basename(file)),
      parkedPath:file+'.shelfdeck-quarantine-'+manifestDigest.slice(0,20) };
  });
  return { schema:SCHEMA, onDeckRunId:manifest.onDeckRunId, manifestDigest, backupDirectory, targets };
}
function syncFile(file) { const fd=fs.openSync(file,'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function syncDirectory(directory) {
  if (process.platform !== 'linux') return;
  const fd=fs.openSync(directory,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function saveJournal(file, value) {
  const temporary=file+'.new';
  fs.writeFileSync(temporary,JSON.stringify(value,null,2),{flag:'wx'}); syncFile(temporary); fs.renameSync(temporary,file);
  syncDirectory(path.dirname(file));
}
function applyQuarantine(options) {
  if (options.offlineConfirmed!==true || options.confirm!==CONFIRMATION) fail('QUARANTINE_OFFLINE_CONFIRMATION_REQUIRED');
  const plan=inspectQuarantine(options);
  checkedPath(options.applicationRoot,plan.backupDirectory,true);
  if (fs.existsSync(plan.backupDirectory)) fail('QUARANTINE_BACKUP_ALREADY_EXISTS_REVIEW_JOURNAL');
  fs.mkdirSync(plan.backupDirectory,{recursive:true});
  syncDirectory(path.dirname(plan.backupDirectory));
  const journalPath=path.join(plan.backupDirectory,'manifest.json');
  const journal={ ...plan, state:'preparing', isolatedPaths:[] };
  saveJournal(journalPath,journal);
  try {
    // Back up and verify the whole approved set before moving any original.
    for (const item of plan.targets) {
      checkedPath(options.mediaRoot,item.path);
      if (!matches(fingerprint(item.path),item)) fail('QUARANTINE_EXPECTED_IDENTITY_CHANGED');
      fs.copyFileSync(item.path,item.backupPath,fs.constants.COPYFILE_EXCL); syncFile(item.backupPath);
      if (!matches(fingerprint(item.backupPath),item)) fail('QUARANTINE_BACKUP_MISMATCH');
    }
    journal.state='backed_up'; saveJournal(journalPath,journal);
    for (const item of plan.targets) {
      inspectQuarantine({ ...options, manifest:{ ...options.manifest,targets:[{path:item.path,sizeBytes:item.sizeBytes,sha256:item.sha256}] } });
      if (fs.existsSync(item.parkedPath)) fail('QUARANTINE_PARKED_PATH_OCCUPIED');
      fs.renameSync(item.path,item.parkedPath);
      if (!matches(fingerprint(item.parkedPath),item)) fail('QUARANTINE_RENAMED_IDENTITY_CHANGED');
      fs.unlinkSync(item.parkedPath);
      syncDirectory(path.dirname(item.path));
      journal.isolatedPaths.push(item.path); saveJournal(journalPath,journal);
      options.afterIsolatedFile?.(item);
    }
    journal.state='completed'; saveJournal(journalPath,journal);
    return { ...plan, state:'completed', journalPath };
  } catch (error) {
    const restoreFailures=[];
    for (const item of plan.targets) {
      try {
        checkedPath(options.mediaRoot,item.path,true);
        checkedPath(options.mediaRoot,item.parkedPath,true);
        checkedPath(options.applicationRoot,item.backupPath,true);
        if (fs.existsSync(item.path)) {
          if (!matches(fingerprint(item.path),item)) fail('QUARANTINE_RESTORE_TARGET_OCCUPIED');
          continue;
        }
        if (fs.existsSync(item.parkedPath)) {
          if (!matches(fingerprint(item.parkedPath),item)) fail('QUARANTINE_RESTORE_PARKED_CHANGED');
          fs.renameSync(item.parkedPath,item.path);
        } else if (fs.existsSync(item.backupPath) && matches(fingerprint(item.backupPath),item)) {
          fs.copyFileSync(item.backupPath,item.path,fs.constants.COPYFILE_EXCL); syncFile(item.path);
        } else fail('QUARANTINE_RESTORE_COPY_UNAVAILABLE');
        syncDirectory(path.dirname(item.path));
      } catch (restoreError) { restoreFailures.push({path:item.path,code:restoreError.code||restoreError.message}); }
    }
    journal.state=restoreFailures.length?'restore_required':'restored'; journal.failureCode=error.code||error.message;
    journal.restoreFailures=restoreFailures; saveJournal(journalPath,journal);
    error.details={journalPath,restoreFailures}; throw error;
  }
}
function main(argv=process.argv.slice(2)) {
  const flags=new Map();
  for(let index=0;index<argv.length;index++) {
    const key=argv[index];
    if (['--apply','--offline-confirmed'].includes(key)) flags.set(key,true);
    else if (['--manifest','--data-dir','--media-root','--application-root','--confirm'].includes(key) && argv[index+1]) flags.set(key,argv[++index]);
    else fail('QUARANTINE_ARGUMENT_INVALID');
  }
  for(const key of ['--manifest','--data-dir','--media-root','--application-root']) if(!flags.has(key)) fail('QUARANTINE_ARGUMENT_REQUIRED');
  const manifest=JSON.parse(fs.readFileSync(flags.get('--manifest'),'utf8'));
  const database=new Database(path.join(flags.get('--data-dir'),'shelfdeck.db'),{readonly:true,fileMustExist:true});
  try {
    database.pragma('query_only=ON');
    const options={database,manifest,mediaRoot:flags.get('--media-root'),applicationRoot:flags.get('--application-root'),
      offlineConfirmed:flags.get('--offline-confirmed'),confirm:flags.get('--confirm')};
    return flags.get('--apply')?applyQuarantine(options):inspectQuarantine(options);
  } finally { database.close(); }
}
if(require.main===module) {
  try { process.stdout.write(JSON.stringify(main(),null,2)+'\n'); }
  catch(error) { process.stderr.write(JSON.stringify({error:{code:error.code||error.message,details:error.details||null}})+'\n'); process.exitCode=1; }
}
module.exports={CONFIRMATION,SCHEMA,inspectQuarantine,applyQuarantine,main};
