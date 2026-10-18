'use strict';
const {createPlanningEvidenceReader}=require('../../src/helix/domains/arca/persistence/planning-evidence-reader');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  boundedSettlementContext,
  createSettlementPreparationReader,
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
      materialKey:canonicalDigest(`product-${ordinal}`),
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
    contextRole:ordinal === 0 ? 'original_input' : 'related_input',
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

test('UAT-302 approval reconciliation shares one current basis while preserving exact scopes and revocation', () => {
  const { createOnDeckProcessCoordinator } = require('../../src/helix/domains/arca/application/on-deck-process-coordinator');
  const value = fixture(231);
  const verification = { schemaRef:'helix://contracts/types/FinalProductVerification/v1', result:'passed',
    productManifestDigest:'product-manifest-1', verifiedMaterialKeys:value.productMembers.map(item => item.materialKey) };
  let reads = 0, authorized = true, drift = false;
  const issued = [];
  const coordinator = createOnDeckProcessCoordinator({ schemaManifest,
    unitOfWork:{ execute() { throw new Error('This test must not access unrelated persistence.'); } },
    workResultReader:{
      read:() => [{ capabilityRef:'arca.inventory.final_product.verify@1', outcomeKind:'succeeded', result:verification },
        { capabilityRef:'arca.ondeck.input_settlement.delete@1', outcomeKind:'succeeded', result:{ materialKey:'source-0' } }],
      readDefinition:() => ({ definition:{ dependencyRefs:[] } }),
    },
    contextReader:{
      readAccepted() {
        reads += 1;
        if (drift) throw new Error('Accepted basis changed.');
        return { ...value.context, responsibility:value.responsibility,
          finalInventoryDecision:value.responsibility.finalInventoryDecision, verified:{ state:'offloading' } };
      },
      readSettlement() { throw new Error('Approval preparation must not reconstruct the entire package per member.'); },
      settlementAuthorizations:{ current:() => ({ state:authorized ? 'enabled' : 'disabled', revision:1,
        authorizationScopeKind:'old_primary_and_exclusive_related', authorizationDigest:canonicalDigest('grant') }) },
      settlementApprovals:{ issue(scope) { issued.push(scope); } },
    },
  });
  assert.deepEqual(coordinator.reconcileSettlementApprovals({ workId:'work-1', onDeckRunId:'run-1' }),
    { kind:'approvals_ready', issued:230 });
  assert.equal(reads, 1);
  assert.equal(new Set(issued.map(item => item.approvalScopeDigest)).size, 230);
  for (let index = 0; index < issued.length; index += 1) {
    assert.equal(issued[index].members.length, 1);
    assert.equal(issued[index].members[0].materialKey, 'source-' + (index + 1));
    assert.equal(issued[index].members[0].finalMaterialKey, value.productMembers[index + 1].materialKey);
    assert.equal(issued[index].members[0].finalProductVerificationDigest, canonicalDigest(verification));
  }
  authorized = false;
  assert.deepEqual(coordinator.reconcileSettlementApprovals({ workId:'work-1', onDeckRunId:'run-1' }),
    { kind:'awaiting_authorization', issued:0 });
  assert.equal(reads, 2);
  assert.equal(issued.length, 230);
  drift = true;
  assert.throws(() => coordinator.reconcileSettlementApprovals({ workId:'work-1', onDeckRunId:'run-1' }), /Accepted basis changed/);
});

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
  let authorization={state:'enabled',revision:1,authorizationScopeKind:'old_primary_and_exclusive_related',authorizationDigest:canonicalDigest('grant')};
  let readFailure = null;
  const sourceResult={schemaRef:'helix://contracts/types/FinalProductVerification/v1',result:'passed',productManifestDigest:'product-manifest-1',verifiedMaterialKeys:[canonicalDigest('product-12')]};
  let approvalReads=0;
  const readSettlement = createSettlementPreparationReader((runId, dependencyRefs, materialKey) => {
    calls.push({ runId, dependencyRefs, materialKey });
    if (readFailure) throw readFailure;
    return bounded;
  });
  const projections = createOnDeckProjections({ evidenceReader:createPlanningEvidenceReader({}),
    contextReader:{
      settlementAuthorizations:{current:()=>authorization},
      settlementApprovals:{readHandle(scope,actual,eventId){approvalReads++;assert.equal(actual,authorization);assert.equal(eventId,'settlement-12');return {approvalId:'persisted-approval',exactEffectScopeDigest:scope.approvalScopeDigest};}},
      readSettlement,
      readAccepted() { throw new Error('Settlement projection must not read the full accepted context.'); },
      readOffer() { throw new Error('Settlement projection must not read an Offer context.'); },
    },
  });
  const handlesProjection = projections.find((item) => item.projectionRef === P.settlementHandles);
  const approvalProjection = projections.find((item) => item.projectionRef === P.settlementApproval);
  const ownerScope = Object.freeze({ processType:'arca_ondeck_run', processId:'run-1' });
  const dependencyRefs = Object.freeze([{ objectType:'on_deck_package', objectId:'package-1' }]);
  const parameters = Object.freeze({ materialKey:'source-12', eventId:'settlement-12', dependencyRefs });
  const preparationScope = Object.freeze({});

  const handles = handlesProjection.projection.project({ ownerScope, parameters, sourceResult, preparationScope });
  const approval = approvalProjection.projection.project({ ownerScope, parameters, sourceResult, preparationScope });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls, [
    { runId:'run-1', dependencyRefs, materialKey:'source-12' },
  ]);
  assert.equal(handles.members.length, 1);
  assert.equal(handles.members[0].materialKey, 'source-12');
  assert.equal(approval.exactEffectScopeDigest, handles.approvalScopeDigest);
  assert.equal(approvalReads,1);
  assert.equal(approval.approvalId,'persisted-approval');
  assert.equal(handles.members[0].finalProductVerificationDigest,canonicalDigest(sourceResult));
  // Resource demand uses the same synchronous preparation, without another read.
  assert.equal(readSettlement('run-1', dependencyRefs, 'source-12',
    { preparationScope, eventId:'settlement-12' }), bounded);
  assert.equal(calls.length, 1);

  // A new preparation (including a retry) must read and validate again.
  assert.deepEqual(handlesProjection.projection.project({ ownerScope, parameters, sourceResult,
    preparationScope:Object.freeze({}) }), handles);
  assert.equal(calls.length, 2);
  // Callers outside the Binding provider retain independent reads.
  assert.deepEqual(handlesProjection.projection.project({ ownerScope, parameters, sourceResult }), handles);
  assert.deepEqual(approvalProjection.projection.project({ ownerScope, parameters, sourceResult }), approval);
  assert.equal(calls.length, 4);

  authorization = { ...authorization, state:'disabled' };
  assert.throws(() => approvalProjection.projection.project({ ownerScope, parameters, sourceResult, preparationScope }),
    /Current Input Settlement Authorization/);
  assert.equal(approvalReads, 2);
  authorization = { ...authorization, state:'enabled' };
  assert.throws(() => handlesProjection.projection.project({ ownerScope, parameters,
    sourceResult:{ ...sourceResult, productManifestDigest:'corrupt' }, preparationScope }),
    /Final Product Verification/);

  readFailure = new Error('Package integrity changed');
  const failedScope = Object.freeze({});
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => handlesProjection.projection.project({ ownerScope, parameters, sourceResult,
      preparationScope:failedScope }), /Package integrity changed/);
  }
  assert.equal(calls.length, 6);
  for (const changed of [
    { ownerScope:{ ...ownerScope, processId:'run-2' } },
    { parameters:{ ...parameters, materialKey:'source-13' } },
    { parameters:{ ...parameters, dependencyRefs:[{ objectType:'on_deck_package', objectId:'package-2' }] } },
    { targetEventId:'settlement-13' },
  ]) {
    assert.throws(() => handlesProjection.projection.project({ ownerScope, parameters, sourceResult,
      preparationScope, ...changed }), /Package integrity changed/);
  }
  assert.equal(calls.length, 10);
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
          oldDirectoryDisposition:'retained_directory',
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

