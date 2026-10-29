'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {describeCustomRequirement}=require('../../src/helix/contracts/custom-acceptance-requirements');
const {createCustomTargetApplication}=require('../../src/helix/domains/libra/application/custom-target-application');
const {createLibraCustomTargetConfirmationReader}=require('../../src/helix/domains/libra/public');
const {verifyArcaCustomAcceptanceTarget}=require('../../src/helix/domains/arca/model/custom-acceptance-target');
const {buildAcceptanceRequirementSnapshot}=require('../../src/helix/domains/libra/model/acceptance-requirement-snapshot');
const {createHandoffBAcceptanceStore}=require('../../src/helix/domains/arca/persistence/handoff-b-acceptance-store');
const {createOnDeckStore}=require('../../src/helix/domains/arca/persistence/on-deck-store');
const {finalGapDecision}=require('../../src/helix/domains/arca/model/acceptance-gap-decision');
const {projectMaterialControlRow}=require('../../src/helix/foundation/persistence/material-control');
const {harness}=require('./fixtures/custom-spec-publication-harness');

function applicationHarness(callback){return harness(h=>{
  let available=true,basis={...h.chosen.intent.basis,customTargetRevision:1},clock=2000,failCommit=false,readHook=()=>{},baselineChange={};
  const unitOfWork={...h.unitOfWork,execute(participants,...args){
    const domain=participants.find(item=>item.participantId==='custom_target_commit');
    if(failCommit&&domain){failCommit=false;return h.unitOfWork.execute([...participants,
      {...domain,participantId:'custom_target_interruption',execute(){throw new Error('injected after command foundation');}}],...args);}
    return h.unitOfWork.execute(participants,...args);
  }};
  const evidenceRefs=h.chosen.preview.proposals[0].evidenceRefs,proposals=[
    {requirementCode:'minimum_raster_unmet',targetId:'minimumRasterClass'},
    {requirementCode:'primary_audio_unmet',targetId:'acceptedPrimaryAudioClasses'},
  ].map(change=>({change:describeCustomRequirement(h.base.requirements,change),evidenceRefs})),
    currentViewReader={read:()=>{readHook();return available===true?{kind:'ready',basis,requirements:h.base.requirements,episodeScopes:[],proposals}:
      available===false?{kind:'pending'}:available;}},
    readCurrentCustomTargetBaseline=()=>({kind:'ready',subjectId:basis.subjectId,productScopeDigest:basis.productScopeDigest,
      standardSpecDigest:basis.baseSpecDigest,shelfId:basis.shelfId,shelfStandardRevision:basis.shelfStandardRevision,
      shelfStandardDigest:basis.shelfStandardDigest,identityDigest:basis.identityDigest,handoffState:basis.handoffState,...baselineChange}),
    app=createCustomTargetApplication({...h.options,unitOfWork,currentViewReader,readCurrentCustomTargetBaseline,
      customTargetStore:h.targets,now:()=>clock++}),
    preview=(actor='admin',idempotencyKey='preview-command')=>app.preparePreview(actor,{subjectId:'subject',
      libraRunId:h.chosen.intent.basis.libraRunId,idempotencyKey}),
    confirm=(actor,record,idempotencyKey='confirm-command',selected=record.proposals.map(item=>item.changeDigest))=>app.confirm(actor,{
      previewDigest:record.previewDigest,selectedChangeDigests:selected,acknowledged:true,idempotencyKey});
  return callback({...h,app,preview,confirm,setAvailable:value=>{available=value;},setBasis:value=>{basis={...basis,...value};},
    interruptNextCommit:()=>{failCommit=true;},setReadHook:value=>{readHook=value;},setBaseline:value=>{baselineChange=value;}});
});}

