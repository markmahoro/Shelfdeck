'use strict';
const {createPlanningEvidenceReader}=require('../src/helix/domains/arca/persistence/planning-evidence-reader');

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assessAcceptedInventory,
  acceptedRunBasis,
} = require('../src/helix/domains/arca/application/on-deck-context-reader');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { deriveAcceptedResponsibility } = require('../src/helix/domains/arca/model/acceptance-responsibility');
const { createOnDeckProjections } = require('../src/helix/domains/arca/planning/on-deck-projections');
const { P } = require('../src/helix/domains/arca/planning/on-deck-planners');
const { createHandoffBAcceptanceStore } = require('../src/helix/domains/arca/persistence/handoff-b-acceptance-store');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

test('accepted On-deck context replays final reality after an earlier member settlement', () => {
  let captured;
  const result = assessAcceptedInventory({
    assess(request) {
      captured = request;
      if (!request.replayCommitted) {
        const error = new Error('Earlier settled source was treated as missing.');
        error.code = 'CLEAN_ARCA_PRODUCT_SOURCE_MISSING';
        throw error;
      }
      return { payloadDigest:'accepted-feasibility' };
    },
  }, 'on-deck-1', { custodyId:'custody-1' }, {
    shelf:{ shelfId:'shelf-1' },
    packageValue:{ onDeckPackageId:'package-1' },
  });

  assert.equal(result.payloadDigest, 'accepted-feasibility');
  assert.equal(captured.replayCommitted, true);
  assert.equal(captured.onDeckRunId, 'on-deck-1');
  assert.equal(captured.custodyId, 'custody-1');
  assert.equal(captured.shelf.shelfId, 'shelf-1');
  assert.equal(captured.onDeckProductPackage.onDeckPackageId, 'package-1');
});

test('Run responsibility requires the original accepted Receipt and exact Decision revisions', () => {
  const receiptBody = { schemaRef:'helix://contracts/types/CustodyAndTransferReceipt/v1', schemaVersion:1,
    receiptId:'receipt-1', receiptKind:'handoff_b_accepted', ownerDomain:'arca',
    scopeType:'acceptance_decision', scopeId:'decision-1', scopeDigest:'evidence-1',
    effectReceiptRef:null, committedAtMs:10, acceptanceDecisionId:'decision-1',
    custodyId:'custody-1', arcaBindingSetDigest:'bindings-1', controlRevisionSetDigest:'controls-1' };
  const finalInventoryDecision = { decisionDigest:'final-digest-1', members:[] };
  const rows = {
    find_run:{ custody_id:'custody-1', final_inventory_decision_digest:'final-digest-1', state:'offloading' },
    find_custody:{ custody_id:'custody-1', acceptance_decision_id:'decision-1' },
    find_decision_by_id:{ acceptance_decision_id:'decision-1', acceptance_attempt_id:'attempt-1',
      result:'accepted', offer_id:'offer-1', on_deck_package_id:'package-1', package_digest:'package-digest-1',
      shelf_id:'shelf-1', standard_revision:1, placement_revision:2 },
    find_attempt:{ state:'accepted', offer_id:'offer-1', standard_revision:1, placement_revision:2 },
    find_receipt:{ receipt_id:'receipt-1', acceptance_decision_id:'decision-1', outcome:'accepted',
      offer_id:'offer-1', custody_id:'custody-1', on_deck_package_id:'package-1',
      package_digest:'package-digest-1', acceptance_evidence_set_digest:'evidence-1',
      arca_binding_set_digest:'bindings-1', control_revision_set_digest:'controls-1',
      committed_at_ms:10, receipt_digest:canonicalDigest(receiptBody) },
    find_final_inventory_decision:{ shelf_id:'shelf-1', placement_revision:2,
      decision_digest:'final-digest-1', decision_json:JSON.stringify(finalInventoryDecision) },
  };
  const unitOfWork = { execute(participants) {
    return Object.fromEntries(participants.map((item)=>[item.participantId,
      item.execute({ repository:()=>({ invoke:(name)=>rows[name] }) })]));
  } };
  const store = createHandoffBAcceptanceStore({ schemaManifest, unitOfWork });
  assert.equal(store.readRunResponsibility('run-1').standardRevision, 1);
  const receipt = rows.find_receipt;
  rows.find_receipt = null;
  assert.throws(()=>store.readRunResponsibility('run-1'), /responsibility facts are incomplete/);
  rows.find_receipt = { ...receipt, receipt_digest:'tampered' };
  assert.throws(()=>store.readRunResponsibility('run-1'), /accepted history is inconsistent/);
  rows.find_receipt = receipt;
  rows.find_attempt = { ...rows.find_attempt, standard_revision:2 };
  assert.throws(()=>store.readRunResponsibility('run-1'), /responsibility facts are incomplete/);
});

