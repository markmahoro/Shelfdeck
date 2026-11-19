'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {BETA_RECOMMENDED_RULES}=require('../../src/helix/domains/arca/model/rule-template-contracts');
const {effectiveRequirements}=require('../../src/helix/domains/arca/model/care-objective');
const {assertCollectionCareTarget}=require('../../src/helix/domains/arca/model/collection-care-target');
const {createAftercareContextReader}=require('../../src/helix/domains/arca/application/aftercare-context-reader');
const {createAftercareStore}=require('../../src/helix/domains/arca/persistence/aftercare-store');
const {createCollectionTargetStore}=require('../../src/helix/domains/arca/persistence/collection-target-store');
const {createAftercareCapabilityPorts,probeConformance}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/aftercare-contract');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl=fs.readFileSync(path.join(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');

function requirements(){return structuredClone(BETA_RECOMMENDED_RULES.profileRuleSets.find(item=>item.contentProfile==='movie')
  .decisionBranches.find(item=>item.rating===5).requirements);}
function customRequirements(){const value=requirements();value.mandatoryMedia.minimumRasterClass='none';
  value.metadata.requiredArtifactKinds=value.metadata.requiredArtifactKinds.filter(item=>item!=='poster');
  value.inventory.requiredMaterializedArtifactKinds=value.inventory.requiredMaterializedArtifactKinds.filter(item=>item!=='poster');return value;}
function target(value,{kind='user_custom',revision=1,entry='entry',shelf='shelf',inventoryRevision=1}={}){
  const body={schemaRef:'arca.collection-care-target@1',shelfEntryId:entry,shelfId:shelf,inventoryRevision,
    contentProfile:'movie',structureKind:'single',targetKind:kind,targetRevision:revision,intentId:'intent-'+revision,
    intentDigest:canonicalDigest('intent-'+revision),requirements:value,requirementsDigest:canonicalDigest(value)};
  return {...body,projectionDigest:canonicalDigest(body)};
}
function raw(targetValue){return {entry:{status:'active',structure_kind:'single',current_inventory_revision:1},
  shelf:{shelf_id:'shelf',status:'active',target_endpoint_id:'endpoint',current_standard_revision:1,current_placement_revision:1},
  standard:{standard_digest:canonicalDigest('standard'),value:{profileRuleSets:[{contentProfile:'movie',decisionInputKinds:[],baseRequirements:requirements()}]}},
  identity:{identity_kind:'tmdb_movie',identity_digest:canonicalDigest('identity'),revision:1,provider:'tmdb',provider_key:'1'},
  inventory:{source_package_id:'package',representation_digest:canonicalDigest('inventory')},
  placement:{policy_digest:canonicalDigest({}),value:{}},materials:[],oldBindings:[],facts:[],collectionTarget:targetValue};}

test('custom and restored collection targets select exact requirements without waiving audio, size or safety',()=>{
  const chosen=target(customRequirements()),context={shelfEntryId:'entry',raw:raw(chosen)},
    valid={resultKind:'probed',container:'matroska',videoStreams:[{codec:'hevc',width:1920,height:1080}],
      audioStreams:[{codec:'dts',normalizedAudioClass:'dts_hd_ma'}]};
  context.raw.materials=[{role:'primary_payload',material_key:canonicalDigest('primary'),location:'/shelf/movie.mkv',size_bytes:100}];
  assert.deepEqual(probeConformance(context,valid),[]);
  assert.equal(effectiveRequirements(context).space.maxSizeGiB,50);
  assert.deepEqual(effectiveRequirements(context).mandatoryMedia.acceptedPrimaryAudioClasses,requirements().mandatoryMedia.acceptedPrimaryAudioClasses);
  assert.ok(probeConformance(context,{...valid,audioStreams:[{codec:'aac'}]}).some(item=>item.schemaRef.includes('/primary_audio_unmet/')));
  assert.ok(probeConformance(context,{...valid,resultKind:'not_media'}).some(item=>item.schemaRef.includes('/primary_decode_failed/')));
  context.raw.materials[0].size_bytes=51*1024**3;
  assert.ok(probeConformance(context,valid).some(item=>item.schemaRef.includes('/max_size_exceeded/')));
  context.raw.materials[0].size_bytes=100;context.raw.collectionTarget=target(requirements(),{kind:'standard',revision:2});
  assert.ok(probeConformance(context,valid).some(item=>item.schemaRef.includes('/minimum_raster_unmet/')));
});