test('server preview and confirmation atomically preserve facts and replay the same exact command',()=>applicationHarness(h=>{
  const old=h.counts(),preview=h.preview(),specCount=h.db.prepare('SELECT COUNT(*) n FROM libra_acceptance_specs').get().n;
  assert.equal(preview.kind,'preview');assert.equal(preview.replayed,false);assert.equal(preview.record.proposals.length,2);
  const shown=canonicalJson(h.app.readPreview('admin',preview.record.previewDigest));
  assert.equal(shown,canonicalJson(preview.record));
  assert.throws(()=>h.app.readPreview('other',preview.record.previewDigest),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_NOT_FOUND'});
  const confirmed=h.confirm('admin',preview.record),intent=confirmed.record;
  assert.equal(confirmed.kind,'confirmed');assert.equal(intent.revision,2);assert.equal(intent.target.requirements.space.maxSizeGiB,50);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM libra_acceptance_specs').get().n,specCount,'Confirmation does not publish a Spec.');
  assert.equal(h.targets.current({subjectId:'subject',productScopeDigest:intent.basis.productScopeDigest}).intentId,intent.intentId);
  assert.equal(h.counts()[1],old[1]+1);
  h.setAvailable(false);
  assert.equal(h.preview().record.previewDigest,preview.record.previewDigest);
  const replay=h.confirm('admin',preview.record);assert.equal(replay.replayed,true);assert.equal(replay.record.intentDigest,intent.intentDigest);
  assert.throws(()=>h.confirm('admin',preview.record,'confirm-command',[preview.record.proposals[0].changeDigest]),
    {code:'LIBRA_CUSTOM_TARGET_IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>h.app.confirm('admin',{previewDigest:'unknown-preview',selectedChangeDigests:intent.selectedChangeDigests,
    acknowledged:true,idempotencyKey:'confirm-command'}),{code:'LIBRA_CUSTOM_TARGET_IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>h.app.confirm('admin',{previewDigest:preview.record.previewDigest,selectedChangeDigests:intent.selectedChangeDigests,
    acknowledged:false,idempotencyKey:'confirm-command'}),{code:'LIBRA_CUSTOM_TARGET_IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
}));

test('stale or unavailable Owner facts do not commit a preview or confirmation',()=>applicationHarness(h=>{
  const before=h.counts();h.setAvailable(false);
  assert.equal(h.preview().kind,'evidence_pending');assert.deepEqual(h.counts(),before);
  h.setAvailable({kind:'unexpected'});
  assert.throws(()=>h.preview(),{code:'LIBRA_CUSTOM_TARGET_VIEW_INVALID'});assert.deepEqual(h.counts(),before);
  h.setAvailable(true);const preview=h.preview();
  h.setBasis({gapEvidenceSetDigest:canonicalDigest('changed-gap-evidence')});
  const afterPreview=h.counts();
  assert.throws(()=>h.confirm('admin',preview.record),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});
  assert.deepEqual(h.counts(),afterPreview);
  assert.throws(()=>h.app.preparePreview('admin',{subjectId:'subject',libraRunId:h.chosen.intent.basis.libraRunId,
    idempotencyKey:'forged',basis:h.chosen.intent.basis}),{code:'LIBRA_CUSTOM_TARGET_COMMAND_INVALID'});
}));

test('Owner changes while preparing a preview invalidate the captured read fence',()=>applicationHarness(h=>{
  const before=h.counts();h.setReadHook(()=>h.db.exec("UPDATE libra_subjects SET intake_revision=intake_revision+1"));
  assert.throws(()=>h.preview(),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.deepEqual(h.counts(),before);
}));

test('current standard and Arca responsibility are required before preview and confirmation',()=>applicationHarness(h=>{
  const before=h.counts();h.setBaseline({kind:'unavailable'});
  assert.equal(h.preview().kind,'evidence_pending');assert.deepEqual(h.counts(),before);
  h.setBaseline({standardSpecDigest:canonicalDigest('different-current-rating')});
  assert.throws(()=>h.preview(),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});assert.deepEqual(h.counts(),before);
  h.setBaseline({handoffState:'accepted'});
  assert.throws(()=>h.preview(),{code:'LIBRA_CUSTOM_TARGET_ARCA_RESPONSIBILITY'});assert.deepEqual(h.counts(),before);
  h.setBaseline({});const preview=h.preview(),afterPreview=h.counts();
  h.setBaseline({shelfStandardDigest:canonicalDigest('different-shelf')});
  assert.throws(()=>h.confirm('admin',preview.record),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});
  assert.deepEqual(h.counts(),afterPreview);
}));

