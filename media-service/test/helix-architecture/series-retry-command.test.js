'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createSeriesRetryCommandStore}=require('../../src/helix/domains/arca/persistence/series-retry-command-store');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
test('show retry receipt rolls back with Owner writes and binds the exact original command',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-command-')),kernel=openSqliteKernel({Database,databasePath:path.join(root,'db'),schemaManifest,schemaDdl:fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')}),unitOfWork=createSqliteUnitOfWork({kernel}),store=createSeriesRetryCommandStore({schemaManifest,unitOfWork});
  try{const images=[{artifactKind:'fanart',bytesBase64:'ZmFuYXJ0'}],command=store.command('entry','season-entry',{idempotencyKey:'retry-one',supplementalImages:images}),result={buildId:'arca-series-build-'+'a'.repeat(40),scopeId:'arca-series-'+'b'.repeat(40),scopeDigest:'c'.repeat(64),workId:'arca-series-work-'+'d'.repeat(40),generation:2,workKind:'series_presentation'},writer=command.participant(()=>result),crash={...writer,participantId:'fixture_after_command_receipt',execute(){throw new Error('Injected Owner transaction interruption');}};
    assert.equal(command.read(),null);assert.throws(()=>unitOfWork.execute([writer,crash]),/Injected Owner transaction interruption/);assert.equal(command.read(),null);
    unitOfWork.execute([writer]);assert.deepEqual(command.read(),result);unitOfWork.execute([writer]);assert.deepEqual(command.read(),result);
    assert.throws(()=>store.command('entry','season-entry',{idempotencyKey:'retry-one',supplementalImages:[{artifactKind:'fanart',bytesBase64:'Y2hhbmdlZA=='}]}).read(),{code:'ARCA_SERIES_RETRY_KEY_CONFLICT'});
    assert.throws(()=>store.command('acceptance','different',{idempotencyKey:'retry-one',supplementalImages:images}).read(),{code:'ARCA_SERIES_RETRY_KEY_CONFLICT'});
    assert.deepEqual(store.latestForBuild(result.buildId),result);
  }finally{kernel.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});}
});