test('collection target projections reject corruption, foreign Entry or Inventory, and weakened safety',()=>{
  const original=target(customRequirements());
  for(const change of [value=>{value.shelfId='foreign';},value=>{value.inventoryRevision=2;},
    value=>{value.requirements.inventory.requireChecksum=false;},value=>{value.requirements.identity.identityKind='internal_identity';}]){
    const value=structuredClone(original);change(value);value.requirementsDigest=canonicalDigest(value.requirements);
    value.projectionDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='projectionDigest')));
    assert.throws(()=>assertCollectionCareTarget(value,'entry',{shelfId:'shelf',inventoryRevision:1}),{code:'ARCA_COLLECTION_TARGET_INVALID'});
  }
  assert.throws(()=>assertCollectionCareTarget({...original,unexpected:true},'entry'),{code:'ARCA_COLLECTION_TARGET_INVALID'});
});

test('detail and batched health bind their basis to the same fenced current target',()=>{
  let current=target(customRequirements()),stale=false;const stored=raw(null),token={},unitOfWork={captureReadFence:()=>token,
    assertReadFence(value){assert.equal(value,token);if(stale)throw Object.assign(new Error('changed'),{code:'P3_UOW_READ_FENCE_CHANGED'});}},
    item={shelfEntryId:'entry',shelfId:'shelf',structureKind:'single',inventoryRevision:1,standardRevision:1,placementRevision:1,
      canonicalIdentity:stored.identity,canonicalIdentityDigest:stored.identity.identity_digest,sourcePackageId:'package',
      materialRoles:[],standardValue:stored.standard.value,acceptedPackageReference:null,decisionFacts:[],factDigests:[],decisionFactDigests:[],
      authorizedDefectManifest:null,history:{assessments:[],findings:[],cases:[],commits:[]}},
    aftercareStore={assertReadFence(value){unitOfWork.assertReadFence(value);},currentContext:()=>stored,healthProjectionInputs:()=>[item],defectStore:{current:()=>null,currentMany:()=>new Map()},
      healthAssessmentHistory:()=>new Map([['entry',{assessments:[],findings:[]} ]])},
    collectionTargetPort={readMany(ids,{readFence}){assert.equal(readFence,token);return new Map(ids.map(id=>[id,current]));}},
    reader=createAftercareContextReader({aftercareStore,unitOfWork,collectionTargetPort});
  const detail=reader.read('entry'),batch=reader.healthProjectionInputs(['entry'])[0];
  assert.deepEqual(effectiveRequirements(detail),current.requirements);assert.deepEqual(batch.effectiveRequirements,current.requirements);
  assert.equal(detail.basis.digest,batch.basis.digest);
  current=target(requirements(),{kind:'standard',revision:2});const restored=reader.read('entry');
  assert.notEqual(restored.basis.digest,detail.basis.digest);assert.equal(effectiveRequirements(restored).mandatoryMedia.minimumRasterClass,'4k');
  stale=true;assert.throws(()=>reader.read('entry'),{code:'P3_UOW_READ_FENCE_CHANGED'});
  const incomplete=createAftercareContextReader({aftercareStore:{...aftercareStore,assertReadFence(){}},unitOfWork,collectionTargetPort:{readMany:()=>new Map()}});
  assert.throws(()=>incomplete.read('entry'),{code:'ARCA_COLLECTION_TARGET_READER_UNAVAILABLE'});
});

