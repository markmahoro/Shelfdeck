'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {context}=require('./fixtures/jav-correction');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync:fingerprint}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createCleanArcaInventoryPort}=require('../../src/clean-arca-inventory-port');
const {buildJavCorrectionPlacementRequest}=require('../../src/helix/domains/arca/model/aftercare-placement');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-correction-placement-')),target=path.join(root,'shelf'),old=path.join(target,'Original film');
  fs.mkdirSync(old,{recursive:true});
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('jav-correction-placement-'));fs.rmSync(root,{recursive:true,force:true});});
  const c=context(),row=c.raw.materials[0];row.location=path.join(old,'Original film.mkv');fs.writeFileSync(row.location,Buffer.alloc(4096,61));
  const observed=fingerprint(row.location),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
  Object.assign(row,{mount_scope_id:tuple.mountScopeId,inode:tuple.inode,size_bytes:tuple.sizeBytes,fingerprint_algorithm:tuple.fingerprintAlgorithm,
    fingerprint_version:tuple.fingerprintVersion,content_fingerprint:tuple.contentFingerprint,material_key:canonicalDigest({schema:'physical-material-identity@2',...tuple})});
  c.raw.shelf.target_root_location=target;c.raw.shelf.target_endpoint_id='target';c.raw.placement.value={folderTemplate:'{title}',collisionPolicy:'reject'};
  c.raw.identity.provider_key='IPX-178';c.raw.facts[0].value.descriptiveFacts.entries=[{key:'title',value:'Correct film'}];
  const port=createCleanArcaInventoryPort({schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    workspaceRoot:path.join(root,'workspace'),unitOfWork:{execute(){throw new Error('Correction preview must not write an Effect, domain transaction or Control.');}}});
  return {root,target,old,c,row,port,request:()=>buildJavCorrectionPlacementRequest(c,port,1,'correction')};
}
test('real correction placement preview reads exact owned bytes and target paths without creating or moving files',t=>{
  const f=fixture(t),before=fs.readFileSync(f.row.location),r=f.request(),value=f.port.inspectJavCorrectionPlacement(r);
  assert.equal(r.aftercareCaseId,undefined);assert.equal(r.correctionId,'correction');assert.equal(value.schema,'arca.jav-correction-target-reality@1');
  assert.match(value.targetRealityDigest,/^[a-f0-9]{64}$/);assert.equal(f.port.inspectJavCorrectionPlacement(r).targetRealityDigest,value.targetRealityDigest);
  assert.deepEqual(fs.readFileSync(f.row.location),before);assert.deepEqual(fs.readdirSync(f.target),['Original film']);
  assert.equal(r.finalInventoryDecision.members[0].targetLocation,path.join(f.target,'Correct film','Correct film.mkv'));
});
test('real correction preview rejects existing foreign targets and preserves every file',t=>{
  const f=fixture(t),other=path.join(f.target,'Correct film');fs.mkdirSync(other);const foreign=path.join(other,'Correct film.mkv');fs.writeFileSync(foreign,'Other Entry');
  assert.throws(()=>f.port.inspectJavCorrectionPlacement(f.request()),{code:'CLEAN_ARCA_TARGET_COLLISION'});
  assert.equal(fs.readFileSync(foreign,'utf8'),'Other Entry');assert.ok(fs.existsSync(f.row.location));
});
test('same-directory correction rejects unknown siblings and never automatically suffixes conflicts',t=>{
  const f=fixture(t);f.c.raw.facts[0].value.descriptiveFacts.entries=[{key:'title',value:'Original film'}];
  assert.match(f.port.inspectJavCorrectionPlacement(f.request()).targetRealityDigest,/^[a-f0-9]{64}$/);
  const unknown=path.join(f.old,'user-note.txt');fs.writeFileSync(unknown,'Keep');
  assert.throws(()=>f.port.inspectJavCorrectionPlacement(f.request()),{code:'CLEAN_ARCA_TARGET_COLLISION'});assert.equal(fs.readFileSync(unknown,'utf8'),'Keep');
  fs.unlinkSync(unknown);f.c.raw.placement.value.collisionPolicy='suffix';
  assert.throws(()=>f.port.inspectJavCorrectionPlacement(f.request()),{code:'CLEAN_ARCA_CORRECTION_SCOPE_INVALID'});
});
test('same bytes in a replacement inode do not retain the owned video identity',t=>{
  const f=fixture(t),r=f.request(),bytes=fs.readFileSync(f.row.location),replacement=path.join(f.old,'replacement.tmp');fs.writeFileSync(replacement,bytes);
  assert.notEqual(String(fs.statSync(replacement).ino),f.row.inode);fs.unlinkSync(f.row.location);fs.renameSync(replacement,f.row.location);
  assert.throws(()=>f.port.inspectJavCorrectionPlacement(r),{code:'CLEAN_ARCA_PRODUCT_SOURCE_DRIFT'});assert.deepEqual(fs.readFileSync(f.row.location),bytes);
});
