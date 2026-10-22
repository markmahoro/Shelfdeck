"use strict";

const {canonicalDigest}=require('../src/helix/contracts/canonical-json');
const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCatalogPlanProofReader}=require('../src/helix/foundation/execution/catalog-plan-proof-reader');
const {createWorkResultReader}=require('../src/helix/foundation/execution/work-result-reader');
const {ArcaExecutionRegistration}=require('../src/helix/domains/arca/public');
const {createProductDeliveryReader}=require('../src/helix/domains/libra/public');
const schemaManifest=require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const fail=()=>{throw Object.assign(new Error('Historical settlement lacks exact successor completion proof.'),{code:'RESET_HISTORICAL_EFFECT_UNPROVEN'});};
function verifyEffectProof(facts,proof,source) {
  const effect=facts.effects.find(row=>row.effect_id===proof.effectId);
  const attempt=effect&&facts.attempts.find(row=>row.event_attempt_id===effect.event_attempt_id);
  const event=attempt&&facts.events.find(row=>row.event_id===attempt.event_id);
  const nextEvent=source?.events.find(row=>row.event_id===proof.sourceEventId);
  const attempts=source?.attempts.filter(row=>row.event_id===proof.sourceEventId&&row.outcome_kind==='succeeded')||[];
  const next=attempts[0],nextEffect=next&&source.effects.find(row=>row.event_attempt_id===next.event_attempt_id);
  const intent=(e,a)=>canonicalDigest({eventId:e.event_id,capabilityRef:e.capability_ref,contractVersion:e.contract_version,
    inputSnapshotDigest:a.input_snapshot_digest,fenceSnapshotDigest:a.fence_snapshot_digest});
  if(proof.schemaRef!=='arca.terminal-effect-history-proof@1'||proof.disposition!=='fulfilled_by_successor'||
      proof.ownerDomain!=='arca'||facts.work.owner_domain!=='arca'||facts.work.process_type!=='arca_ondeck_run'||
      !['succeeded','failed','cancelled'].includes(facts.work.state)||!['succeeded','failed','cancelled'].includes(facts.workAttempt.state)||
      !effect||effect.state!=='reconcile_required'||effect.effect_class!=='destructive_commit'||
      !event||event.state!=='failed'||event.capability_ref!=='arca.ondeck.input_settlement.delete@1'||
      attempt.state!=='completed'||attempt.outcome_kind!=='failed'||proof.eventId!==event.event_id||
      proof.inputDigest!==attempt.input_snapshot_digest||effect.intent_digest!==intent(event,attempt)||
      !source||source.plan.plan_id!==proof.sourcePlanId||source.work.owner_domain!=='arca'||source.work.process_type!==facts.work.process_type||
      source.work.process_id!==facts.work.process_id||source.work.work_id===facts.work.work_id||
      source.work.state!=='succeeded'||source.workAttempt.state!=='succeeded'||
      !nextEvent||nextEvent.state!=='succeeded'||nextEvent.capability_ref!==event.capability_ref||attempts.length!==1||
      next.state!=='completed'||!Number.isSafeInteger(attempt.started_at_ms)||attempt.started_at_ms<0||
      !Number.isSafeInteger(next.started_at_ms)||next.started_at_ms<=attempt.started_at_ms||next.input_snapshot_digest!==proof.sourceInputDigest||
      nextEffect?.state!=='committed'||nextEffect.intent_digest!==intent(nextEvent,next)||
      !source.results.some(row=>row.event_id===proof.sourceEventId&&row.result_id===proof.sourceResultId&&row.result_digest===proof.sourceResultDigest)||
      !source.results.some(row=>row.result_id===proof.sourceCommitResultId&&row.result_digest===proof.sourceCommitResultDigest))fail();
  return proof;
}
function readCompletedHistoricalEffects(db) {
  // This Operator reader cannot write, start a transaction or authorize a
  // deletion. All Owner queries share the caller's pinned read-only snapshot.
  if(!db.readonly||!db.inTransaction)throw new TypeError('History proof requires a pinned read-only snapshot.');
  let active=false;
  const kernel={runPrimitive(operation){
    if(active)throw new Error('Nested Owner history query is forbidden.');active=true;
    try{return operation({commitTimeMs:0,prepare(sql){const statement=db.prepare(sql);if(!statement.reader)throw new Error('History query attempted a write.');return statement;}});}
    finally{active=false;}
  }};
  const unitOfWork=createSqliteUnitOfWork({kernel}),dependencies={schemaManifest,unitOfWork};
  const reader=createCatalogPlanProofReader(dependencies),workResultReader=createWorkResultReader(dependencies);
  const observer=ArcaExecutionRegistration().createTerminalEffectHistoryObserver({...dependencies,workResultReader,
    productDeliveryPort:createProductDeliveryReader(dependencies),
    readTechnicalWork:id=>reader.verify(r=>r.workPlanIds(id).map(plan=>r.read(plan)))});
  const plans=db.prepare("SELECT DISTINCT e.plan_id FROM fx_effect_journal j JOIN fx_event_attempts a USING(event_attempt_id) JOIN fx_workflow_events e USING(event_id) JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE j.state='reconcile_required' AND j.effect_class='destructive_commit' AND e.capability_ref='arca.ondeck.input_settlement.delete@1' AND e.state='failed' AND w.owner_domain='arca' AND w.process_type='arca_ondeck_run' AND w.state IN ('failed','succeeded','cancelled') ORDER BY e.plan_id").all();
  const proofs=[],rejected=[];
  for(const row of plans) {
    try {
      const facts=reader.verify(r=>r.read(row.plan_id)),pending=observer.observe(facts).map(proof=>
        verifyEffectProof(facts,proof,reader.verify(r=>r.read(proof.sourcePlanId))));
      proofs.push(...pending);
    }catch(error){rejected.push({planId:row.plan_id,code:'RESET_HISTORICAL_EFFECT_UNPROVEN'});}
  }
  return {proofs:proofs.sort((a,b)=>a.effectId.localeCompare(b.effectId)),rejected};
}
module.exports=Object.freeze({readCompletedHistoricalEffects,verifyEffectProof});
