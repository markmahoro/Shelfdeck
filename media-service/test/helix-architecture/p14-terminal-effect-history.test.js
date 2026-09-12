'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { settlementHandles } = require('../../src/helix/domains/arca/model/historical-on-deck-effect-inputs');
const { createTerminalEffectHistoryObserver } = require('../../src/helix/domains/arca/application/terminal-effect-history-observer');
const H = 'a'.repeat(64), C = 'arca.ondeck.input_settlement.delete@1';

function fixture() {
  const identity = { materialKey:'material', sizeBytes:10 };
  const source = { materialKey:'material', contextRole:'original_input', physicalIdentity:identity, memberDigest:H,
    bindingRevision:1, endpointId:'endpoint', location:'/source/movie.mkv', finalProductMaterialKey:'product',
    sourceRelatedReferenceId:null, derivedAuthorityDigest:null, settlementExpectation:'replace_or_move', dispositionKind:'replaced_and_settled' };
  const responsibility = { runState:'committed', onDeckRunId:'run', custodyId:'custody', offerId:'offer',
    onDeckPackageId:'package', packageDigest:H, shelfId:'shelf', finalInventoryDecision:{ decisionDigest:H,
      members:[{ sourceMaterialKey:'product', targetLocation:'/final/movie.mkv' }] } };
  const packageValue = { onDeckPackageId:'package', packageDigest:H, productionAttestation:{productConformanceEvidenceDigest:H},
    productMaterialManifest:{manifestDigest:H}, offloadContextManifest:{members:[source]} };
  const context = { responsibility, packageValue, settlementFinalMember:responsibility.finalInventoryDecision.members[0] };
  const handles = settlementHandles(context, 'material');
  const dependencyRefs = [{objectType:'on_deck_package', objectId:'package', digest:H, revision:1},
    {objectType:'handoff_b_offer', objectId:'offer', digest:H, revision:1}];
  const definition = workId => ({ workId, processId:'run', ownerDomain:'arca', workKind:'on_deck_execution', dependencyRefs });
  function facts(workId, failed) {
    const value = definition(workId), eventId = workId + '-delete';
    const bindings = [
      { portName:'oldPrimaryStructuralExclusiveRelatedHandleList', projectionRef:'helix://arca/input-projections/SettlementHandles/v1', parameters:{materialKey:'material',dependencyRefs} },
      { portName:'inputSettlementApproval', projectionRef:'helix://arca/input-projections/SettlementApproval/v1', parameters:{materialKey:'material',dependencyRefs,eventId} },
    ].map(b => ({...b,bindingKind:'projected_owner_facts',ownerDomain:'arca',processType:'arca_ondeck_run',processId:'run'}));
    return { plan:{plan_id:workId+'-plan'}, work:{ work_id:workId, owner_domain:'arca', process_type:'arca_ondeck_run', process_id:'run',
      work_kind:'on_deck_execution', state:failed?'failed':'succeeded', definition_json:JSON.stringify(value), definition_digest:canonicalDigest(value) },
      workAttempt:{state:failed?'failed':'succeeded'}, nodes:[{node_id:'delete',input_bindings_json:JSON.stringify({bindings})}],
      events:[{node_id:'delete',event_id:eventId,capability_ref:C,state:failed?'failed':'succeeded'}],
      attempts:[{event_attempt_id:workId+'-attempt',event_id:eventId,state:'completed',outcome_kind:failed?'failed':'succeeded'}],
      effects:[{effect_id:workId+'-effect',event_attempt_id:workId+'-attempt',effect_class:'destructive_commit',state:failed?'reconcile_required':'committed'}],
      results:[],edges:[] };
  }
  const old = facts('old', true), next = facts('next', false);
  const values = { stage:{sourceProductManifestDigest:H,targetCommitSlotId:'slot',stagedMembers:[{sourceMaterialKey:'product',location:'/final/movie.mkv',physicalIdentity:identity}]},
    placement:{targetCommitSlotId:'slot',scopeId:'run'}, verification:{result:'passed',productManifestDigest:H,verifiedMaterialKeys:['product'],
      memberEvidence:[{sourceProductMaterialKey:'product',actualPhysicalIdentity:identity}]}, fulfillment:{result:'passed'}, commit:{receipt:'owner-commit'} };
  const record = {schemaRef:'arca://types/PostDeleteReality/v1',schemaVersion:1,recordKind:'post-delete-reality',entries:Object.entries({
    absent:true,disposition:'settled_to_final',final_verified:true,source_to_final_mapping_digest:handles.members[0].sourceToFinalMappingDigest,
    final_material_key:'product',final_target_location:'/final/movie.mkv',final_reality_digest:H}).map(([key,value])=>({key,value}))};
  const evidence = {materialKey:'material',basisDigest:handles.digest,
    authorizationOrApprovalRef:'arca-settlement-approval-'+canonicalDigest({run:'run',key:'material'}).slice(0,40),
    preDeleteIdentityDigest:canonicalDigest(identity),effectReceiptId:'physical-receipt',postDeleteReality:{...record,recordDigest:canonicalDigest(record)}};
  function put(eventId, value, receipt=null) {
    next.results.push({event_id:eventId,result_id:eventId+'-result',result_json:JSON.stringify(value),result_digest:canonicalDigest(value),effect_receipt_id:receipt});
  }
  put('next-delete', {...evidence,payloadDigest:canonicalDigest(evidence)}, 'physical-receipt');
  for (const [id, capability] of [['stage','arca.inventory.product.stage@1'],['placement','arca.inventory.placement.switch@1'],
    ['verification','arca.inventory.final_product.verify@1'],['fulfillment','arca.ondeck.fulfillment.verify@1'],['commit','arca.ondeck.commit@1']]) {
    next.events.push({node_id:id,event_id:id,capability_ref:capability,state:'succeeded'}); put(id,values[id]);
  }
  for(const [from,to] of [['stage','placement'],['placement','verification'],['verification','delete'],['delete','fulfillment'],['fulfillment','commit']])
    next.edges.push({from_node_id:from,to_node_id:to,dependency_kind:'success'});
  const works=[old.work,next.work];
  const options={ contextReader:{acceptance:{readRunResponsibility:()=>responsibility},onDeck:{readHistoricalCommitted:()=>({result:values.commit})}},
    productDeliveryPort:{readPackage:query=>{assert.equal(query.readPurpose,'historical');return {resultKind:'found',onDeckProductPackage:packageValue};}},
    workResultReader:{listWorks:()=>works},readTechnicalWork:()=>[next] };
  return {old,next,works,options, observe:()=>createTerminalEffectHistoryObserver(options).observe(old)};
}

test('Owner history proof uses exact immutable scope and preserves the historical authorization gap', () => {
  const f=fixture(), before=JSON.stringify([f.old,f.next]);
  const proof=f.observe(); assert.equal(proof.length,1);
  assert.equal(proof[0].historicalAuthorization,'unproven_system_policy');
  assert.equal(JSON.stringify([f.old,f.next]),before);
});

for(const [name,mutate] of [
  ['active writer',f=>f.works.push({state:'running'})],
  ['stage Effect',f=>f.old.events[0].capability_ref='arca.inventory.product.stage@1'],
  ['missing Final Verify',f=>f.next.events=f.next.events.filter(e=>e.node_id!=='verification')],
  ['broken commit dependency',f=>f.next.edges=f.next.edges.filter(e=>e.to_node_id!=='commit')],
  ['different Owner Receipt',f=>f.options.contextReader.onDeck.readHistoricalCommitted=()=>({result:{receipt:'foreign'}})],
  ['ambiguous successor',f=>f.options.readTechnicalWork=()=>[f.next,structuredClone(f.next)]],
  ['foreign immutable package',f=>f.options.productDeliveryPort.readPackage=()=>({resultKind:'not_found'})],
]) test('Owner history rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>f.observe());});