test('custom optional poster does not recur as missing, but loss of a registered poster remains damage',async()=>{
  const context=require('./fixtures/jav-correction').context();context.shelfEntryId='entry';context.raw=raw(target(customRequirements()));
  context.basis={digest:canonicalDigest('basis'),inventoryRevision:1,standardRevision:1,placementRevision:1,
    decisionFactSetDigest:canonicalDigest('decision')};
  const ports=createAftercareCapabilityPorts({schemaManifest,unitOfWork:{execute(){throw new Error('No writes expected.');}},
    contextReader:{read:()=>context,store:{history:()=>({cases:[],findings:[],commits:[]})}},workResultReader:{read:()=>[]},
    computeBoundedMaterialFingerprintSync(){throw new Error('No media read expected.');},now:()=>1000});
  const observe=async()=>ports[C.presentation].execute({ownerScope:{processId:'entry'},workId:'assessment'});
  const absent=await observe();assert.equal(absent.result.findingDrafts.some(item=>item.schemaRef.includes('/poster_missing/')),false);
  context.raw.materials=[{role:'poster',material_key:'registered-poster',location:'Z:/missing-poster-for-test.jpg'}];
  const lost=await observe();assert.equal(lost.result.findingDrafts.some(item=>item.schemaRef.includes('/poster_missing/')),true);
});