function multipleTargetFixture(){
  const value=fixture(3),keys=value.productMembers.slice(0,2).map(item=>item.materialKey).sort();
  const source={...value.offloadMembers[0],sourceRelatedReferenceId:null,derivedAuthorityDigest:null,
    dispositionKind:'replaced_and_settled',finalProductMaterialKeys:keys};delete source.finalProductMaterialKey;
  const context={...value.context,packageValue:{...value.context.packageValue,
    offloadContextManifest:{...value.context.packageValue.offloadContextManifest,members:[source,...value.offloadMembers.slice(1)]}}};
  return {...value,context,keys,source};
}
test('Series bounded Settlement retains every mapped final member and all protected locations for one source',()=>{
  const f=multipleTargetFixture(),bounded=boundedSettlementContext(f.context,f.responsibility,{},f.source.materialKey);
  assert.deepEqual(bounded.packageValue.productMaterialManifest.members.map(item=>item.materialKey),f.keys);
  assert.deepEqual(bounded.settlementFinalMembers.map(item=>item.sourceMaterialKey),f.keys);
  assert.equal(Object.hasOwn(bounded,'settlementFinalMember'),false);
  assert.deepEqual(bounded.packageValue.offloadContextManifest.members,[f.source]);
  assert.equal(bounded.settlementManagedLocations.length,6);
  assert.equal(bounded.packageValue.productMaterialManifest.manifestDigest,f.context.packageValue.productMaterialManifest.manifestDigest);
  assert.ok(Object.isFrozen(bounded.settlementFinalMembers));
});
test('Series bounded Settlement rejects any missing or ambiguous target instead of selecting a first match',()=>{
  for(const location of ['product','final'])for(const mode of ['missing','duplicate'])for(const index of [0,1]){
    const f=multipleTargetFixture(),key=f.keys[index];
    if(location==='product'){
      const rows=f.context.packageValue.productMaterialManifest.members;
      f.context.packageValue.productMaterialManifest={...f.context.packageValue.productMaterialManifest,
        members:mode==='missing'?rows.filter(item=>item.materialKey!==key):[...rows,rows.find(item=>item.materialKey===key)]};
    }else{
      const rows=f.responsibility.finalInventoryDecision.members;
      f.responsibility={...f.responsibility,finalInventoryDecision:{...f.responsibility.finalInventoryDecision,
        members:mode==='missing'?rows.filter(item=>item.sourceMaterialKey!==key):[...rows,rows.find(item=>item.sourceMaterialKey===key)]}};
    }
    assert.throws(()=>boundedSettlementContext(f.context,f.responsibility,{},f.source.materialKey),/missing or ambiguous/);
  }
  const f=multipleTargetFixture();f.source.finalProductMaterialKey=f.keys[0];
  assert.throws(()=>boundedSettlementContext(f.context,f.responsibility,{},f.source.materialKey),/exactly one/);
});

