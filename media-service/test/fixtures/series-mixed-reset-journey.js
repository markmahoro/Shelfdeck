'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');

function verifyMixedReset({db,firstEntry,firstFiles,secondSource,sharedManifest}) {
  const sourcePath=db.name,targetPath=path.join(path.dirname(sourcePath),'mixed-series-retained.db');
  assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM arca_acceptance_decisions WHERE result='accepted'").get().n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_subjects').get().n,2);
  const originals=[...firstFiles,...sharedManifest.members.map(item=>({location:item.location,bytes:fs.readFileSync(item.location)}))];
  function inspect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const location=path.join(directory,entry.name);if(entry.isDirectory())inspect(location);else if(entry.isFile())originals.push({location,bytes:fs.readFileSync(location)});else throw Error('Unexpected fixture link');}}
  inspect(secondSource);
  const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const schemaDdl=fs.readFileSync(path.join(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
  const owner=require('../../scripts/formation-reset-owner-snapshot').readResetOwnerSnapshot({Database,sourcePath});
  const policy=require('../../scripts/formation-reset-owner-policy').buildOwnerRetentionPolicy(schemaManifest,owner);
  const copy=require('../../scripts/formation-reset-copy').createRetainedDatabase({Database,sourcePath,targetPath,policy,targetSchema:{schemaManifest,schemaDdl}});
  require('../../scripts/formation-reset-normalize').normalizeRetainedSubjects({Database,targetPath,schemaManifest,schemaDdl,
    generationId:canonicalDigest('isolated-mixed-series-reset'),backupDigest:canonicalDigest('isolated-copy-only'),manifestDigest:copy.retainedDigest,
    seriesRetention:owner.seriesRetention,assertIsolated:value=>assert.equal(value,targetPath)});
  const verified=require('../../scripts/formation-reset-verify').verifyRetainedCollections({Database,sourcePath,targetPath,schemaManifest,schemaDdl});
  const target=new Database(targetPath,{readonly:true});
  try{
    assert.equal(verified.reconstructedCommits,1);assert.equal(verified.reconstructedPackages,1);
    assert.deepEqual(target.prepare('SELECT * FROM arca_shelf_entries').all(),[firstEntry]);
    assert.equal(target.prepare("SELECT count(*) n FROM arca_acceptance_decisions WHERE result='accepted'").get().n,1);
    assert.equal(target.prepare('SELECT count(*) n FROM libra_subjects').get().n,1);
    assert.equal(target.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
    assert.ok(target.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n>0);
    assert.equal(target.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(target.pragma('foreign_key_check'),[]);
  }finally{target.close();}
  for(const original of originals)assert.deepEqual(fs.readFileSync(original.location),original.bytes);
  return {committedSeasons:1,removedAcceptedSeasons:1,shared:verified.shared,protectedFiles:originals.length};
}
module.exports={verifyMixedReset};
