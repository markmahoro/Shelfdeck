'use strict';
const {resolveStagedResult}=require('../persistence/staged-manifest-store');

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createHandoffBAcceptanceStore } = require('../persistence/handoff-b-acceptance-store');
const { createOnDeckStore } = require('../persistence/on-deck-store');
const { settlementHandles } = require('../model/historical-on-deck-effect-inputs');
const { requiresInputSettlement } = require('../model/offload-settlement');
const { createTerminalStageHistoryObserver } = require('./terminal-stage-history-observer');

const SETTLEMENT = 'arca.ondeck.input_settlement.delete@1';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const HASH = /^[a-f0-9]{64}$/;
const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0, 40);
function requireProof(value, message) { if (!value) throw new Error('Arca Effect history: ' + message); }
function exactOne(rows, predicate) {
  const matches = rows.filter(predicate);
  requireProof(matches.length === 1, 'missing or ambiguous historical fact');
  return matches[0];
}
function canonicalPayload(row) {
  const value = JSON.parse(row.result_json);
  requireProof(canonicalDigest(value) === row.result_digest, 'Result digest mismatch');
  return value;
}
function resultFor(facts, capabilityRef) {
  const event = exactOne(facts.events, e => e.capability_ref === capabilityRef && e.state === 'succeeded');
  const row = exactOne(facts.results, r => r.event_id === event.event_id);
  return { event, row, value: canonicalPayload(row) };
}
function successfulPath(facts, from, to) {
  const seen = new Set([from]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of facts.edges) if (edge.dependency_kind === 'success' && seen.has(edge.from_node_id) && !seen.has(edge.to_node_id)) {
      seen.add(edge.to_node_id); changed = true;
    }
  }
  return seen.has(to);
}
function historicalInputs(context, materialKey, eventId) {
  const handles = settlementHandles(context, materialKey);
  // This reproduces the UAT-172 authorization defect for digest verification.
  // It is evidence of past inputs, never authorization for another deletion.
  const approval = { schemaRef:'helix://contracts/types/ApprovalHandle/v1', schemaVersion:1,
    approvalId:stable('arca-settlement-approval-', { run:context.responsibility.onDeckRunId, key:materialKey }),
    ownerDomain:'arca', processType:'arca_ondeck_run', processId:context.responsibility.onDeckRunId,
    eventId, exactEffectScopeDigest:handles.approvalScopeDigest, approvalRevision:1, actorId:'system-policy',
    invalidatingFactDigests:[context.responsibility.finalInventoryDecision.decisionDigest], approvedAtMs:0 };
  return { handles, inputDigest:canonicalDigest({ oldPrimaryStructuralExclusiveRelatedHandleList:handles, inputSettlementApproval:approval }), approval };
}