test('concurrent confirmations cannot both advance the same scoped revision',()=>applicationHarness(h=>{
  const first=h.preview('alice','preview-alice'),second=h.preview('bob','preview-bob');
  const accepted=h.confirm('alice',first.record,'alice-confirm');
  assert.equal(accepted.record.revision,2);
  const before=h.counts();
  assert.throws(()=>h.confirm('bob',second.record,'bob-confirm'),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});
  assert.deepEqual(h.counts(),before);
  assert.equal(h.targets.current({subjectId:'subject',productScopeDigest:accepted.record.basis.productScopeDigest}).intentId,accepted.record.intentId);
}));

test('confirmation interruption rolls back Owner facts, head, receipt, marker and audit together',()=>applicationHarness(h=>{
  const preview=h.preview(),before=h.counts(),head=h.targets.current({subjectId:'subject',productScopeDigest:preview.record.basis.productScopeDigest});
  h.interruptNextCommit();
  assert.throws(()=>h.confirm('admin',preview.record),/injected after command foundation/);
  assert.deepEqual(h.counts(),before);
  assert.equal(h.targets.current({subjectId:'subject',productScopeDigest:preview.record.basis.productScopeDigest}).intentDigest,head.intentDigest);
  assert.equal(h.confirm('admin',preview.record).record.revision,2);
}));

test('replay validates Foundation receipt rather than trusting the Owner record alone',()=>applicationHarness(h=>{
  const preview=h.preview();h.confirm('admin',preview.record);
  h.db.prepare("UPDATE fx_command_receipts SET result_digest=? WHERE command_contract=?").run('0'.repeat(64),'libra.custom-target.confirm@1');
  assert.throws(()=>h.confirm('admin',preview.record),{code:'P3_COMMAND_RECEIPT_CORRUPT'});
  h.db.prepare("DELETE FROM fx_command_receipts WHERE command_contract=?").run('libra.custom-target.preview@1');
  assert.throws(()=>h.preview(),{code:'LIBRA_CUSTOM_TARGET_RECEIPT_MISSING'});
}));

function publishedConfirmation(h,onlyRaster=false){
  const shown=h.preview(),selected=shown.record.proposals.filter(item=>!onlyRaster||item.change.targetId==='minimumRasterClass')
    .map(item=>item.changeDigest),confirmed=h.confirm('admin',shown.record,'confirm-command',selected),intent=confirmed.record,
    published=h.publisher.publish({intentId:intent.intentId,intentDigest:intent.intentDigest,
      currentBasis:{...intent.basis,customTargetRevision:intent.revision},
      readFence:h.unitOfWork.captureReadFence(),producedAtMs:1200}),spec=h.publisher.read(published.receipt.resultRef.acceptanceSpecId),
    request={subjectId:intent.subjectId,productScopeDigest:intent.basis.productScopeDigest,acceptanceSpecId:spec.acceptanceSpecId,
      acceptanceSpecRecordDigest:spec.recordDigest,intentId:intent.intentId,intentDigest:intent.intentDigest,previewDigest:shown.record.previewDigest},
    reader=createLibraCustomTargetConfirmationReader({...h.options,customTargetStore:h.targets,customSpecPublicationStore:h.publisher});
  return {shown,intent,spec,request,reader};
}