test('accepted On-deck projections keep the frozen Standard and Placement through every later stage', () => {
  const offer = { offerId:'offer-1', onDeckPackageId:'package-1', packageDigest:'package-digest-1',
    shelfId:'shelf-1', libraRunId:'libra-run-1' };
  const attemptId = canonicalDigest({ schema:'arca.acceptance-attempt-id@1', offerId:offer.offerId,
    onDeckPackageId:offer.onDeckPackageId, packageDigest:offer.packageDigest,
    standardRevision:1, placementRevision:2 });
  const assessment = { acceptanceAttemptId:attemptId, onDeckPackageId:offer.onDeckPackageId,
    packageDigest:offer.packageDigest, attemptState:'accepted' };
  const responsibility = deriveAcceptedResponsibility(assessment);
  const finalInventoryDecision = { decisionDigest:'final-decision-1', placementRevision:2,
    members:[{ targetLocation:'C:/Shelf/Movie/movie.mkv' }] };
  const snapshotBody = { schemaRef:'helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1',
    schemaVersion:1, acceptanceSpecId:'spec-1', acceptanceSpecRecordDigest:'spec-digest-1',
    targetShelfId:'shelf-1', structureKind:'single', contentProfile:'movie',
    shelfStandardRevision:1, shelfStandardDigest:'standard-digest-1' };
  const packageValue = { onDeckPackageId:offer.onDeckPackageId, shelfId:'shelf-1',
    acceptanceSpecRef:{ id:'spec-1', recordDigest:'spec-digest-1' },
    productionProvenance:{ acceptanceRequirementSnapshot:{ ...snapshotBody,
      snapshotDigest:canonicalDigest(snapshotBody) } } };
  const current = { offer, packageValue, shelf:{ shelfId:'shelf-1',
    currentStandardRevision:2, currentPlacementRevision:3 } };
  const frozenShelf = { shelfId:'shelf-1', currentStandardRevision:1, currentPlacementRevision:2,
    standard:{ revision:1, ruleTemplateRevision:1, digest:'standard-digest-1' },
    placement:{ revision:2, value:{}, digest:'placement-digest-2' },
    target:{ endpointId:'target-1', rootLocation:'C:/Shelf' } };
  const recorded = { ...responsibility, acceptanceAttemptId:attemptId, offerId:offer.offerId,
    onDeckPackageId:offer.onDeckPackageId, packageDigest:offer.packageDigest, shelfId:'shelf-1',
    standardRevision:1, placementRevision:2, finalInventoryDecision };
  const acceptance = { readRunResponsibility:()=>recorded, readAssessment:()=>assessment,
    deriveAcceptedResponsibility, readAccepted:()=>({ finalInventoryDecision }) };
  const shelves = { getShelfAtBasis(_shelfId, basis) {
    assert.equal(basis.standardRevision, 1);
    assert.equal(basis.placementRevision, 2);
    return frozenShelf;
  } };
  for (const stage of ['staged_verify', 'final_product_verify', 'on_deck_commit']) {
    const basis = acceptedRunBasis(current, responsibility.onDeckRunId, acceptance, shelves);
    assert.equal(basis.context.shelf.currentStandardRevision, 1, stage);
    const projections = new Map(createOnDeckProjections({ evidenceReader:createPlanningEvidenceReader({}), contextReader:{ readAccepted:()=>basis.context } })
      .map((item)=>[item.projectionRef,item.projection]));
    const scope = { processType:'arca_ondeck_run', processId:responsibility.onDeckRunId };
    const standard = projections.get(P.shelfStandard).project({ ownerScope:scope, parameters:{} });
    const placement = projections.get(P.placementPolicy).project({ ownerScope:scope, parameters:{} });
    assert.equal(standard.revision, 1, stage);
    assert.equal(placement.revision, 2, stage);
  }
  const settlement = acceptedRunBasis(current, responsibility.onDeckRunId,
    { readRunResponsibility:()=>recorded,
      readAssessment:()=>{ throw new Error('Bounded settlement reread the full assessment.'); },
      readAccepted:()=>{ throw new Error('Bounded settlement reconstructed the full Receipt.'); } },
    shelves, { boundedSettlement:true });
  assert.equal(settlement.recorded.finalInventoryDecision.decisionDigest, 'final-decision-1');
  assert.throws(()=>acceptedRunBasis({ ...current, offer:{ ...offer, packageDigest:'foreign' } },
    responsibility.onDeckRunId, acceptance, shelves), /identity.*stale/);
  assert.throws(()=>acceptedRunBasis(current, responsibility.onDeckRunId,
    { ...acceptance, readAccepted:()=>null }, shelves), /history.*stale/);
  assert.throws(()=>acceptedRunBasis(current, responsibility.onDeckRunId,
    { ...acceptance, readRunResponsibility:()=>({ ...recorded, acceptanceAttemptId:'new-attempt' }) }, shelves),
  /frozen Acceptance Basis/);
  assert.throws(()=>acceptedRunBasis({ ...current, packageValue:{ ...packageValue,
    productionProvenance:{ acceptanceRequirementSnapshot:{ ...snapshotBody,
      shelfStandardDigest:'other', snapshotDigest:canonicalDigest(snapshotBody) } } } },
  responsibility.onDeckRunId, acceptance, shelves), /frozen Shelf Standard/);
});
