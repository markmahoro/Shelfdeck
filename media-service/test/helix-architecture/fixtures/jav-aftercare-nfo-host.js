'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {analyzeMovieNfo,directText}=require('../../../src/helix/contracts/movie-nfo-document');
const {verifyJavCorrectionNfo}=require('../../../src/helix/domains/arca/model/jav-correction-metadata');
async function assertJavAftercareNfo({request,db,requests,primaryBytes,diagnostics,runtimeFailure}) {
  const entry=db.prepare('SELECT shelf_entry_id,canonical_identity_revision,canonical_identity_key,current_inventory_revision FROM arca_shelf_entries').get(),
    currentNfo=()=>db.prepare("SELECT m.location,m.material_key FROM arca_inventory_materials m JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision WHERE m.role='metadata_sidecar'").get(),
    currentPrimary=db.prepare("SELECT m.material_key FROM arca_inventory_materials m JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision WHERE m.role='primary_payload'").get(),
    controlBefore=db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(currentPrimary.material_key),
    receiptDigest=canonicalDigest(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()),videoBefore=primaryBytes(),
    originalNfo=currentNfo(),title=directText(analyzeMovieNfo(fs.readFileSync(originalNfo.location)),'title'),requestCount=requests.length;
  fs.unlinkSync(originalNfo.location);
  await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'jav-missing-nfo-care'});
  const deadline=Date.now()+65000;
  while(Date.now()<deadline) {
    if(runtimeFailure?.())break;
    const nfo=currentNfo();
    if(nfo&&fs.existsSync(nfo.location)&&db.prepare("SELECT aftercare_case_id FROM arca_aftercare_cases WHERE state='resolved'").get())break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(db.prepare("SELECT aftercare_case_id FROM arca_aftercare_cases WHERE state='resolved'").get(),
    JSON.stringify({diagnostics:JSON.parse(diagnostics()),requirements:db.prepare('SELECT care_requirement_json FROM arca_aftercare_cases').all().map(row=>JSON.parse(row.care_requirement_json).typedParameters.filter(item=>item.parameter.startsWith('finding.')))}));
  assert.ok(fs.existsSync(currentNfo().location));
  assert.equal(db.prepare("SELECT count(*) n FROM arca_inventory_materials m JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision WHERE m.role='metadata_sidecar'").get().n,1);
  assert.notEqual(currentNfo().material_key,originalNfo.material_key);
  assert.equal(db.prepare('SELECT state FROM fx_material_controls WHERE material_key=?').get(originalNfo.material_key)?.state,'released');
  const cases=db.prepare('SELECT care_requirement_json FROM arca_aftercare_cases').all();assert.equal(cases.length,1);
  const codes=JSON.parse(cases[0].care_requirement_json).typedParameters.map(item=>item.value);
  assert.ok(codes.includes('custody:artifact_missing'));assert.ok(codes.includes('presentation:nfo_missing'));
  verifyJavCorrectionNfo(fs.readFileSync(currentNfo().location),{javCode:'IPX-177',title});
  const after=db.prepare('SELECT canonical_identity_revision,canonical_identity_key,current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?').get(entry.shelf_entry_id);
  assert.equal(after.canonical_identity_revision,entry.canonical_identity_revision);
  assert.equal(after.canonical_identity_key,entry.canonical_identity_key);
  assert.ok(after.current_inventory_revision>entry.current_inventory_revision);
  assert.deepEqual(primaryBytes(),videoBefore);
  assert.deepEqual(db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(currentPrimary.material_key),controlBefore);
  assert.equal(canonicalDigest(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()),receiptDigest);
  assert.equal(db.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='resolved_identity'").get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='arca.aftercare.text_artifact.render@1' AND state='succeeded'").get().n,1);
  assert.equal(requests.length,requestCount,'NFO repair uses accepted facts without a new source query.');
}
module.exports=Object.freeze({assertJavAftercareNfo});
