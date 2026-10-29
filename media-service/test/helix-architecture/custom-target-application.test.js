'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {describeCustomRequirement}=require('../../src/helix/contracts/custom-acceptance-requirements');
const {createCustomTargetApplication}=require('../../src/helix/domains/libra/application/custom-target-application');
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