test('Series Settlement Capability transmits all targets and records complete typed target evidence',async()=>{
  const f=multipleTargetFixture(),c=boundedSettlementContext(f.context,f.responsibility,{},f.source.materialKey),
    finalTargets=c.settlementFinalMembers.map(item=>({materialKey:item.sourceMaterialKey,targetLocation:item.targetLocation})),
    observed=finalTargets.map(item=>({...item,finalRealityDigest:canonicalDigest(item)})),mapping=canonicalDigest(f.source);
  let captured;
  const ports=createOnDeckCapabilityPorts({schemaManifest,unitOfWork:{execute(){throw new Error('unexpected Store write');}},now:()=>100,
    workResultReader:{readBindings:()=>[{inputBindings:{bindings:[{bindingKind:'projected_owner_facts',parameters:{dependencyRefs:[]}}]}}]},
    contextReader:{readSettlement:()=>c},inventoryPort:{async settleInputAsync(request){captured=request;return {
      preDeleteIdentityDigest:canonicalDigest('source'),absent:true,disposition:'settled_to_final',sourceToFinalMappingDigest:mapping,
      finalTargets:observed,finalRealityDigest:canonicalDigest({schema:'arca.settlement-final-targets@1',members:observed}),
      finalVerified:true,oldDirectoryDisposition:'retained_directory'};}}});
  const outcome=await ports[CAPABILITY_REFS.settlement].execute({ownerScope:{processType:'arca_ondeck_run',processId:'run-1'},
    workId:'work',eventId:'event',idempotencyKey:'key',effectOccurredAtMs:100,namedInputs:{
      oldPrimaryStructuralExclusiveRelatedHandleList:{digest:canonicalDigest('scope'),members:[{materialKey:f.source.materialKey,
        materialHandle:{location:f.source.location},finalTargets,sourceToFinalMappingDigest:mapping,settlementExpectation:'remove_after_place'}]},
      inputSettlementApproval:{approvalId:'approval'}}});
  assert.equal(outcome.kind,'succeeded');assert.deepEqual(captured.finalTargets,finalTargets);
  assert.equal(Object.hasOwn(captured,'finalMaterialKey'),false);
  assert.equal(captured.finalInventoryRequest.finalInventoryMembers,c.settlementFinalMembers);
  const entries=new Map(outcome.result.postDeleteReality.entries.map(item=>[item.key,item.value]));
  assert.deepEqual(entries.get('final_targets'),observed);assert.equal(entries.has('final_material_key'),false);
});
