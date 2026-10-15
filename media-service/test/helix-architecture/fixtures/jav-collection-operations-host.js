'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');

async function assertJavCollectionOperations({request,db,diagnostics,runtimeFailure,mode}) {
  const entry=db.prepare('SELECT * FROM arca_shelf_entries').get(),
    materials=db.prepare('SELECT material_key,location,role FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? ORDER BY ordinal')
      .all(entry.shelf_entry_id,entry.current_inventory_revision),
    originals=materials.map(item=>({...item,bytes:fs.readFileSync(item.location)})),
    originalReceipt=canonicalDigest(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()),
    originalIdentity=canonicalDigest(db.prepare('SELECT * FROM arca_canonical_identity_revisions').all()),
    sentinel=path.join(path.dirname(materials.find(item=>item.role==='primary_payload').location),'unknown-user-file.txt');
  fs.writeFileSync(sentinel,'outside the immutable collection scope',{flag:'wx'});
  assert.equal(materials.length,4);
  if(mode==='offdeck') {
    let review=await request('POST','/v1/admin/offdeck/reviews',{
      shelfEntryId:entry.shelf_entry_id,originKind:'direct_intent',actorId:'jav-operation-test',idempotencyKey:'jav-offdeck-review'});
    assert.ok(['preparing','open'].includes(review.state),diagnostics());
    const reviewDeadline=Date.now()+65000;
    while(review.state==='preparing'&&Date.now()<reviewDeadline&&!runtimeFailure?.()) {
      for(const item of originals)assert.deepEqual(fs.readFileSync(item.location),item.bytes);
      await new Promise(resolve=>setTimeout(resolve,100));
      review=await request('GET','/v1/admin/offdeck/reviews/'+review.reviewId);
    }
    assert.equal(runtimeFailure?.(),null,diagnostics());
    assert.equal(review.state,'open',diagnostics());assert.equal(review.scopes.length,1);
    assert.equal(review.scopes[0].memberCount,materials.length);
    assert.deepEqual(review.scopes[0].materials.map(item=>item.materialKey).sort(),materials.map(item=>item.material_key).sort());
    for(const item of originals)assert.deepEqual(fs.readFileSync(item.location),item.bytes);
    const selected=await request('POST','/v1/admin/offdeck/reviews/'+review.reviewId+'/actions/confirm-selection',{
      actorId:'jav-operation-test',idempotencyKey:'jav-offdeck-select'});
    assert.equal(selected.state,'selection_confirmed');assert.equal(selected.selection.highVolume,false);
    const authorized=await request('POST','/v1/admin/offdeck/authorizations',{
      reviewId:review.reviewId,actorId:'jav-operation-test',idempotencyKey:'jav-offdeck-authorize'});
    assert.equal(authorized.cases.length,1);
    const deadline=Date.now()+70000;
    while(Date.now()<deadline&&!runtimeFailure?.()&&db.prepare('SELECT state FROM arca_offdeck_cases WHERE offdeck_case_id=?').get(authorized.cases[0])?.state!=='completed')
      await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(runtimeFailure?.(),null,diagnostics());
    assert.equal(db.prepare('SELECT state FROM arca_offdeck_cases WHERE offdeck_case_id=?').get(authorized.cases[0])?.state,'completed',diagnostics());
    assert.equal(db.prepare('SELECT status FROM arca_shelf_entries WHERE shelf_entry_id=?').get(entry.shelf_entry_id)?.status,'offdecked');
    assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_deletion_evidence').get().n,materials.length);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_terminal_receipts').get().n,1);
    for(const item of materials)assert.equal(fs.existsSync(item.location),false,item.role);
  } else if(mode==='deregister') {
    const {shelf}=await request('GET','/v1/admin/shelves/'+entry.shelf_id);
    await request('POST','/v1/admin/shelves/'+shelf.shelfId+'/actions/deregister',{
      idempotencyKey:'jav-deregister-shelf',shelfId:shelf.shelfId,expectedStatus:'active',expectedUpdatedAtMs:shelf.updatedAtMs,
      expectedRoutingProjectionRevision:shelf.routingProjection.revision,confirmation:{decision:'deregister_shelf',
        enteredShelfName:shelf.name,preservePhysicalFilesAcknowledged:true,releaseControlAcknowledged:true}});
    const deadline=Date.now()+70000;
    let status;
    do {
      status=(await request('GET','/v1/admin/shelves/'+shelf.shelfId)).shelf.status;
      if(status==='deregistered'||runtimeFailure?.())break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
    assert.equal(runtimeFailure?.(),null,diagnostics());assert.equal(status,'deregistered',diagnostics());
    for(const item of originals)assert.deepEqual(fs.readFileSync(item.location),item.bytes,item.role);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_terminal_receipts').get().n,0);
  } else throw new TypeError('Unsupported test operation.');
  assert.equal(fs.readFileSync(sentinel,'utf8'),'outside the immutable collection scope');
  for(const item of materials)assert.equal(db.prepare('SELECT state FROM fx_material_controls WHERE material_key=?').get(item.material_key)?.state,'released',item.role);
  assert.equal(canonicalDigest(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()),originalReceipt);
  assert.equal(canonicalDigest(db.prepare('SELECT * FROM arca_canonical_identity_revisions').all()),originalIdentity);
}
module.exports=Object.freeze({assertJavCollectionOperations});
