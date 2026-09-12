'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {observeEmptyStageSlot}=require('../../src/helix/integrations/empty-stage-slot-observer');
const {createTerminalStageHistoryObserver}=require('../../src/helix/domains/arca/application/terminal-stage-history-observer');
const H='a'.repeat(64),C='arca.inventory.product.stage@1';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-stage-proof-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const target=path.join(root,'Movie'),run='run',key=H;
  const suffix=canonicalDigest({schema:'arca.inventory-stage-slot@1',onDeckRunId:run,finalInventoryDecisionDigest:H}).slice(0,16);
  const directory=path.join(root,'.shelfdeck-stage-'+suffix);fs.mkdirSync(directory);
  const slot={schemaRef:'helix://contracts/types/TargetCommitSlotHandle/v1',schemaVersion:1,transactionRevision:1,
    onDeckRunId:run,targetEndpointId:'endpoint',targetDirectory:target,slotDirectory:directory,finalInventoryDecisionDigest:H,
    slotId:canonicalDigest({schema:'arca.target-commit-slot-id@1',onDeckRunId:run,targetEndpointId:'endpoint',targetLocation:target,finalInventoryDecisionDigest:H}),
    containmentDigest:canonicalDigest({schema:'arca.target-slot-containment@1',targetRoot:root,targetDirectory:target,slotDirectory:directory})};
  const deps=[{objectType:'on_deck_package',objectId:'package',digest:H,revision:1},{objectType:'handoff_b_offer',objectId:'offer',digest:H,revision:1}];
  const definition={workId:'work',processId:run,ownerDomain:'arca',dependencyRefs:deps};
  const bindings=[{portName:'productMaterialHandleList',bindingKind:'projected_owner_facts',ownerDomain:'arca',processType:'arca_ondeck_run',processId:run,
    projectionRef:'helix://arca/input-projections/ProductMaterialHandles/v1',parameters:{dependencyRefs:deps}},
    {portName:'targetCommitSlotHandle',bindingKind:'projected_event_result',eventId:'slot-event',projectionRef:'helix://arca/input-projections/TargetCommitSlotHandle/v1',parameters:{dependencyRefs:deps}}];
  const input=canonicalDigest({productMaterialHandleList:[{known:'source'}],targetCommitSlotHandle:slot});
  const facts={plan:{plan_id:'plan'},work:{work_id:'work',owner_domain:'arca',process_type:'arca_ondeck_run',process_id:run,work_kind:'on_deck_execution',
    state:'failed',definition_json:JSON.stringify(definition),definition_digest:canonicalDigest(definition)},workAttempt:{state:'failed'},
    nodes:[{node_id:'stage',input_bindings_json:JSON.stringify({bindings})}],events:[{event_id:'stage-event',node_id:'stage',state:'failed',capability_ref:C,contract_version:1},
      {event_id:'slot-event',node_id:'slot',state:'succeeded',capability_ref:'arca.inventory.target_slot.prepare@1'}],
    attempts:[{event_attempt_id:'attempt',event_id:'stage-event',state:'completed',outcome_kind:'failed',input_snapshot_digest:input,fence_snapshot_digest:H}],
    effects:[{effect_id:'effect',event_attempt_id:'attempt',state:'reconcile_required',effect_class:'material_commit',intent_digest:canonicalDigest({eventId:'stage-event',capabilityRef:C,contractVersion:1,inputSnapshotDigest:input,fenceSnapshotDigest:H})}],
    edges:[{from_node_id:'slot',to_node_id:'stage',dependency_kind:'success'}],
    results:[{event_id:'slot-event',result_id:'slot-result',result_json:JSON.stringify(slot),result_digest:canonicalDigest(slot)}]};
  const responsibility={runState:'blocked',onDeckRunId:run,custodyId:'custody',shelfId:'shelf',offerId:'offer',onDeckPackageId:'package',packageDigest:H,
    placementRevision:1,standardRevision:1,finalInventoryDecision:{decisionDigest:H,members:[{targetLocation:path.join(target,'movie.mkv')}]} };
  const control={materialKey:key,resultKind:'available',controlState:'controlled',ownerDomain:'arca',ownerScopeType:'on_deck_custody',ownerScopeId:'custody'};
  const options={contextReader:{acceptance:{readRunResponsibility:()=>structuredClone(responsibility)}},stageHistoryShelfReader:{getShelf:()=>({status:'active',currentPlacementRevision:1,currentStandardRevision:1,target:{endpointId:'endpoint',rootLocation:root}})},
    productDeliveryPort:{readPackage:()=>({resultKind:'found',onDeckProductPackage:{productMaterialManifest:{members:[{materialKey:key,workspaceMaterialHandle:{known:'source'}}]},offloadContextManifest:{members:[]}}})},
    stageHistoryControlReader:{readScope:()=>({items:[control]})},stageHistoryArcaBindingReader:{read:()=>({ownerDomain:'arca',count:0,digest:H})},
    stageHistoryLibraBindingReader:{read:()=>({ownerDomain:'libra',count:0,digest:H})},
    workResultReader:{listWorks:()=>[structuredClone(facts.work)],status:()=>({state:'failed',latestAttempt:{state:'failed'}})},
    readTechnicalWork:()=>[structuredClone(facts)],inventoryPort:{observeEmptyStageSlot}};
  return {root,directory,slot,facts,options,control,observe:()=>createTerminalStageHistoryObserver(options).observe(facts)};
}
test('empty stage proof preserves blocked Accepted responsibility and does not touch final files',t=>{
  const f=fixture(t);fs.mkdirSync(f.slot.targetDirectory);const final=path.join(f.slot.targetDirectory,'other-owner.nfo');fs.writeFileSync(final,'owned bytes');
  const before=JSON.stringify(f.facts),proof=f.observe();assert.equal(proof.length,1);assert.equal(proof[0].disposition,'no_remaining_material_effect');
  assert.equal(fs.readFileSync(final,'utf8'),'owned bytes');assert.equal(JSON.stringify(f.facts),before);assert.deepEqual(fs.readdirSync(f.directory),[]);
});
for(const [name,mutate] of [
  ['remaining tmp output',f=>fs.writeFileSync(path.join(f.directory,'.tmp'),'partial')],
  ['missing slot',f=>fs.rmdirSync(f.directory)],
  ['active Work',f=>f.options.workResultReader.listWorks=()=>[{state:'running'}]],
  ['active Attempt',f=>f.options.workResultReader.status=()=>({state:'failed',latestAttempt:{state:'running'}})],
  ['extra Control',f=>f.options.stageHistoryControlReader.readScope=()=>({items:[f.control,{...f.control,materialKey:'b'.repeat(64)}]})],
  ['missing original Control',f=>f.options.stageHistoryControlReader.readScope=()=>({items:[]})],
  ['Libra slot reference',f=>f.options.stageHistoryLibraBindingReader.read=()=>({ownerDomain:'libra',count:1,digest:H})],
  ['input mismatch',f=>f.facts.attempts[0].input_snapshot_digest='b'.repeat(64)],
  ['intent mismatch',f=>f.facts.effects[0].intent_digest=H],
  ['slot source digest mismatch',f=>f.facts.results[0].result_digest=H],
  ['Owner drift during observation',f=>f.options.inventoryPort.observeEmptyStageSlot=request=>{const result=observeEmptyStageSlot(request);f.options.stageHistoryArcaBindingReader.read=()=>({ownerDomain:'arca',count:0,digest:'b'.repeat(64)});return result;}],
  ['filesystem permission failure',f=>f.options.inventoryPort.observeEmptyStageSlot=()=>{throw Object.assign(new Error('permission denied'),{code:'EACCES'});}],
])test('stage history blocks '+name,t=>{const f=fixture(t);mutate(f);assert.throws(()=>f.observe());});
test('stage observer rejects linked directory',t=>{
  const f=fixture(t),other=path.join(f.root,'other');fs.mkdirSync(other);fs.rmdirSync(f.directory);
  try{fs.symlinkSync(other,f.directory,process.platform==='win32'?'junction':'dir');}catch(error){if(error.code==='EPERM'){t.skip('symlink permission unavailable');return;}throw error;}
  assert.throws(()=>f.observe());
});