function createTerminalEffectHistoryObserver(options) {
  const acceptance = options.contextReader?.acceptance || createHandoffBAcceptanceStore(options);
  const onDeck = options.contextReader?.onDeck || createOnDeckStore(options);
  const readWork = options.readTechnicalWork;
  const workReader = options.workResultReader;

  function contextFor(facts, node) {
    const definition = JSON.parse(facts.work.definition_json);
    requireProof(canonicalDigest(definition) === facts.work.definition_digest &&
      definition.workId === facts.work.work_id && definition.processId === facts.work.process_id &&
      definition.ownerDomain === 'arca' && definition.workKind === 'on_deck_execution', 'Work definition mismatch');
    const bindings = JSON.parse(node.input_bindings_json).bindings;
    requireProof(bindings.length === 2, 'unexpected settlement ports');
    const handles = exactOne(bindings, b => b.portName === 'oldPrimaryStructuralExclusiveRelatedHandleList');
    const approval = exactOne(bindings, b => b.portName === 'inputSettlementApproval');
    const event = exactOne(facts.events, e => e.node_id === node.node_id);
    requireProof(handles.bindingKind === 'projected_owner_facts' && approval.bindingKind === 'projected_owner_facts' &&
      handles.projectionRef === 'helix://arca/input-projections/SettlementHandles/v1' &&
      approval.projectionRef === 'helix://arca/input-projections/SettlementApproval/v1' &&
      approval.parameters.eventId === event.event_id && approval.parameters.materialKey === handles.parameters.materialKey &&
      bindings.every(b => b.ownerDomain === 'arca' && b.processType === 'arca_ondeck_run' && b.processId === facts.work.process_id &&
        canonicalJson(b.parameters.dependencyRefs) === canonicalJson(definition.dependencyRefs)), 'unproven historical projection scope');
    const responsibility = acceptance.readRunResponsibility(facts.work.process_id);
    requireProof(responsibility?.runState === 'committed', 'Run has remaining Owner responsibility');
    const packageRef = exactOne(definition.dependencyRefs, r => r.objectType === 'on_deck_package');
    const offer = exactOne(definition.dependencyRefs, r => r.objectType === 'handoff_b_offer');
    requireProof(packageRef.objectId === responsibility.onDeckPackageId && packageRef.digest === responsibility.packageDigest &&
      offer.objectId === responsibility.offerId, 'Custody/Package identity mismatch');
    const delivery = options.productDeliveryPort.readPackage({ queryContract:'libra.product-delivery@1', readPurpose:'historical',
      offerId:offer.objectId, onDeckPackageId:packageRef.objectId, expectedPackageRevision:packageRef.revision, expectedPackageDigest:packageRef.digest });
    requireProof(delivery?.resultKind === 'found', 'immutable Package unavailable');
    const packageValue = delivery.onDeckProductPackage;
    const source = exactOne(packageValue.offloadContextManifest.members, m => m.materialKey === handles.parameters.materialKey && requiresInputSettlement(m));
    const finalMember = exactOne(responsibility.finalInventoryDecision.members, m => m.sourceMaterialKey === source.finalProductMaterialKey);
    requireProof(packageValue.packageDigest === responsibility.packageDigest && packageValue.onDeckPackageId === responsibility.onDeckPackageId &&
      HASH.test(responsibility.finalInventoryDecision.decisionDigest), 'historical Package/Decision digest missing');
    return { responsibility, packageValue, source, settlementFinalMember:finalMember };
  }

  function observe(facts) {
    if (facts.events.some(event=>event.capability_ref==='arca.inventory.product.stage@1' && event.state==='failed')) {
      return createTerminalStageHistoryObserver(options).observe(facts);
    }
    requireProof(facts.work.owner_domain === 'arca' && facts.work.process_type === 'arca_ondeck_run' &&
      facts.work.work_kind === 'on_deck_execution' && TERMINAL.has(facts.work.state) && TERMINAL.has(facts.workAttempt.state), 'nonterminal or foreign scope');
    const unresolved = facts.effects.filter(e => !['committed', 'failed'].includes(e.state));
    requireProof(unresolved.length > 0, 'no unresolved Effect');
    const works = workReader.listWorks({ ownerDomain:'arca', processType:'arca_ondeck_run', processId:facts.work.process_id, workKind:'on_deck_execution' });
    requireProof(works.every(w => TERMINAL.has(w.state)), 'active Owner execution');
    const candidates = works.filter(w => w.state === 'succeeded' && w.work_id !== facts.work.work_id).flatMap(w => readWork(w.work_id));
    return unresolved.map(effect => {
      const attempt = exactOne(facts.attempts, a => a.event_attempt_id === effect.event_attempt_id);
      const event = exactOne(facts.events, e => e.event_id === attempt.event_id);
      requireProof(event.capability_ref === SETTLEMENT && event.state === 'failed' && attempt.state === 'completed' &&
        attempt.outcome_kind === 'failed' && effect.effect_class === 'destructive_commit' && effect.state === 'reconcile_required', 'unsupported unresolved Effect');
      const node = exactOne(facts.nodes, n => n.node_id === event.node_id);
      const context = contextFor(facts, node), key = context.source.materialKey;
      const old = historicalInputs(context, key, event.event_id);
      const matches = candidates.flatMap(candidate => candidate.results.filter(row => {
        const sourceEvent = candidate.events.find(e => e.event_id === row.event_id);
        return sourceEvent?.capability_ref === SETTLEMENT && sourceEvent.state === 'succeeded' && canonicalPayload(row).materialKey === key;
      }).map(row => ({ facts:candidate, row })));
      const successor = exactOne(matches, () => true), next = successor.facts;
      const sourceEvent = exactOne(next.events, e => e.event_id === successor.row.event_id);
      const sourceNode = exactOne(next.nodes, n => n.node_id === sourceEvent.node_id);
      const nextContext = contextFor(next, sourceNode);
      requireProof(canonicalJson(context) === canonicalJson(nextContext), 'successor responsibility changed');
      const input = historicalInputs(nextContext, key, sourceEvent.event_id);
      const evidence = canonicalPayload(successor.row);
      const { payloadDigest, ...body } = evidence;
      const { recordDigest, ...record } = evidence.postDeleteReality;
      const entries = new Map(record.entries.map(e => [e.key, e.value]));
      const final = context.settlementFinalMember;
      requireProof(payloadDigest === canonicalDigest(body) && recordDigest === canonicalDigest(record) &&
        entries.size === record.entries.length && evidence.basisDigest === input.handles.digest &&
        evidence.authorizationOrApprovalRef === input.approval.approvalId &&
        evidence.preDeleteIdentityDigest === canonicalDigest(context.source.physicalIdentity) &&
        evidence.effectReceiptId === successor.row.effect_receipt_id &&
        entries.get('absent') === true && entries.get('disposition') === 'settled_to_final' && entries.get('final_verified') === true &&
        entries.get('source_to_final_mapping_digest') === input.handles.members[0].sourceToFinalMappingDigest &&
        entries.get('final_material_key') === final.sourceMaterialKey && entries.get('final_target_location') === final.targetLocation &&
        HASH.test(entries.get('final_reality_digest')), 'successor member completion does not match old responsibility');
      const rawStage = resultFor(next, 'arca.inventory.product.stage@1');
      const stage={...rawStage,value:resolveStagedResult(options,rawStage.value)};
      const placement = resultFor(next, 'arca.inventory.placement.switch@1');
      const verification = resultFor(next, 'arca.inventory.final_product.verify@1');
      const fulfillment = resultFor(next, 'arca.ondeck.fulfillment.verify@1');
      const commit = resultFor(next, 'arca.ondeck.commit@1');
      const staged = exactOne(stage.value.stagedMembers, m => m.sourceMaterialKey === final.sourceMaterialKey);
      const verified = exactOne(verification.value.memberEvidence, m => m.sourceProductMaterialKey === final.sourceMaterialKey);
      requireProof(stage.value.sourceProductManifestDigest === context.packageValue.productMaterialManifest.manifestDigest &&
        staged.location === final.targetLocation && canonicalJson(staged.physicalIdentity) === canonicalJson(verified.actualPhysicalIdentity) &&
        placement.value.targetCommitSlotId === stage.value.targetCommitSlotId && placement.value.scopeId === facts.work.process_id &&
        verification.value.result === 'passed' && verification.value.productManifestDigest === stage.value.sourceProductManifestDigest &&
        verification.value.verifiedMaterialKeys.includes(final.sourceMaterialKey) && fulfillment.value.result === 'passed', 'missing actual successor Final Verification');
      for (const [from, to] of [[stage.event, placement.event], [placement.event, verification.event],
        [verification.event, sourceEvent], [sourceEvent, fulfillment.event], [fulfillment.event, commit.event]]) {
        requireProof(successfulPath(next, from.node_id, to.node_id), 'successor commit lacks required success dependency');
      }
      const receipt = onDeck.readHistoricalCommitted({ onDeckRunId:facts.work.process_id, custodyId:context.responsibility.custodyId,
        finalInventoryDecisionDigest:context.responsibility.finalInventoryDecision.decisionDigest,
        onDeckPackageId:context.packageValue.onDeckPackageId, packageDigest:context.packageValue.packageDigest, shelfId:context.responsibility.shelfId });
      requireProof(receipt && canonicalJson(receipt.result) === canonicalJson(commit.value), 'Owner commit receipt mismatch');
      return Object.freeze({ schemaRef:'arca.terminal-effect-history-proof@1', ownerDomain:'arca', disposition:'fulfilled_by_successor',
        historicalAuthorization:'unproven_system_policy', effectId:effect.effect_id, eventId:event.event_id,
        inputDigest:old.inputDigest, sourcePlanId:next.plan.plan_id, sourceEventId:sourceEvent.event_id,
        sourceInputDigest:input.inputDigest, sourceResultId:successor.row.result_id, sourceResultDigest:successor.row.result_digest,
        sourceCommitResultId:commit.row.result_id, sourceCommitResultDigest:commit.row.result_digest });
    });
  }
  return Object.freeze({ observe });
}

module.exports = Object.freeze({ createTerminalEffectHistoryObserver });
