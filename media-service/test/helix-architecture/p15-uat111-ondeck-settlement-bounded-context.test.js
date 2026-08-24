'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  boundedSettlementContext,
} = require('../../src/helix/domains/arca/application/on-deck-context-reader');
const {
  createOnDeckProjections,
} = require('../../src/helix/domains/arca/planning/on-deck-projections');
const { P } = require('../../src/helix/domains/arca/planning/on-deck-planners');
const {
  createOnDeckCapabilityPorts,
} = require('../../src/helix/domains/arca/capabilities/on-deck-capability-ports');
const {
  CAPABILITY_REFS,
} = require('../../src/helix/domains/arca/model/on-deck-contract');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

function fixture(count = 61) {
  const productMembers = Object.freeze(Array.from({ length:count }, (_, ordinal) =>
    Object.freeze({
      materialKey:`product-${ordinal}`,
      role:ordinal === 0 ? 'primary_payload' : 'artifact',
      physicalIdentity:Object.freeze({
        materialKey:`product-identity-${ordinal}`,
        mountScopeId:'target-mount',
        sizeBytes:ordinal + 1,
        contentFingerprint:`product-fingerprint-${ordinal}`,
      }),
      sizeBytes:ordinal + 1,
      location:Object.freeze({ endpointId:'workspace', location:`W:/product-${ordinal}` }),
    })));
  const offloadMembers = Object.freeze(productMembers.map((product, ordinal) => Object.freeze({
    materialKey:`source-${ordinal}`,
    finalProductMaterialKey:product.materialKey,
    physicalIdentity:Object.freeze({
      materialKey:`source-identity-${ordinal}`,
      mountScopeId:'source-mount',
      sizeBytes:ordinal + 1,
      contentFingerprint:`source-fingerprint-${ordinal}`,
    }),
    bindingRevision:1,
    endpointId:'source-endpoint',
    location:`S:/movie/source-${ordinal}`,
    contextRole:ordinal === 0 ? 'original_input' : 'exclusive_related',
    settlementExpectation:'remove_after_place',
    memberDigest:`source-member-${ordinal}`,
    sourceRelatedReferenceId:`related-${ordinal}`,
    derivedAuthorityDigest:`mapping-${ordinal}`,
  })));
  const finalMembers = Object.freeze(productMembers.map((product, ordinal) => Object.freeze({
    sourceMaterialKey:product.materialKey,
    targetLocation:`T:/Movie/final-${ordinal}`,
  })));
  const context = Object.freeze({
    offer:Object.freeze({ offerId:'offer-1', relatedDispositionSetDigest:'related-set-1' }),
    shelf:Object.freeze({ shelfId:'shelf-1', target:Object.freeze({ mountScopeId:'target-mount' }) }),
    packageValue:Object.freeze({
      onDeckPackageId:'package-1',
      packageRevision:1,
      packageDigest:'package-digest-1',
      productionAttestation:Object.freeze({ productConformanceEvidenceDigest:'conformance-1' }),
      productMaterialManifest:Object.freeze({ manifestDigest:'product-manifest-1', members:productMembers }),
      offloadContextManifest:Object.freeze({ manifestDigest:'offload-manifest-1', members:offloadMembers }),
    }),
  });
  const responsibility = Object.freeze({
    onDeckRunId:'run-1',
    custodyId:'custody-1',
    acceptanceDecisionId:'acceptance-1',
    finalInventoryDecision:Object.freeze({
      objectId:'decision-object-1',
      revision:1,
      decisionDigest:'decision-1',
      members:finalMembers,
    }),
  });
  return { context, responsibility, productMembers, offloadMembers, finalMembers };
}

test('UAT-111 bounds each On-deck Settlement context to one approved material without losing managed-path safety', () => {
  const value = fixture();
  const bounded = boundedSettlementContext(value.context, value.responsibility,
    Object.freeze({ state:'offloading' }), 'source-37');

  assert.deepEqual(bounded.packageValue.productMaterialManifest.members,
    [value.productMembers[37]]);
  assert.deepEqual(bounded.packageValue.offloadContextManifest.members,
    [value.offloadMembers[37]]);
  assert.equal(bounded.settlementFinalMember, value.finalMembers[37]);
  assert.equal(bounded.settlementManagedLocations.length, 122);
  assert.equal(bounded.responsibility.onDeckRunId, 'run-1');
  assert.deepEqual(bounded.finalInventoryDecisionRef,
    { objectId:'decision-object-1', revision:1, decisionDigest:'decision-1' });
});

