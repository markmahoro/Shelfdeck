'use strict';
const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createHandoffBAcceptanceStore } = require('../persistence/handoff-b-acceptance-store');
const { createShelfQueryStore } = require('../persistence/shelf-query-store');
const { createMaterialBindingScopeReader } = require('../persistence/material-binding-scope-reader');
const { createMaterialControlProjectionPort } = require('../../../foundation/persistence/material-control');
const { handoffBControlMembers } = require('../model/handoff-b-control-members');

const STAGE = 'arca.inventory.product.stage@1';
const TERMINAL = new Set(['succeeded','failed','cancelled']);
const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0,40);
const requireProof = (value, reason) => { if (!value) throw new Error('Arca stage history: ' + reason); };
function one(rows, predicate) { const matches=rows.filter(predicate); requireProof(matches.length===1,'missing or ambiguous source'); return matches[0]; }
function integerFence(value, field) {
  requireProof((typeof value==='number'||typeof value==='bigint') &&
    Number.isSafeInteger(Number(value)) && Number(value)>=0,'invalid '+field);
  return Number(value);
}
function statusFence(status) {
  if (!status?.latestAttempt) return status;
  return {...status,latestAttempt:{...status.latestAttempt,ordinal:integerFence(status.latestAttempt.ordinal,'Work Attempt ordinal')}};
}

// Historical product projection, read-only. Exact input digest matching is
// mandatory; this does not recreate a current physical read permission.
function productHandles(packageValue, responsibility) {
  return packageValue.productMaterialManifest.members.map(item=>item.workspaceMaterialHandle||{
    schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
    handleId:stable('arca-read-',{run:responsibility.onDeckRunId,key:item.materialKey}),identity:item.physicalIdentity,
    ownerDomain:'arca',ownerScope:{scopeType:'on_deck_custody',scopeId:responsibility.custodyId},bindingRevision:item.bindingRevision||1,
    endpointId:item.location.endpointId,location:item.location.location,mountScopeRevision:1,expectedSizeBytes:item.sizeBytes,
    expectedMtimeNs:0,expectedCtimeNs:0,fingerprintVerifiedAtMs:0,readScope:'exact_inventory_input',expiresAtMs:Number.MAX_SAFE_INTEGER,
    fenceDigest:canonicalDigest({key:item.materialKey,run:responsibility.onDeckRunId})});
}

