'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const { canonicalDigest }=require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel }=require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork }=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createAftercareStore }=require('../../src/helix/domains/arca/persistence/aftercare-store');
const { admissionPreview, acceptedFinding }=require('../../src/helix/domains/arca/model/accepted-gap-contracts');
const { verifiedDefectRepair }=require('../../src/helix/domains/arca/model/defect-repair-verification');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const d=canonicalDigest;

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'uat251-arca-defects-')),databasePath=path.join(root,'test.db');
  let at=10000;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>at}),unitOfWork=createSqliteUnitOfWork({kernel});
  const db=new Database(databasePath);db.pragma('foreign_keys=OFF');
  db.prepare(`INSERT INTO arca_shelves (shelf_id,name,target_endpoint_id,target_root_location,target_mount_scope_id,
    target_mount_scope_revision,status,current_standard_revision,current_placement_revision,routing_projection_revision,
    routing_projection_digest,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('shelf','Shelf','endpoint',root,'mount',1,'active',1,1,1,d('routing'),at,at);
  db.prepare(`INSERT INTO arca_shelf_entries (shelf_entry_id,shelf_id,structure_kind,status,canonical_identity_revision,
    canonical_identity_key,current_inventory_revision,current_deck_fact_revision,created_at_ms,terminal_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`).run('entry','shelf','single','active',1,'tmdb:1',1,1,at);
  const store=createAftercareStore({schemaManifest,unitOfWork,now:()=>at,aftercareWorkspaceRoot:path.join(root,'workspace')});
  const context={shelfEntryId:'entry',basis:{schemaRef:'helix://contracts/domain-types/CareBasis/v1',digest:d('basis'),inventoryRevision:1,standardRevision:1,placementRevision:1},
    raw:{entry:{structure_kind:'single',canonical_identity_revision:1},identity:{identity_kind:'tmdb_movie'},shelf:{status:'active'},reservations:[],
      standard:{value:{profileRuleSets:[{contentProfile:'movie',baseRequirements:{metadata:{requiredFieldCodes:['actor','plot']},mandatoryMedia:{},space:{}}}]}},
      materials:[{role:'primary_payload',material_key:d('primary')}],facts:[]}};
  const findings=['metadata_field_missing__actor','metadata_field_missing__plot'].map(code=>({findingId:code,assessmentId:'conformance',state:'open',
    findingKind:'conformance:'+code,findingDigest:d(code),repairability:'attention_required',severity:'warning'}));
  const history={cases:[],findings,assessments:['custody','presentation','conformance'].map(kind=>({assessmentId:kind,assessmentKind:kind,
    careBasisDigest:context.basis.digest,result:kind==='conformance'?'degraded':'healthy',evidenceDigest:d(kind),assessedAtMs:at}))};
  const manifestBody={schemaRef:'helix://contracts/application-types/AuthorizedDefectManifest/v1',schemaVersion:1,
    manifestId:d('existing-actor-manifest'),defectDecisionId:d('existing-actor-manifest'),libraRunId:'run',frozenRunRef:{stateRevision:1},
    defects:[{defectCode:'actor_unavailable',sourceFailureCode:'product_metadata_required_cast_missing',metadataFieldCodes:['actor'],waivedRequirementCodes:['metadata_field_unmet']}],
    defectCount:1,waivedRequirementCodes:['metadata_field_unmet'],acknowledgement:'accept_listed_defects'};
  context.authorizedDefectManifest={...manifestBody,manifestDigest:d(manifestBody)};
  const preview=()=>admissionPreview(context,history,store.defectStore.current('entry'),at);
  const request=()=>({...preview(),actorId:'admin',idempotencyKey:'accept',identityRevision:1,standardRevision:1,placementRevision:1,validateReality(){}});
  const care=(value)=>{
    const base={schemaRef:'helix://contracts/domain-types/CareRequirement/v1',schemaVersion:1,requirementId:'manual-requirement',revision:1,
      careBasisDigest:context.basis.digest,requiredEffects:[{objectId:'poster',revision:1,schemaRef:'helix://arca/types/RequiredCareEffect/v1',digest:d('poster'),objectKind:'required-effect'}],
      acceptanceDigest:d('effect'),typedParameters:[{parameter:'finding.poster',valueType:'string',value:'presentation:poster_missing',valueDigest:d('presentation:poster_missing')},
        {parameter:'trigger.kind',valueType:'string',value:'repair_accepted_defects',valueDigest:d('repair_accepted_defects')}]};
    return {shelfEntryId:'entry',careBasis:context.basis,findingSetDigest:d('manual'),careRequirement:{...base,digest:d(base)},
      triggerDigest:d(value),basisInputs:[]};
  };
  return {root,kernel,db,store,context,history,preview,request,care,unitOfWork,setTime:t=>{at=t;},
    close(){db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('Arca exact acceptance is atomic, preserves Inventory and failed Case history, and survives reopening',()=>{
  const f=fixture();try {
    const before=f.db.prepare('SELECT * FROM arca_shelf_entries').all(),request=f.request();
    const failed=f.store.createCase(f.care('failed'));
    f.store.terminateCase(failed.aftercareCaseId,'unresolved','provider_artifact_not_available',d('failure'));
    const accepted=f.store.defectStore.accept(request);
    assert.equal(accepted.authorization.revision,1);
    assert.deepEqual(f.db.prepare('SELECT * FROM arca_shelf_entries').all(),before);
    assert.equal(f.store.getCase(failed.aftercareCaseId).state,'unresolved');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM fx_command_receipts').get().n,1);
    assert.equal(f.store.defectStore.accept(request).replayed,true);
    const reopened=createAftercareStore({schemaManifest,unitOfWork:f.unitOfWork,aftercareWorkspaceRoot:path.join(f.root,'workspace')});
    assert.deepEqual(reopened.defectStore.current('entry'),accepted.authorization);
    assert.throws(()=>f.store.defectStore.accept({...request,idempotencyKey:'stale'}),error=>error.code==='ARCA_DEFECT_AUTHORIZATION_STALE');
  }finally{f.close();}
});

test('physical and authorization fences roll back the acceptance and its command receipt',()=>{
  const f=fixture();try {
    assert.throws(()=>f.store.defectStore.accept({...f.request(),validateReality(){throw new Error('physical changed');}}),/physical changed/);
    assert.equal(f.store.defectStore.current('entry'),null);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM fx_command_receipts').get().n,0);
    f.db.prepare("UPDATE arca_shelf_entries SET status='offdeck_in_progress'").run();
    assert.throws(()=>f.store.defectStore.accept(f.request()),error=>error.code==='ARCA_DEFECT_BASIS_STALE');
  }finally{f.close();}
});

test('manual repair intent and FIFO Case commit together; failure preserves exact accepted gaps',()=>{
  const f=fixture();try {
    const accepted=f.store.defectStore.accept(f.request()).authorization;
    const value={...f.request(),intentId:'manual-intent',intentDigest:d('intent'),idempotencyKey:'repair',gapSetDigest:accepted.gapSetDigest};
    const request={...f.care('manual'),atomicParticipants:caseId=>{
      const participant=f.store.defectStore.repairReceiptParticipant(value,caseId);
      return [f.store.defectStore.repairParticipant(value,caseId),
        {...participant,execute(context){participant.execute(context);throw new Error('atomic rollback');}}];}};
    assert.throws(()=>f.store.createCase(request),/atomic rollback/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM arca_aftercare_cases').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM arca_defect_repair_intents').get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM fx_command_receipts WHERE command_contract='arca.repair-accepted-defects@1'").get().n,0);
    const care=f.store.createCase({...request,atomicParticipants:caseId=>[f.store.defectStore.repairParticipant(value,caseId),
      f.store.defectStore.repairReceiptParticipant(value,caseId)]});
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM fx_command_receipts WHERE command_contract='arca.repair-accepted-defects@1'").get().n,1);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM fx_audit_records WHERE action='repair_accepted_defects'").get().n,1);
    assert.equal(care.state,'queued');assert.equal(f.store.defectStore.repairIntent(value).aftercare_case_id,care.aftercareCaseId);
    f.store.terminateCase(care.aftercareCaseId,'unresolved','provider_artifact_not_available',d('failed'));
    assert.deepEqual(f.store.defectStore.current('entry'),accepted);
  }finally{f.close();}
});

test('an accepted metadata field cannot hide a different field, a changed gap or new damage',()=>{
  const f=fixture();try {
    const request=f.request();request.gaps=request.gaps.filter(gap=>gap.targetId==='actor');
    const authorization=f.store.defectStore.accept(request).authorization,c={...f.context,defectAuthorization:authorization};
    assert.equal(acceptedFinding(c,f.history.findings[0]),true);
    assert.equal(acceptedFinding(c,f.history.findings[1]),false);
    assert.equal(acceptedFinding(c,{...f.history.findings[0],findingDigest:d('different')}),false);
    assert.equal(acceptedFinding(c,{findingKind:'custody:primary_missing',findingDigest:d('damage')}),false);
    const mixed={...f.history,findings:[...f.history.findings,{assessmentId:'custody',findingKind:'custody:primary_missing',findingDigest:d('damage'),state:'open'}]};
    const preview=admissionPreview(f.context,mixed,null,10000);
    assert.equal(preview.eligibility,'ineligible');assert.ok(preview.ineligibleReasons.includes('custody:primary_missing'));
  }finally{f.close();}
});

test('repair verification removes only a materialized and verified exact artifact gap',()=>{
  const gaps=[{targetKind:'artifact',targetId:'poster',gapDigest:d('poster')},{targetKind:'metadata_field',targetId:'actor',gapDigest:d('actor')}];
  const json=JSON.stringify(gaps),care={aftercareCaseId:'case',careRequirementDigest:d('requirement'),careRequirement:{typedParameters:[
    {parameter:'target.acceptedGaps',value:json,valueDigest:d(json)}]}};
  assert.deepEqual(verifiedDefectRepair(care,[],[]).fixedGapDigests,[]);
  const result=verifiedDefectRepair(care,[{scopeId:'case',scopeDigest:care.careRequirementDigest,materialEffectKind:'artifact_materialize',targetLocation:'/shelf/poster.jpg'}],
    [{capabilityRef:'arca.aftercare.binary_artifact.acquire@1',result:{resultKind:'acquired',artifactHandle:{artifactKind:'poster'}}}]);
  assert.deepEqual(result.fixedGapDigests,[d('poster')]);assert.equal(result.gaps.length,2);
});