test('real SQLite aftercare reader verifies read fences inside a kernel transaction',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aftercare-fence-'));
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'shelfdeck.db'),schemaManifest,schemaDdl,now:()=>1000});
  const unitOfWork=createSqliteUnitOfWork({kernel});
  const aftercareStore=createAftercareStore({schemaManifest,unitOfWork,now:()=>1000});
  const collectionTargetStore=createCollectionTargetStore({schemaManifest,unitOfWork});
  const stable=(schema,value)=>canonicalDigest({schema,...value});
  const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
  try{
    const pkgDigest=canonicalDigest('pkg'),attemptId='attempt-1',decisionId='decision-1',custodyId='custody-1',
      onDeckRunId='ondeck-1',entryId='entry-1',shelfId='shelf-1',standard={profileRuleSets:[{contentProfile:'movie',
        decisionInputKinds:[],baseRequirements:requirements()}]};
    const decisionBase={schemaRef:'helix://contracts/domain-types/ArcaAcceptanceDecision/v1',schemaVersion:1,
      acceptanceDecisionId:decisionId,acceptanceAttemptId:attemptId,result:'accepted',offerId:'offer-1',
      onDeckPackageId:'pkg-1',packageDigest:pkgDigest,shelfId,standardRevision:1,placementRevision:1,
      acceptanceEvidenceSetDigest:canonicalDigest('ev'),acceptanceCheckSetDigest:canonicalDigest('chk'),
      actualGapUnionCodes:[],actualGapUnionDigest:canonicalDigest([]),authorizedDefectManifestDigestOrNull:null,
      authorizedGapComparison:'not_applicable',arcaBindingSetDigest:canonicalDigest('bind'),
      controlScopeDigest:canonicalDigest('ctrl')};
    const decision={...decisionBase,decisionDigest:canonicalDigest(decisionBase)};
    const receipt={receiptId:'hb-receipt-1',acceptanceDecisionId:decisionId,outcome:'accepted'};
    const resultId=stable('arca.handoff-b-accepted-result@1',{acceptanceDecisionId:decisionId});
    const markerId=stable('arca.handoff-b-accepted-marker@1',{acceptanceDecisionId:decisionId,decisionDigest:decision.decisionDigest});
    kernel.runPrimitive(({prepare})=>{
      prepare('INSERT INTO arca_shelves(shelf_id,name,target_endpoint_id,target_root_location,target_mount_scope_id,target_mount_scope_revision,status,current_standard_revision,current_placement_revision,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(shelfId,'Movies','ep','/shelf','ms',1,'active',1,1,1000);
      prepare('INSERT INTO arca_shelf_standard_revisions(shelf_id,revision,standard_schema_ref,standard_json,standard_digest,effective_at_ms) VALUES(?,?,?,?,?,?)')
        .run(shelfId,1,'helix://contracts/domain-types/Standard/v1',canonicalJson(standard),canonicalDigest(standard),1000);
      prepare('INSERT INTO arca_placement_policy_revisions(shelf_id,revision,policy_schema_ref,policy_json,policy_digest,effective_at_ms) VALUES(?,?,?,?,?,?)')
        .run(shelfId,1,'helix://contracts/types/PlacementPolicy/v1','{}',canonicalDigest({}),1000);
      prepare('INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,structure_kind,status,canonical_identity_revision,canonical_identity_key,current_inventory_revision,current_deck_fact_revision,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(entryId,shelfId,'single','active',1,'tmdb:movie:1',1,1,1000);
      prepare('INSERT INTO arca_canonical_identity_revisions(shelf_entry_id,revision,structure_kind,identity_kind,provider,provider_key,identity_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?)')
        .run(entryId,1,'single','tmdb_movie','tmdb','1',canonicalDigest('id-1'),1000);
      prepare('INSERT INTO arca_inventory_representations(shelf_entry_id,revision,source_package_id,representation_digest,committed_at_ms) VALUES(?,?,?,?,?)')
        .run(entryId,1,'pkg-1',canonicalDigest('inv-1'),1000);
      prepare('INSERT INTO arca_deck_fact_revisions(shelf_entry_id,revision,state,inventory_revision,standard_revision,fact_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?)')
        .run(entryId,1,'active',1,1,canonicalDigest('deck-1'),1000);
      prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
        .run(attemptId,'offer-1','pkg-1',pkgDigest,shelfId,'accepted');
      prepare('INSERT INTO arca_acceptance_decisions(acceptance_decision_id,acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,result,decision_digest) VALUES(?,?,?,?,?,?,?,?)')
        .run(decisionId,attemptId,'offer-1','pkg-1',pkgDigest,shelfId,'accepted',decision.decisionDigest);
      prepare('INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state) VALUES(?,?,?,?,?)')
        .run(custodyId,decisionId,'pkg-1',pkgDigest,'committed');
      prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES(?,?,?)').run(onDeckRunId,custodyId,'committed');
      prepare('INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision) VALUES(?,?,?,?,?)')
        .run('commit-1',onDeckRunId,entryId,1,1);
      prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(resultId,null,'succeeded','arca.handoff-b-accepted-receipt@1',canonicalJson(receipt),canonicalDigest(receipt),
          'helix://contracts/domain-types/ArcaAcceptanceDecision/v1',canonicalJson(decision),decision.decisionDigest,1000);
      prepare('INSERT INTO fx_commit_markers(commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,result_id,result_schema_ref,result_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(markerId,null,'arca','acceptance_decision',decisionId,decision.decisionDigest,resultId,'arca.handoff-b-accepted-receipt@1',canonicalDigest(receipt),1000);
    });
    const reader=createAftercareContextReader({aftercareStore,unitOfWork,collectionTargetPort:collectionTargetStore});
    const detail=reader.read(entryId);
    const batch=reader.healthProjectionInputs([entryId]);
    assert.equal(detail.shelfEntryId,entryId);
    assert.equal(detail.raw.collectionTarget,null);
    assert.equal(batch.length,1);
    assert.equal(batch[0].basis.digest,detail.basis.digest);
    const racingReader=createAftercareContextReader({aftercareStore,unitOfWork,collectionTargetPort:{
      readMany(ids,opts){
        kernel.runPrimitive(({prepare})=>{
          prepare('UPDATE arca_shelves SET updated_at_ms=updated_at_ms+1 WHERE shelf_id=?').run(shelfId);
        });
        return collectionTargetStore.readMany(ids,opts);
      },
    }});
    assert.throws(()=>racingReader.read(entryId),{code:'P3_UOW_READ_FENCE_CHANGED'});
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
