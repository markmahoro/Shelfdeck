'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),sharp=require('sharp');
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {assertJavCoverDerivation}=require('../../../src/helix/contracts/jav-cover-derivation');
const {JAV_SOURCE_TRANSPORTS}=require('../../../src/helix/contracts/jav-source-profiles');
async function assertJavAftercarePoster({request,db,requests,primaryBytes,diagnostics,runtimeFailure,expectedJavCode='IPX-177',expectedSite='javdb',expectedResourceKey=null,failure=false,beforeObserve,recoverSource,artifactKind='poster'}) {
  const entry=db.prepare('SELECT shelf_entry_id,canonical_identity_revision,canonical_identity_key,current_inventory_revision FROM arca_shelf_entries').get(),
    current=role=>db.prepare('SELECT m.location,m.material_key FROM arca_inventory_materials m JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision WHERE m.role=?').get(role),
    original=current(artifactKind),originalBytes=fs.readFileSync(original.location),nfo=current('metadata_sidecar'),nfoBytes=fs.readFileSync(nfo.location),
    primary=current('primary_payload'),controlBefore=db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(primary.material_key),
    receiptDigest=canonicalDigest(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()),videoBefore=primaryBytes(),requestCount=requests.length;
  const otherKind=artifactKind==='fanart'?'poster':'fanart',other=current(otherKind),otherBytes=fs.readFileSync(other.location),
    otherControl=db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(other.material_key);
  fs.unlinkSync(original.location);
  let maintenanceRequestStart=requestCount;
  beforeObserve?.();
  await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'jav-missing-poster-care'});
  const deadline=Date.now()+75000;
  let checkedExhaustion=false;
  while(Date.now()<deadline) {
    if(runtimeFailure?.())break;
    if(failure&&!checkedExhaustion&&db.prepare("SELECT count(*) n FROM fx_event_attempts a JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref='arca.aftercare.binary_artifact.acquire@1' AND a.failure_code='ARCA_AFTERCARE_ARTIFACT_FETCH_FAILED'").get().n===3) {
      checkedExhaustion=true;
      await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'jav-failed-poster-check-outcome'});
    }
    const poster=current(artifactKind);
    if(failure?db.prepare("SELECT aftercare_case_id FROM arca_aftercare_cases WHERE state='unresolved'").get():
      poster&&fs.existsSync(poster.location)&&db.prepare("SELECT aftercare_case_id FROM arca_aftercare_cases WHERE state='resolved'").get())break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(failure) {
    assert.ok(db.prepare("SELECT aftercare_case_id FROM arca_aftercare_cases WHERE state='unresolved'").get(),diagnostics());
    assert.equal(fs.existsSync(original.location),false);
    assert.deepEqual(db.prepare('SELECT shelf_entry_id,canonical_identity_revision,canonical_identity_key,current_inventory_revision FROM arca_shelf_entries').get(),entry);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE owner_scope_type='aftercare_case'").get().n,0);
    const failed=db.prepare("SELECT a.failure_code,a.failure_class FROM fx_event_attempts a JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref='arca.aftercare.binary_artifact.acquire@1'").all();
    assert.ok(failed.length>0);assert.ok(failed.every(row=>row.failure_code==='ARCA_AFTERCARE_ARTIFACT_FETCH_FAILED'&&row.failure_class==='integration'));
    const effects=db.prepare("SELECT j.state FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref='arca.aftercare.binary_artifact.acquire@1'").all();
    assert.equal(effects.length,failed.length);assert.ok(effects.every(row=>row.state==='failed'));
    assert.deepEqual(primaryBytes(),videoBefore);assert.deepEqual(fs.readFileSync(nfo.location),nfoBytes);
    assert.deepEqual(current(otherKind),other);assert.deepEqual(fs.readFileSync(other.location),otherBytes);
    assert.deepEqual(db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(other.material_key),otherControl);
    assert.deepEqual(db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(primary.material_key),controlBefore);
    assert.equal(canonicalDigest(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()),receiptDigest);
    assert.equal(runtimeFailure?.(),null);
    if(!recoverSource)return;
    const failedHistory=canonicalDigest(db.prepare("SELECT a.event_attempt_id,a.failure_code,j.state FROM fx_event_attempts a JOIN fx_effect_journal j ON j.event_attempt_id=a.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref='arca.aftercare.binary_artifact.acquire@1' AND a.failure_code IS NOT NULL ORDER BY a.event_attempt_id").all());
    await recoverSource();
    maintenanceRequestStart=requests.length;
    await request('POST','/v1/admin/care/'+entry.shelf_entry_id+'/actions/check',{idempotencyKey:'jav-recovered-poster-check'});
    const recoveryDeadline=Date.now()+65000;
    while(Date.now()<recoveryDeadline&&!runtimeFailure?.()&&!db.prepare("SELECT aftercare_case_id FROM arca_aftercare_cases WHERE state='resolved'").get())
      await new Promise(resolve=>setTimeout(resolve,100));
    const cases=db.prepare('SELECT state,care_requirement_json FROM arca_aftercare_cases ORDER BY created_at_ms').all();
    assert.equal(cases.length,2,diagnostics());assert.deepEqual(cases.map(row=>row.state),['unresolved','resolved'],diagnostics());
    const conditions=cases.map(row=>JSON.parse(JSON.parse(row.care_requirement_json).typedParameters.find(item=>item.parameter==='trigger.recoveryConditions').value));
    assert.deepEqual(conditions[0].map(item=>item.conditionKind),['jav-javdb']);
    assert.deepEqual(conditions[1].map(item=>item.conditionKind),['jav-javdb']);assert.notEqual(conditions[0][0].snapshotDigest,conditions[1][0].snapshotDigest);
    assert.equal(canonicalDigest(db.prepare("SELECT a.event_attempt_id,a.failure_code,j.state FROM fx_event_attempts a JOIN fx_effect_journal j ON j.event_attempt_id=a.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref='arca.aftercare.binary_artifact.acquire@1' AND a.failure_code IS NOT NULL ORDER BY a.event_attempt_id").all()),failedHistory);
  }
  assert.ok(db.prepare("SELECT aftercare_case_id FROM arca_aftercare_cases WHERE state='resolved'").get(),diagnostics());
  assert.deepEqual(current(otherKind),other);
  assert.deepEqual(fs.readFileSync(other.location),otherBytes);
  assert.deepEqual(db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(other.material_key),otherControl);
  if(!recoverSource)assert.equal(db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,1,diagnostics());
  const restored=current(artifactKind),bytes=fs.readFileSync(restored.location),metadata=await sharp(bytes).metadata();
  assert.equal(metadata.format,'jpeg');assert.deepEqual(bytes,originalBytes);
  assert.notEqual(restored.material_key,original.material_key);
  assert.equal(db.prepare('SELECT state FROM fx_material_controls WHERE material_key=?').get(original.material_key)?.state,'released');
  assert.equal(db.prepare('SELECT count(*) n FROM arca_inventory_materials m JOIN arca_shelf_entries e ON e.shelf_entry_id=m.shelf_entry_id AND e.current_inventory_revision=m.inventory_revision WHERE m.role=?').get(artifactKind).n,1);
  const rows=db.prepare("SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref='arca.aftercare.binary_artifact.acquire@1'").all();
  assert.equal(rows.length,1,JSON.stringify({kinds:rows.map(row=>JSON.parse(row.result_json).artifactHandle?.artifactKind),
    cases:db.prepare('SELECT state,care_requirement_json FROM arca_aftercare_cases').all().map(row=>({state:row.state,goals:JSON.parse(row.care_requirement_json).typedParameters.filter(p=>p.parameter.startsWith('finding.')).map(p=>p.value)}))}));
  const result=JSON.parse(rows[0].result_json),proof=assertJavCoverDerivation(result.javCoverDerivation);
  assert.equal(proof.kind,artifactKind);assert.equal(proof.javSelectedSource.siteRef,expectedSite);
  if(artifactKind==='fanart')assert.equal(proof.crop,null);
  const materialized=JSON.parse(db.prepare("SELECT b.result_json FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id WHERE e.capability_ref='arca.aftercare.artifact.materialize@1'").get().result_json);
  assert.equal(materialized.artifactKind,artifactKind);
  assert.equal(proof.javSelectedSource.queryAnchor.javCode,expectedJavCode);
  if(expectedResourceKey)assert.equal(proof.javSelectedSource.resourceKey,expectedResourceKey);
  assert.equal(proof.outputDigest,result.artifactHandle.digestHex);
  if(recoverSource)assert.equal(proof.javSelectedSource.configRevision,2);
  const after=db.prepare('SELECT canonical_identity_revision,canonical_identity_key,current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?').get(entry.shelf_entry_id);
  assert.equal(after.canonical_identity_revision,entry.canonical_identity_revision);assert.equal(after.canonical_identity_key,entry.canonical_identity_key);
  assert.ok(after.current_inventory_revision>entry.current_inventory_revision);
  assert.deepEqual(primaryBytes(),videoBefore);assert.deepEqual(fs.readFileSync(nfo.location),nfoBytes);
  assert.deepEqual(db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(primary.material_key),controlBefore);
  assert.equal(canonicalDigest(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all()),receiptDigest);
  assert.equal(db.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='resolved_identity'").get().n,1);
  const added=requests.slice(maintenanceRequestStart);assert.ok(added.length>0);
  const profile=JAV_SOURCE_TRANSPORTS[expectedSite],allowedHosts=new Set([...profile.endpoints.map(url=>new URL(url).hostname),...profile.assets]);
  assert.ok(added.every(url=>allowedHosts.has(new URL(url).hostname)&&!new URL(url).pathname.startsWith('/search')));
  if(expectedResourceKey)assert.ok(added.filter(url=>new URL(url).hostname==='javdb.com').every(url=>new URL(url).pathname==='/v/'+expectedResourceKey));
}
module.exports=Object.freeze({assertJavAftercarePoster});
