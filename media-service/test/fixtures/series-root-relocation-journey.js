'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
async function relocateTwoSeasons({db,request,assertRuntime}) {
  const entries=db.prepare('SELECT * FROM arca_shelf_entries ORDER BY shelf_entry_id').all();assert.equal(entries.length,2);
  const originals=entries.flatMap(entry=>db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=?').all(entry.shelf_entry_id,entry.current_inventory_revision));
  const history=()=>JSON.stringify(['arca_ondeck_commit_receipts','arca_canonical_identity_revisions','arca_deck_fact_revisions','fx_material_controls','fx_material_control_revisions']
    .map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const before=history(),shelf=(await request('GET','/v1/admin/shelves/series-shelf')).json().shelf;
  const policy={...shelf.placement.value,folderTemplate:'Together {title}'},draft={shelfId:shelf.shelfId,expectedPlacementRevision:shelf.currentPlacementRevision,
    target:shelf.target,placement:{schemaRef:shelf.placement.schemaRef,value:policy,digest:canonicalDigest(policy)}};
  const preview=(await request('POST','/v1/admin/shelves/series-shelf/placement/actions/preview',{idempotencyKey:'two-season-move-preview',...draft})).json();
  assert.equal(preview.affectedActiveEntryCount,2);
  await request('PATCH','/v1/admin/shelves/series-shelf/placement',{idempotencyKey:'two-season-move-publish',...draft,
    expectedCurrentTargetDigest:preview.currentTargetDigest,previewId:preview.previewId,previewDigest:preview.previewDigest});
  const conflict=process.env.HELIX_SERIES_ROOT_RELOCATION_RETRY==='1'?path.join(db.prepare('SELECT root_location FROM arca_series_presentation_scopes').get().root_location,'unknown-user-file.txt'):null;
  if(conflict)fs.writeFileSync(conflict,'owned by the test, never part of the relocation');
  const check=(await request('POST','/v1/admin/care/'+entries[0].shelf_entry_id+'/actions/check',{idempotencyKey:'two-season-move-check'})).json();
  assert.notEqual(check.state,'inventory_records_refreshed','One manual check must continue after refreshing person relations.');
  if(conflict) {
    const deadline=Date.now()+30000;let failed;
    do {assertRuntime();failed=db.prepare("SELECT * FROM fx_supporting_works WHERE process_type='arca_series_root_relocation' AND state='failed'").get();
      if(failed)break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
    assert.ok(failed,'The unknown file must cause an explicit failed attempt.');
    const held=db.prepare('SELECT * FROM arca_series_root_relocations').get();assert.equal(held.state,'active');
    assert.ok(fs.existsSync(conflict));assert.equal(fs.existsSync(JSON.parse(held.plan_json).newRoot),false);
    for(const entry of entries) {
      const care=(await request('GET','/v1/admin/care/'+entry.shelf_entry_id)).json();
      assert.equal(care.seriesRelocation.state,'attention_required');assert.equal(care.seriesRelocation.seasonCount,2);
      assert.equal(care.seriesRelocation.reasonCode,'ARCA_SERIES_RELOCATION_UNKNOWN_MEMBER');
    }
    const wall=(await request('GET','/v1/admin/collection?status=current')).json().items;
    assert.ok(wall.every(entry=>entry.health.state==='attention_required'),'Both Seasons must show the same real pending relocation on the collection wall.');
    const repeated=(await request('POST','/v1/admin/care/'+entries[0].shelf_entry_id+'/actions/check',{idempotencyKey:'two-season-move-check'})).json();
    assert.equal(repeated.state,'attention_required');
    assert.equal(db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE process_type='arca_series_root_relocation'").get().n,1);
    fs.unlinkSync(conflict);
    const retried=(await request('POST','/v1/admin/care/'+entries[0].shelf_entry_id+'/actions/check',{idempotencyKey:'two-season-move-retry'})).json();
    const replayed=(await request('POST','/v1/admin/care/'+entries[0].shelf_entry_id+'/actions/check',{idempotencyKey:'two-season-move-retry'})).json();
    assert.equal(retried.operationRef,replayed.operationRef);assert.notEqual(retried.operationRef,failed.work_id);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE process_type='arca_series_root_relocation'").get().n,2);
    assert.equal(db.prepare('SELECT plan_digest FROM arca_series_root_relocations').get().plan_digest,held.plan_digest);
  }
  const until=Date.now()+120000;let row;
  do {assertRuntime();row=db.prepare('SELECT * FROM arca_series_root_relocations').get();if(row?.state==='committed')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<until);
  assert.equal(row?.state,'committed',JSON.stringify({row,works:db.prepare('SELECT work_kind,state FROM fx_supporting_works').all(),failures:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),care:(await request('GET','/v1/admin/care/'+entries[0].shelf_entry_id)).json()}));
  const plan=JSON.parse(row.plan_json);assert.equal(plan.seasons.length,2);assert.equal(history(),before);
  for(const original of originals) {
    const entry=db.prepare('SELECT * FROM arca_shelf_entries WHERE shelf_entry_id=?').get(original.shelf_entry_id),
      current=db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? AND material_key=?').get(original.shelf_entry_id,entry.current_inventory_revision,original.material_key);
    assert.equal(current.location,path.join(plan.newRoot,path.relative(plan.oldRoot,original.location)));
    assert.equal(current.inode,original.inode);assert.equal(current.episode_claims_json,original.episode_claims_json);assert.equal(current.artifact_scope_json,original.artifact_scope_json);
    assert.ok(fs.existsSync(current.location));assert.equal(fs.existsSync(original.location),false);
  }
  for(const file of plan.files.filter(file=>file.ownerScopeType==='series_presentation'))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(plan.newRoot,file.relativePath))).digest('hex'),file.byteDigest);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
}
function crashBoundary(root,db,phase,clockTimeMs) {
  const relocation=db.prepare('SELECT * FROM arca_series_root_relocations').get();
  fs.writeFileSync(path.join(root,'relocation-boundary.json'),JSON.stringify({phase,relocation,clockTimeMs,capturedAtMs:Date.now(),
    protectedRows:['arca_ondeck_commit_receipts','arca_canonical_identity_revisions','arca_deck_fact_revisions','fx_material_controls','fx_material_control_revisions'].map(table=>({table,rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()})),
    events:db.prepare("SELECT event_id,state,capability_ref FROM fx_workflow_events WHERE capability_ref LIKE 'arca.series_root.%'").all()}));
  process.exit(79);
}
module.exports={relocateTwoSeasons,crashBoundary};
