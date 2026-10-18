'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./fixtures/us-adult-actor-refresh-store-context');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createArcaCollectionQuery}=require('../../src/helix/domains/arca/application/collection-query');
const {retainedName}=require('../../src/helix/contracts/us-adult-retained-name');
const {emptyArcaMaterialEpisodeClaims,SCHEMA_REF}=require('../../src/helix/domains/arca/model/material-episode-claims');
function posterRow(location,revision){
  const fp=computeBoundedMaterialFingerprintSync(location),tuple={mountScopeId:'mount',inode:String(fp.stat.ino),sizeBytes:Number(fp.stat.size),
    fingerprintAlgorithm:fp.fingerprintAlgorithm,fingerprintVersion:fp.fingerprintVersion,contentFingerprint:fp.contentFingerprint},claims=emptyArcaMaterialEpisodeClaims();
  return {shelf_entry_id:'entry',inventory_revision:revision,ordinal:1,material_key:D({schema:'physical-material-identity@2',...tuple}),role:'poster',
    episode_claims_schema_ref:SCHEMA_REF,episode_claims_json:canonicalJson(claims),episode_claim_set_digest:claims.episodeClaimSetDigest,
    endpoint_id:'endpoint',location,binding_revision:1,mount_scope_id:tuple.mountScopeId,inode:tuple.inode,fingerprint_algorithm:tuple.fingerprintAlgorithm,
    fingerprint_version:String(tuple.fingerprintVersion),content_fingerprint:tuple.contentFingerprint,digest_hex:D('poster'),size_bytes:tuple.sizeBytes,
    artifact_scope_schema_ref:null,artifact_scope_json:null,active_guard:0};
}
function insert(db,row){const columns=Object.keys(row);db.prepare('INSERT INTO arca_inventory_materials ('+columns.join(',')+') VALUES ('+columns.map(key=>'@'+key).join(',')+')').run(row);}
test('an active actor refresh exposes the precise retained poster only while its original Inventory remains current',async t=>{
  const f=fixture(t),s=f.services(),started=s.command.request('entry',f.request,'admin'),location=path.join(f.root,'poster.jpg');
  fs.writeFileSync(location,Buffer.alloc(1000,13));const original=posterRow(location,2);insert(f.db,original);
  const query=createArcaCollectionQuery({...s.dependencies,posterReader:async value=>value});
  assert.equal((await query.getPoster('entry')).retainedRead,undefined);
  s.care.admitCase(started.aftercareCaseId);
  const retained=path.join(f.root,retainedName(started.aftercareCaseId,1));fs.linkSync(location,retained);fs.unlinkSync(location);fs.writeFileSync(location,Buffer.alloc(2000,17));
  const pending=await query.getPoster('entry');assert.equal(pending.retainedRead.location,retained);
  assert.equal(pending.retainedRead.physicalIdentity.inode,original.inode);assert.equal(pending.sizeBytes,1000);
  f.db.prepare('INSERT INTO arca_inventory_representations VALUES(?,?,?,?,?)').run('entry',3,D('new inventory'),'package',10001);
  insert(f.db,posterRow(location,3));f.db.prepare('UPDATE arca_shelf_entries SET current_inventory_revision=3 WHERE shelf_entry_id=?').run('entry');
  const committed=await query.getPoster('entry');assert.equal(committed.retainedRead,undefined);assert.equal(committed.sizeBytes,2000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,1);
});
test('retained poster reads reject a corrupted frozen Case Basis instead of choosing a different physical file',async t=>{
  const f=fixture(t),s=f.services(),started=s.command.request('entry',f.request,'admin'),location=path.join(f.root,'poster.jpg');
  fs.writeFileSync(location,Buffer.alloc(1000,13));insert(f.db,posterRow(location,2));s.care.admitCase(started.aftercareCaseId);
  f.db.prepare('UPDATE arca_aftercare_cases SET care_basis_digest=? WHERE aftercare_case_id=?').run(D('corrupt basis'),started.aftercareCaseId);
  const query=createArcaCollectionQuery({...s.dependencies,posterReader:async value=>value});
  await assert.rejects(query.getPoster('entry'),{code:'ARCA_US_ADULT_PHASE_PROOF_INVALID'});
});