test('public confirmation evidence reconstructs exact Preview, Intent, original and custom Spec with three durable command proofs',()=>applicationHarness(h=>{
  const {shown,intent,spec,request,reader}=publishedConfirmation(h),before=h.counts(),result=reader.read(request),evidence=result.evidence;
  assert.equal(result.kind,'ready');assert.equal(evidence.actorId,'admin');assert.equal(evidence.intentDigest,intent.intentDigest);
  assert.equal(evidence.previewDigest,shown.record.previewDigest);assert.equal(evidence.baseSpecRecordDigest,h.base.recordDigest);
  assert.equal(evidence.acceptanceSpecRecordDigest,spec.recordDigest);
  assert.equal(evidence.publicationProof.committedAtMs,spec.publishedAtMs);
  assert.deepEqual(result.records.baseSpec,h.base);assert.deepEqual(result.records.intent,intent);assert.deepEqual(result.records.spec,spec);
  assert.equal(evidence.evidenceDigest,canonicalDigest(Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='evidenceDigest'))));
  assert.equal(Object.isFrozen(result.records.preview.proposals),true);assert.deepEqual(h.counts(),before);
  assert.deepEqual(reader.read(request,{readFence:result.readFence}).evidence,evidence);
  for(const [field,value] of [['acceptanceSpecRecordDigest',canonicalDigest('other-spec')],['subjectId','other'],
    ['intentDigest',canonicalDigest('other-intent')],['previewDigest',canonicalDigest('other-preview')]])
    assert.throws(()=>reader.read({...request,[field]:value}),{code:'LIBRA_CUSTOM_TARGET_CONFIRMATION_INVALID'});
  assert.throws(()=>reader.read({...request,actorId:'admin'}),{code:'LIBRA_CUSTOM_TARGET_CONFIRMATION_INVALID'});
  h.db.exec('UPDATE libra_subjects SET intake_revision=intake_revision+1');
  assert.throws(()=>reader.read(request,{readFence:result.readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
}));

for(const corruption of ['missing_preview_receipt','wrong_preview_actor','missing_confirmation_receipt','wrong_confirmation_scope',
  'substituted_confirmation_result','missing_confirmation_marker','wrong_confirmation_marker','missing_confirmation_audit',
  'wrong_confirmation_actor','missing_publication_receipt','wrong_publication_result','wrong_publication_head_revision','wrong_publication_audit'])
  test('public confirmation evidence rejects '+corruption,()=>applicationHarness(h=>{
    const {request,reader}=publishedConfirmation(h),evidence=reader.read(request).evidence,
      preview=evidence.previewProof.commandReceiptId,confirmation=evidence.confirmationProof.commandReceiptId,
      publication=evidence.publicationProof.commandReceiptId;
    if(corruption==='missing_preview_receipt')h.db.prepare('DELETE FROM fx_command_receipts WHERE command_receipt_id=?').run(preview);
    if(corruption==='wrong_preview_actor')h.db.prepare('UPDATE fx_audit_records SET actor_id=? WHERE audit_id=?').run('other',preview);
    if(corruption==='missing_confirmation_receipt')h.db.prepare('DELETE FROM fx_command_receipts WHERE command_receipt_id=?').run(confirmation);
    if(corruption==='wrong_confirmation_scope')h.db.prepare('UPDATE fx_command_receipts SET target_id=? WHERE command_receipt_id=?').run('other-run',confirmation);
    if(corruption==='substituted_confirmation_result'){
      const value={recordId:canonicalDigest('other-record'),recordDigest:request.intentDigest};
      h.db.prepare('UPDATE fx_command_receipts SET result_ref_json=?,result_digest=? WHERE command_receipt_id=?')
        .run(canonicalJson(value),canonicalDigest(value),confirmation);
    }
    if(corruption==='missing_confirmation_marker')h.db.prepare('DELETE FROM fx_commit_markers WHERE commit_marker=?').run(confirmation);
    if(corruption==='wrong_confirmation_marker')h.db.prepare('UPDATE fx_commit_markers SET commit_digest=? WHERE commit_marker=?').run(canonicalDigest('other'),confirmation);
    if(corruption==='missing_confirmation_audit')h.db.prepare('DELETE FROM fx_audit_records WHERE audit_id=?').run(confirmation);
    if(corruption==='wrong_confirmation_actor')h.db.prepare('UPDATE fx_audit_records SET actor_id=? WHERE audit_id=?').run('other',confirmation);
    if(corruption==='missing_publication_receipt')h.db.prepare('DELETE FROM fx_command_receipts WHERE command_receipt_id=?').run(publication);
    if(corruption==='wrong_publication_result'){
      const row=h.db.prepare('SELECT result_ref_json FROM fx_command_receipts WHERE command_receipt_id=?').get(publication),value=JSON.parse(row.result_ref_json);
      value.acceptanceSpecId=canonicalDigest('other-spec');
      h.db.prepare('UPDATE fx_command_receipts SET result_ref_json=?,result_digest=? WHERE command_receipt_id=?')
        .run(canonicalJson(value),canonicalDigest(value),publication);
    }
    if(corruption==='wrong_publication_head_revision'){
      const row=h.db.prepare('SELECT result_ref_json FROM fx_command_receipts WHERE command_receipt_id=?').get(publication),value=JSON.parse(row.result_ref_json);
      value.committedHeadRevision++;
      h.db.prepare('UPDATE fx_command_receipts SET result_ref_json=?,result_digest=? WHERE command_receipt_id=?')
        .run(canonicalJson(value),canonicalDigest(value),publication);
    }
    if(corruption==='wrong_publication_audit')h.db.prepare('UPDATE fx_audit_records SET evidence_digest=? WHERE audit_id=?').run(canonicalDigest('other'),publication);
    assert.throws(()=>reader.read(request),{code:'LIBRA_CUSTOM_TARGET_CONFIRMATION_INVALID'});
  }));

test('public confirmation evidence rejects a concurrent Owner change before completing its fenced read',()=>applicationHarness(h=>{
  const {request}=publishedConfirmation(h),reader=createLibraCustomTargetConfirmationReader({...h.options,customTargetStore:h.targets,
    customSpecPublicationStore:{read(id){const spec=h.publisher.read(id);h.db.exec('UPDATE libra_subjects SET intake_revision=intake_revision+1');return spec;}}});
  assert.throws(()=>reader.read(request),{code:'P3_UOW_READ_FENCE_CHANGED'});
}));

test('a synthetic Owner intent and Spec without the formal Preview and confirmation commands is not confirmation evidence',()=>harness(h=>{
  const spec=h.publisher.read(h.publish().receipt.resultRef.acceptanceSpecId),intent=h.chosen.intent,
    reader=createLibraCustomTargetConfirmationReader({...h.options,customTargetStore:h.targets,customSpecPublicationStore:h.publisher});
  assert.throws(()=>reader.read({subjectId:intent.subjectId,productScopeDigest:intent.basis.productScopeDigest,
    acceptanceSpecId:spec.acceptanceSpecId,acceptanceSpecRecordDigest:spec.recordDigest,intentId:intent.intentId,
    intentDigest:intent.intentDigest,previewDigest:intent.previewDigest}),{code:'LIBRA_CUSTOM_TARGET_CONFIRMATION_INVALID'});
}));

function arcaTargetFixture(h){
  const {reader,request,intent,spec}=publishedConfirmation(h,true),confirmation=reader.read(request),
    structureBody={structureKind:'single',contentProfile:'movie',productScopeDigest:spec.productScope.scopeDigest,
      episodeScopeDigest:canonicalDigest('no-episode-claims'),primaryMaterialCount:1,structuralDependencyCount:0},
    requirementSnapshot=buildAcceptanceRequirementSnapshot(spec);
  return {reader,request,confirmation,shelf:{shelfId:spec.targetShelfId,status:'active',currentStandardRevision:spec.shelfStandardRevision,
    standard:{digest:spec.shelfStandardDigest}},packageValue:{subjectId:spec.subjectId,shelfId:spec.targetShelfId,
    acceptanceSpecRef:{id:spec.acceptanceSpecId,recordDigest:spec.recordDigest},
    resolvedIdentitySnapshot:{factDigest:intent.basis.identityDigest,factValue:{resolvedProductIdentity:{identityKind:'tmdb_movie',
      contentProfile:'movie',structureKind:'single'}}},
    productStructureSnapshot:{...structureBody,productStructureDigest:canonicalDigest(structureBody)},
    productionProvenance:{acceptanceRequirementSnapshot:requirementSnapshot}}};
}

test('Arca independently reconstructs the confirmed Movie requirement delta while retaining audio and size',()=>applicationHarness(h=>{
  const input=arcaTargetFixture(h),basis=verifyArcaCustomAcceptanceTarget(input),base=h.base.requirements;
  assert.equal(basis.originalSpecId,h.base.acceptanceSpecId);assert.equal(basis.customRequirements.mandatoryMedia.minimumRasterClass,'none');
  assert.deepEqual(basis.customRequirements.mandatoryMedia.acceptedPrimaryAudioClasses,base.mandatoryMedia.acceptedPrimaryAudioClasses);
  assert.deepEqual(basis.customRequirements.space,base.space);assert.equal(basis.customRequirements.space.maxSizeGiB,50);
  assert.deepEqual(basis.customRequirements.identity,base.identity);assert.deepEqual(basis.customRequirements.structure,base.structure);
  assert.equal(basis.basisDigest,canonicalDigest(Object.fromEntries(Object.entries(basis).filter(([key])=>key!=='basisDigest'))));
}));

for(const corruption of ['shelf_revision','shelf_digest','subject','scope','identity','snapshot_requirements','handoff_reference',
  'confirmation_actor','intent_selection','custom_spec_requirements','original_requirements','missing_fence'])
  test('Arca custom target precheck rejects '+corruption,()=>applicationHarness(h=>{
    const source=arcaTargetFixture(h),input={packageValue:structuredClone(source.packageValue),shelf:structuredClone(source.shelf),
      confirmation:{...source.confirmation,evidence:structuredClone(source.confirmation.evidence),records:structuredClone(source.confirmation.records)}};
    if(corruption==='shelf_revision')input.shelf.currentStandardRevision++;
    if(corruption==='shelf_digest')input.shelf.standard.digest=canonicalDigest('changed-standard');
    if(corruption==='subject')input.packageValue.subjectId='other';
    if(corruption==='scope')input.packageValue.productStructureSnapshot.productScopeDigest=canonicalDigest('other-scope');
    if(corruption==='identity')input.packageValue.resolvedIdentitySnapshot.factDigest=canonicalDigest('other-identity');
    if(corruption==='snapshot_requirements'){
      const snapshot=input.packageValue.productionProvenance.acceptanceRequirementSnapshot;snapshot.requirements.space.maxSizeGiB=51;
      snapshot.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=='snapshotDigest')));
    }
    if(corruption==='handoff_reference'){
      const snapshot=input.packageValue.productionProvenance.acceptanceRequirementSnapshot;
      snapshot.customAcceptanceHandoff.originalSpec.specDigest=canonicalDigest('other-standard');
      snapshot.customAcceptanceHandoff.referenceDigest=canonicalDigest(Object.fromEntries(Object.entries(snapshot.customAcceptanceHandoff)
        .filter(([key])=>key!=='referenceDigest')));
      snapshot.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=='snapshotDigest')));
    }
    if(corruption==='confirmation_actor'){
      input.confirmation.evidence.actorId='other';const evidence=input.confirmation.evidence;
      evidence.evidenceDigest=canonicalDigest(Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='evidenceDigest')));
    }
    if(corruption==='intent_selection')input.confirmation.records.intent.selectedChangeDigests=[canonicalDigest('unshown-change')];
    if(corruption==='custom_spec_requirements')input.confirmation.records.spec.requirements.space.maxSizeGiB=51;
    if(corruption==='original_requirements')input.confirmation.records.baseSpec.requirements.identity.required=false;
    if(corruption==='missing_fence')input.confirmation.readFence=null;
    assert.throws(()=>verifyArcaCustomAcceptanceTarget(input),{code:'ARCA_CUSTOM_TARGET_INVALID'});
  }));

