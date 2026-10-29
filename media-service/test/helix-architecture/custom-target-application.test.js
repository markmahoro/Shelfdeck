'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {describeCustomRequirement}=require('../../src/helix/contracts/custom-acceptance-requirements');
const {createCustomTargetApplication}=require('../../src/helix/domains/libra/application/custom-target-application');
const {createLibraCustomTargetConfirmationReader}=require('../../src/helix/domains/libra/public');
const {verifyArcaCustomAcceptanceTarget}=require('../../src/helix/domains/arca/model/custom-acceptance-target');
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
    requirementBody={schemaRef:'helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1',schemaVersion:1,
      acceptanceSpecId:spec.acceptanceSpecId,acceptanceSpecRecordDigest:spec.recordDigest,targetShelfId:spec.targetShelfId,
      contentProfile:spec.contentProfile,structureKind:spec.structureKind,shelfStandardRevision:spec.shelfStandardRevision,
      shelfStandardDigest:spec.shelfStandardDigest,requirements:spec.requirements};
  return {confirmation,shelf:{shelfId:spec.targetShelfId,status:'active',currentStandardRevision:spec.shelfStandardRevision,
    standard:{digest:spec.shelfStandardDigest}},packageValue:{subjectId:spec.subjectId,shelfId:spec.targetShelfId,
    acceptanceSpecRef:{id:spec.acceptanceSpecId,recordDigest:spec.recordDigest},
    resolvedIdentitySnapshot:{factDigest:intent.basis.identityDigest,factValue:{resolvedProductIdentity:{identityKind:'tmdb_movie',
      contentProfile:'movie',structureKind:'single'}}},
    productStructureSnapshot:{...structureBody,productStructureDigest:canonicalDigest(structureBody)},
    productionProvenance:{acceptanceRequirementSnapshot:{...requirementBody,snapshotDigest:canonicalDigest(requirementBody)}}}};
}

test('Arca independently reconstructs the confirmed Movie requirement delta while retaining audio and size',()=>applicationHarness(h=>{
  const input=arcaTargetFixture(h),basis=verifyArcaCustomAcceptanceTarget(input),base=h.base.requirements;
  assert.equal(basis.originalSpecId,h.base.acceptanceSpecId);assert.equal(basis.customRequirements.mandatoryMedia.minimumRasterClass,'none');
  assert.deepEqual(basis.customRequirements.mandatoryMedia.acceptedPrimaryAudioClasses,base.mandatoryMedia.acceptedPrimaryAudioClasses);
  assert.deepEqual(basis.customRequirements.space,base.space);assert.equal(basis.customRequirements.space.maxSizeGiB,50);
  assert.deepEqual(basis.customRequirements.identity,base.identity);assert.deepEqual(basis.customRequirements.structure,base.structure);
  assert.equal(basis.basisDigest,canonicalDigest(Object.fromEntries(Object.entries(basis).filter(([key])=>key!=='basisDigest'))));
}));

for(const corruption of ['shelf_revision','shelf_digest','subject','scope','identity','snapshot_requirements',
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