function createTerminalStageHistoryObserver(options) {
  const acceptance=options.contextReader?.acceptance||createHandoffBAcceptanceStore(options);
  const shelves=options.stageHistoryShelfReader||createShelfQueryStore(options);
  const controls=options.stageHistoryControlReader||createMaterialControlProjectionPort(options);
  const arcaBindings=options.stageHistoryArcaBindingReader||createMaterialBindingScopeReader(options);
  function readBoundary(facts, slot, deps) {
    const responsibility=acceptance.readRunResponsibility(facts.work.process_id);
    requireProof(responsibility?.runState==='blocked' && responsibility.onDeckRunId===facts.work.process_id,'Accepted Run no longer blocked');
    const packageRef=one(deps,d=>d.objectType==='on_deck_package'),offerRef=one(deps,d=>d.objectType==='handoff_b_offer');
    requireProof(packageRef.objectId===responsibility.onDeckPackageId && packageRef.digest===responsibility.packageDigest &&
      offerRef.objectId===responsibility.offerId,'foreign Accepted Package');
    const delivery=options.productDeliveryPort.readPackage({queryContract:'libra.product-delivery@1',readPurpose:'historical',
      offerId:offerRef.objectId,onDeckPackageId:packageRef.objectId,expectedPackageRevision:packageRef.revision,expectedPackageDigest:packageRef.digest});
    requireProof(delivery?.resultKind==='found','historical Package unavailable');
    const packageValue=delivery.onDeckProductPackage;
    const shelf=shelves.getShelf(responsibility.shelfId);
    requireProof(shelf && ['active','deregistering'].includes(shelf.status) &&
      shelf.target.endpointId===slot.targetEndpointId,'trusted Shelf scope changed');
    const root=path.resolve(shelf.target.rootLocation),target=path.resolve(slot.targetDirectory),directory=path.resolve(slot.slotDirectory);
    requireProof(slot.schemaRef==='helix://contracts/types/TargetCommitSlotHandle/v1' && slot.schemaVersion===1 && slot.transactionRevision===1 &&
      slot.onDeckRunId===responsibility.onDeckRunId && slot.finalInventoryDecisionDigest===responsibility.finalInventoryDecision.decisionDigest &&
      path.isAbsolute(shelf.target.rootLocation) && path.isAbsolute(slot.targetDirectory) && path.isAbsolute(slot.slotDirectory),'invalid slot identity');
    const targetRelative=path.relative(root,target);
    requireProof(targetRelative && !targetRelative.startsWith('..') && !path.isAbsolute(targetRelative),'target escaped Shelf root');
    const suffix=canonicalDigest({schema:'arca.inventory-stage-slot@1',onDeckRunId:responsibility.onDeckRunId,
      finalInventoryDecisionDigest:slot.finalInventoryDecisionDigest}).slice(0,16);
    requireProof(directory===path.join(path.dirname(target),'.shelfdeck-stage-'+suffix) &&
      slot.slotId===canonicalDigest({schema:'arca.target-commit-slot-id@1',onDeckRunId:responsibility.onDeckRunId,
        targetEndpointId:slot.targetEndpointId,targetLocation:target,finalInventoryDecisionDigest:slot.finalInventoryDecisionDigest}) &&
      slot.containmentDigest===canonicalDigest({schema:'arca.target-slot-containment@1',targetRoot:root,targetDirectory:target,slotDirectory:directory}), 'slot containment mismatch');
    requireProof(responsibility.finalInventoryDecision.members.length>0 && responsibility.finalInventoryDecision.members.every(member=>{
      const relative=path.relative(target,path.resolve(member.targetLocation));return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    }), 'Final Decision outside target');
    const scope=controls.readScope({ownerDomain:'arca',scopeType:'on_deck_custody',scopeId:responsibility.custodyId});
    // Handoff B transfers controlled Product and original Input members only.
    // Related Input remains with its original Owner even when it is in the Package.
    const transferredMembers=handoffBControlMembers(packageValue);
    const initialKeys=[...new Set(transferredMembers.map(m=>m.materialKey))].sort();
    requireProof(canonicalJson(scope.items.map(item=>item.materialKey).sort())===canonicalJson(initialKeys) && scope.items.every(item=>
      item.resultKind==='available' && item.controlState==='controlled' && item.ownerDomain==='arca' &&
      item.ownerScopeType==='on_deck_custody' && item.ownerScopeId===responsibility.custodyId),'Custody has missing or extra Control');
    const query={endpointId:slot.targetEndpointId,directory};
    const arca=arcaBindings.read(query),libra=options.stageHistoryLibraBindingReader.read(query);
    requireProof(arca.ownerDomain==='arca' && libra.ownerDomain==='libra' && arca.count===0 && libra.count===0,'slot has Owner references');
    const works=options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_ondeck_run',processId:responsibility.onDeckRunId,workKind:'on_deck_execution'})
      .map(work=>({...work,created_at_ms:integerFence(work.created_at_ms,'Work created time'),updated_at_ms:integerFence(work.updated_at_ms,'Work updated time')}));
    requireProof(works.length>0 && works.every(work=>TERMINAL.has(work.state)),'active Work');
    const statuses=works.map(work=>statusFence(options.workResultReader.status(work.work_id)));
    requireProof(statuses.every(status=>status && TERMINAL.has(status.state) && (!status.latestAttempt||TERMINAL.has(status.latestAttempt.state))),'active Work Attempt');
    const graphs=works.flatMap(work=>options.readTechnicalWork(work.work_id));
    requireProof(graphs.every(graph=>TERMINAL.has(graph.workAttempt.state) && graph.events.every(event=>TERMINAL.has(event.state)||event.state==='skipped') &&
      graph.attempts.every(attempt=>attempt.state==='completed')),'active Event or Attempt');
    const current=one(graphs,graph=>graph.plan.plan_id===facts.plan.plan_id);
    requireProof(canonicalDigest(current)===canonicalDigest(facts),'technical Fence changed');
    return {responsibility,packageValue,shelf,scope,arca,libra,works,statuses,graphs};
  }
  function observe(facts) {
    requireProof(facts.work.owner_domain==='arca' && facts.work.process_type==='arca_ondeck_run' && facts.work.work_kind==='on_deck_execution', 'foreign Work');
    const definition=JSON.parse(facts.work.definition_json);
    requireProof(canonicalDigest(definition)===facts.work.definition_digest && definition.workId===facts.work.work_id &&
      definition.processId===facts.work.process_id && definition.ownerDomain==='arca','Work definition mismatch');
    return facts.effects.filter(effect=>!['committed','failed'].includes(effect.state)).map(effect=>{
      const attempt=one(facts.attempts,a=>a.event_attempt_id===effect.event_attempt_id),event=one(facts.events,e=>e.event_id===attempt.event_id);
      const node=one(facts.nodes,n=>n.node_id===event.node_id),bindings=JSON.parse(node.input_bindings_json).bindings;
      requireProof(effect.state==='reconcile_required' && effect.effect_class==='material_commit' && event.capability_ref===STAGE &&
        event.state==='failed' && attempt.state==='completed' && attempt.outcome_kind==='failed' && bindings.length===2,'unsupported stage history');
      const product=one(bindings,b=>b.portName==='productMaterialHandleList'),source=one(bindings,b=>b.portName==='targetCommitSlotHandle');
      requireProof(product.bindingKind==='projected_owner_facts' && product.ownerDomain==='arca' && product.processType==='arca_ondeck_run' && product.processId===facts.work.process_id &&
        product.projectionRef==='helix://arca/input-projections/ProductMaterialHandles/v1' && source.bindingKind==='projected_event_result' &&
        source.projectionRef==='helix://arca/input-projections/TargetCommitSlotHandle/v1' &&
        bindings.every(b=>canonicalJson(b.parameters.dependencyRefs)===canonicalJson(definition.dependencyRefs)),'unproven stage projection');
      const sourceEvent=one(facts.events,e=>e.event_id===source.eventId && e.state==='succeeded' && e.capability_ref==='arca.inventory.target_slot.prepare@1');
      requireProof(facts.edges.some(edge=>edge.from_node_id===sourceEvent.node_id && edge.to_node_id===event.node_id && edge.dependency_kind==='success'),'missing slot predecessor');
      const result=one(facts.results,r=>r.event_id===sourceEvent.event_id),slot=JSON.parse(result.result_json);
      requireProof(canonicalDigest(slot)===result.result_digest,'slot Result digest mismatch');
      const before=readBoundary(facts,slot,definition.dependencyRefs);
      const beforeDigest=canonicalDigest(before);
      const inputDigest=canonicalDigest({productMaterialHandleList:productHandles(before.packageValue,before.responsibility),targetCommitSlotHandle:slot});
      requireProof(inputDigest===attempt.input_snapshot_digest && effect.intent_digest===canonicalDigest({eventId:event.event_id,
        capabilityRef:event.capability_ref,contractVersion:event.contract_version,inputSnapshotDigest:inputDigest,fenceSnapshotDigest:attempt.fence_snapshot_digest}),'original input or intent mismatch');
      const physical=options.inventoryPort.observeEmptyStageSlot({targetRoot:before.shelf.target.rootLocation,targetCommitSlotHandle:slot});
      requireProof(physical?.schemaRef==='arca.empty-stage-slot-observation@1' && physical.slotDigest===result.result_digest &&
        physical.slotId===slot.slotId && physical.memberCount===0 && /^[a-f0-9]{64}$/.test(physical.pathIdentityDigest),'unproven physical observation');
      const after=readBoundary(facts,slot,definition.dependencyRefs);
      requireProof(beforeDigest===canonicalDigest(after),'Owner, Control or technical scope changed during observation');
      return Object.freeze({schemaRef:'arca.terminal-stage-history-proof@1',ownerDomain:'arca',disposition:'no_remaining_material_effect',
        effectId:effect.effect_id,eventId:event.event_id,inputDigest,slotEventId:sourceEvent.event_id,slotResultId:result.result_id,
        slotResultDigest:result.result_digest,observationDigest:canonicalDigest({boundary:after,physical})});
    });
  }
  return Object.freeze({observe});
}
module.exports=Object.freeze({createTerminalStageHistoryObserver});