test('real Arca Handoff B transaction fences and records the exact confirmed custom basis',()=>applicationHarness(h=>{
  const input=arcaTargetFixture(h),db=h.db,store=createHandoffBAcceptanceStore(h.options),D=canonicalDigest,
    shelf={...input.shelf,currentPlacementRevision:1,target:{endpointId:'endpoint',rootLocation:'/shelf',mountScopeId:'shelf-mount',mountScopeRevision:1}};
  db.pragma('foreign_keys=OFF');
  db.prepare('INSERT INTO arca_shelves(shelf_id,target_endpoint_id,target_root_location,target_mount_scope_id,target_mount_scope_revision,status,current_standard_revision,current_placement_revision) VALUES(?,?,?,?,?,?,?,?)')
    .run(shelf.shelfId,'endpoint','/shelf','shelf-mount',1,'active',shelf.currentStandardRevision,1);
  db.prepare('INSERT INTO arca_shelf_standard_revisions(shelf_id,revision,standard_json,standard_digest) VALUES(?,?,?,?)')
    .run(shelf.shelfId,shelf.currentStandardRevision,'{}',shelf.standard.digest);
  db.prepare('INSERT INTO arca_placement_policy_revisions(shelf_id,revision,policy_json,policy_digest) VALUES(?,?,?,?)')
    .run(shelf.shelfId,1,'{}',D('placement'));
  const physical={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'source-mount',
    inode:'1',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('bytes')};
  physical.materialKey=D({schema:'physical-material-identity@2',mountScopeId:physical.mountScopeId,inode:physical.inode,
    sizeBytes:physical.sizeBytes,fingerprintAlgorithm:physical.fingerprintAlgorithm,fingerprintVersion:physical.fingerprintVersion,
    contentFingerprint:physical.contentFingerprint});
  db.prepare('INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(physical.materialKey,physical.mountScopeId,physical.inode,physical.sizeBytes,physical.fingerprintAlgorithm,'1',
      physical.contentFingerprint,'libra','subject','subject',1,'controlled',0);
  const projection=projectMaterialControlRow(physical.materialKey,db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(physical.materialKey));
  const episodeClaimSetDigest=D({schema:'libra.production-material-episode-claims@1',items:[]}),
    packageValue={...input.packageValue,onDeckPackageId:'package',packageDigest:D('package'),
    productMaterialManifest:{manifestDigest:D('product-manifest'),members:[{materialKey:physical.materialKey,role:'primary_payload',episodeClaims:[],episodeClaimSetDigest}]},
    offloadContextManifest:{manifestDigest:D('offload-manifest'),members:[]}};
  const offer={offerId:'offer',onDeckPackageId:'package',packageDigest:packageValue.packageDigest,libraRunId:'run-1'},
    attemptId=D({schema:'arca.acceptance-attempt-id@1',offerId:offer.offerId,onDeckPackageId:offer.onDeckPackageId,
      packageDigest:offer.packageDigest,standardRevision:shelf.currentStandardRevision,placementRevision:1});
  const emptyGap=kind=>D({schema:'arca.acceptance-check-actual-gap-set@1',checkKind:kind,items:[]}),
    observationBody={ordinal:0,actualGapCodes:[],actualGapSetDigest:emptyGap('mandatory_media')},
    observation={...observationBody,observationDigest:D(observationBody)},
    acceptanceChecks=['identity','mandatory_media','metadata','space','structure'].map(kind=>{
      const observations=kind==='mandatory_media'?[observation]:[];
      return {schemaRef:'helix://contracts/types/AcceptanceCheck/v1',acceptanceAttemptId:attemptId,packageDigest:offer.packageDigest,
        standardRevision:shelf.currentStandardRevision,checkKind:kind,result:'passed',evidenceStatus:'complete',reasonCodes:[],
        actualGapCodes:[],actualGapSetDigest:emptyGap(kind),missingMetadataFields:[],missingArtifactKinds:[],
        primaryMediaObservations:observations,primaryMediaObservationSetDigest:D({schema:'arca.mandatory-media-primary-observation-set@1',items:observations}),
        authorizedDefectManifestDigestOrNull:null,authorizedGapComparison:'not_applicable'};
    }),gapDecision=finalGapDecision({acceptanceChecks,acceptanceAttemptId:attemptId,packageDigest:offer.packageDigest,
      standardRevision:shelf.currentStandardRevision}),
    checks=[...acceptanceChecks.map(item=>({kind:item.checkKind,outcome:'passed',evidenceDigest:D(item)})),
      {kind:'inventory_feasibility',outcome:'passed',evidenceDigest:D('capacity')}].sort((a,b)=>a.kind.localeCompare(b.kind)),
    assessment=store.recordAssessment({acceptanceAttemptId:attemptId,offerId:offer.offerId,onDeckPackageId:offer.onDeckPackageId,
      packageDigest:offer.packageDigest,shelfId:shelf.shelfId,standardRevision:shelf.currentStandardRevision,placementRevision:1,checks}),
    responsibility=store.deriveAcceptedResponsibility(assessment),targetLocation='/shelf/movie',
    finalBody={schemaRef:'helix://contracts/domain-types/FinalInventoryDecision/v1',schemaVersion:1,objectId:'final',revision:1,
      onDeckRunId:responsibility.onDeckRunId,shelfId:shelf.shelfId,placementRevision:1,members:[]},
    decisionDigest=D({schema:'arca.final-inventory-decision@1',...finalBody,targetEndpointId:'endpoint',targetLocation,
      productManifestDigest:packageValue.productMaterialManifest.manifestDigest,offloadContextDigest:packageValue.offloadContextManifest.manifestDigest}),
    finalInventoryDecision={...finalBody,decisionDigest,digest:decisionDigest};
  function fresh(){const readFence=h.unitOfWork.captureReadFence(),customTargetConfirmation=input.reader.read(input.request,{readFence});
    return {readFence,customTargetConfirmation,assessment,offerMessage:offer,libraRunId:'run-1',shelf,package:packageValue,
      onDeckRunId:responsibility.onDeckRunId,finalInventoryDecision,targetLocation,gapDecision,acceptanceChecks,
      bindings:[{materialKey:physical.materialKey,role:'product:primary_payload',physicalIdentity:physical,episodeClaims:{items:[],episodeClaimSetDigest},
        endpointId:'source',location:'/source/movie.mkv'}],controlTransfers:[{materialKey:physical.materialKey,expectedRevision:1,
        expectedProjectionDigest:projection.projectionDigest,fromScope:{ownerDomain:'libra',scopeType:'subject',scopeId:'subject'}}]};}
  const tables=['arca_acceptance_decisions','arca_ondeck_custodies','arca_ondeck_runs','arca_handoff_b_receipts','fx_outbox'],
    snapshot=()=>tables.map(table=>db.prepare('SELECT count(*) n FROM '+table).get().n),before=snapshot(),stale=fresh();
  assert.throws(()=>store.accept({...stale,customTargetConfirmation:null}),{code:'ARCA_CUSTOM_TARGET_FENCE_INVALID'});
  db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1 WHERE subject_id=?').run('subject');
  assert.throws(()=>store.accept(stale),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.deepEqual(snapshot(),before);
  const request=fresh(),accepted=store.accept(request);
  assert.equal(accepted.replayed,false);assert.equal(accepted.decision.customAcceptanceBasis.intentId,input.request.intentId);
  assert.equal(accepted.decision.customAcceptanceBasis.customRequirements.mandatoryMedia.minimumRasterClass,'none');
  assert.equal(db.prepare('SELECT owner_domain FROM fx_material_controls WHERE material_key=?').get(physical.materialKey).owner_domain,'arca');
  assert.deepEqual(store.readAccepted({acceptanceAttemptId:attemptId,offerMessage:offer,libraRunId:'run-1',
    onDeckRunId:responsibility.onDeckRunId,finalInventoryDecision}).decision.customAcceptanceBasis,accepted.decision.customAcceptanceBasis);
  const replay=store.accept({...request,readFence:null,customTargetConfirmation:null});
  assert.equal(replay.replayed,true);assert.equal(replay.decision.decisionDigest,accepted.decision.decisionDigest);
}));

test('custom On-deck Commit cannot bypass the missing collection-target participant',()=>applicationHarness(h=>{
  const input=arcaTargetFixture(h),store=createOnDeckStore(h.options),before=h.db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n;
  assert.throws(()=>store.commit({package:input.packageValue}),{code:'ARCA_CUSTOM_TARGET_COLLECTION_UNAVAILABLE'});
  assert.equal(h.db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,before);
}));