test('UAT-111 Settlement handle and approval projections use the bounded reader and preserve per-material approval scope', () => {
  const value = fixture();
  const bounded = boundedSettlementContext(value.context, value.responsibility,
    Object.freeze({ state:'offloading' }), 'source-12');
  const calls = [];
  const projections = createOnDeckProjections({
    contextReader:{
      readSettlement(runId, dependencyRefs, materialKey) {
        calls.push({ runId, dependencyRefs, materialKey });
        return bounded;
      },
      readAccepted() { throw new Error('Settlement projection must not read the full accepted context.'); },
      readOffer() { throw new Error('Settlement projection must not read an Offer context.'); },
    },
  });
  const handlesProjection = projections.find((item) => item.projectionRef === P.settlementHandles);
  const approvalProjection = projections.find((item) => item.projectionRef === P.settlementApproval);
  const ownerScope = Object.freeze({ processType:'arca_ondeck_run', processId:'run-1' });
  const dependencyRefs = Object.freeze([{ objectType:'on_deck_package', objectId:'package-1' }]);
  const parameters = Object.freeze({ materialKey:'source-12', eventId:'settlement-12', dependencyRefs });

  const handles = handlesProjection.projection.project({ ownerScope, parameters });
  const approval = approvalProjection.projection.project({ ownerScope, parameters });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [
    { runId:'run-1', dependencyRefs, materialKey:'source-12' },
    { runId:'run-1', dependencyRefs, materialKey:'source-12' },
  ]);
  assert.equal(handles.members.length, 1);
  assert.equal(handles.members[0].materialKey, 'source-12');
  assert.equal(approval.exactEffectScopeDigest, handles.approvalScopeDigest);
  assert.equal(approval.invalidatingFactDigests[0], 'decision-1');
  assert.equal(approval.approvalId,
    'arca-settlement-approval-' + canonicalDigest({ run:'run-1', key:'source-12' }).slice(0, 40));
});

test('UAT-111 resource demand and executor are wired to the bounded Settlement reader', () => {
  const runtime = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  const ports = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/arca/capabilities/on-deck-capability-ports.js'), 'utf8');

  assert.match(runtime,
    /capability==='arca\.ondeck\.input_settlement\.delete@1'[\s\S]{0,180}contextReader\.readSettlement\(/);
  assert.match(ports,
    /ports\[C\.settlement\][\s\S]{0,500}c=settlementCtx\(execution,m\.materialKey\)/);
  assert.doesNotMatch(ports,
    /ports\[C\.settlement\][\s\S]{0,500}c=ctx\(execution\)/);
});

test('UAT-111 Settlement executor passes only the bounded member context to asynchronous settlement', async () => {
  const value = fixture();
  const bounded = boundedSettlementContext(value.context, value.responsibility,
    Object.freeze({ state:'offloading' }), 'source-8');
  const dependencyRefs = Object.freeze([{ objectType:'on_deck_package', objectId:'package-1' }]);
  let capturedRequest;
  let acceptedReads = 0;
  const ports = createOnDeckCapabilityPorts({
    schemaManifest,
    unitOfWork:{ execute() { throw new Error('Settlement must not mutate a Store before its Effect.'); } },
    now:() => 100,
    workResultReader:{
      readBindings() {
        return [{ inputBindings:{ bindings:[{
          bindingKind:'projected_owner_facts', parameters:{ dependencyRefs },
        }] } }];
      },
    },
    contextReader:{
      readSettlement(runId, refs, materialKey) {
        assert.equal(runId, 'run-1');
        assert.equal(refs, dependencyRefs);
        assert.equal(materialKey, 'source-8');
        return bounded;
      },
      readAccepted() { acceptedReads += 1; throw new Error('Full accepted context is forbidden.'); },
    },
    inventoryPort:{
      async settleInputAsync(request) {
        capturedRequest = request;
        return Object.freeze({
          preDeleteIdentityDigest:'old-identity-8',
          absent:true,
          disposition:'settled_to_final',
          sourceToFinalMappingDigest:'mapping-8',
          finalMaterialKey:'product-8',
          finalTargetLocation:'T:/Movie/final-8',
          finalRealityDigest:'final-reality-8',
          finalVerified:true,
          oldDirectoryDisposition:'awaiting_managed_settlement',
        });
      },
    },
  });
  const source = value.offloadMembers[8];
  const outcome = await ports[CAPABILITY_REFS.settlement].execute({
    ownerScope:Object.freeze({ processType:'arca_ondeck_run', processId:'run-1' }),
    workId:'work-1',
    eventId:'settlement-8',
    idempotencyKey:'settlement-key-8',
    effectOccurredAtMs:100,
    namedInputs:Object.freeze({
      oldPrimaryStructuralExclusiveRelatedHandleList:Object.freeze({
        digest:'handles-8',
        members:Object.freeze([Object.freeze({
          materialKey:source.materialKey,
          materialHandle:Object.freeze({
            schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',
            ownerDomain:'arca',
            ownerScope:Object.freeze({ scopeType:'on_deck_custody', scopeId:'custody-1' }),
            identity:source.physicalIdentity,
            location:source.location,
            expectedSizeBytes:source.physicalIdentity.sizeBytes,
          }),
          finalMaterialKey:source.finalProductMaterialKey,
          finalTargetLocation:value.finalMembers[8].targetLocation,
          settlementExpectation:source.settlementExpectation,
          sourceToFinalMappingDigest:source.derivedAuthorityDigest,
        })]),
      }),
      inputSettlementApproval:Object.freeze({ approvalId:'approval-8' }),
    }),
  });

  assert.equal(outcome.kind, 'succeeded');
  assert.equal(acceptedReads, 0);
  assert.equal(capturedRequest.finalInventoryRequest.onDeckProductPackage
    .productMaterialManifest.members.length, 1);
  assert.equal(capturedRequest.finalInventoryRequest.finalInventoryMember,
    value.finalMembers[8]);
  assert.equal(capturedRequest.finalInventoryRequest.finalInventoryDecision, undefined);
  assert.equal(capturedRequest.managedLocations.length, 122);
});
