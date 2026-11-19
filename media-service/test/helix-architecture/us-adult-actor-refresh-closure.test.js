'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {fixture:inventoryContext}=require('./fixtures/us-adult-inventory-context');
const {initialReference}=require('./fixtures/us-adult-initial-reference');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
const {createExecutionProgressProjectionReader}=require('../../src/helix/foundation/execution/progress-projection-reader');
const {createEffectReconcilerRegistry}=require('../../src/helix/foundation/effects/effect-reconcilers');
const {createPeopleStore}=require('../../src/helix/domains/people/persistence/people-store');
const {createAftercareStore}=require('../../src/helix/domains/arca/persistence/aftercare-store');
const {createUsAdultActorRefreshStore}=require('../../src/helix/domains/arca/persistence/us-adult-actor-refresh-store');
const {createUsAdultActorRefreshCommand}=require('../../src/helix/domains/arca/application/us-adult-actor-refresh-command');
const {createUsAdultActorPipelineQuery}=require('../../src/helix/domains/arca/application/us-adult-actor-pipeline-query');
const {createUsAdultActorPipelinePorts}=require('../../src/helix/domains/arca/capabilities/us-adult-actor-pipeline-ports');
const {createUsAdultActorRefreshCoordinator}=require('../../src/helix/domains/arca/application/us-adult-actor-refresh-coordinator');
const {createUsAdultActorRefreshAdmin}=require('../../src/helix/domains/arca/application/us-adult-actor-refresh-admin');
const {createAftercareProcessCoordinator}=require('../../src/helix/domains/arca/application/aftercare-process-coordinator');
const {CAPS,phaseWork,executionInput}=require('../../src/helix/domains/arca/model/us-adult-actor-pipeline');
const {sourceWork}=require('../../src/helix/domains/arca/model/us-adult-actor-refresh-execution');
const {buildSelection}=require('../../src/helix/domains/arca/model/us-adult-actor-selection');
const {buildFacts,buildFilePlan}=require('../../src/helix/domains/arca/model/us-adult-actor-products');
const {sourcePrepared}=require('../../src/helix/contracts/us-adult-inventory-analysis');
const {faceModelReference}=require('../../src/helix/contracts/us-adult-face-model');
const {createUsAdultInventorySource}=require('../../src/helix/integrations/us-adult-inventory-source');
const {createUsAdultInventoryWorkspace}=require('../../src/helix/integrations/us-adult-inventory-workspace');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {physicalIdentityFromInventoryRow}=require('../../src/helix/domains/arca/model/aftercare-contract');

const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));

function collectRuntimeValidator(){
  const root=path.resolve(__dirname,'../../src/helix/contracts'),pending=[root],schemas=[];
  while(pending.length){
    const dir=pending.pop();
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const loc=path.join(dir,entry.name);
      if(entry.isDirectory())pending.push(loc);
      else if(entry.isFile()&&entry.name.endsWith('schema.json')){
        const value=JSON.parse(fs.readFileSync(loc,'utf8'));
        if(typeof value.$id==='string')schemas.push(value);
      }
    }
  }
  return createCapabilityContractValidator({schemas});
}

function localFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-actor-closure-')),databasePath=path.join(root,'shelfdeck.db'),
    context=inventoryContext(),validator=collectRuntimeValidator(),
    kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>10000}),
    unitOfWork=createSqliteUnitOfWork({kernel}),db=new Database(databasePath);
  db.pragma('foreign_keys=OFF');
  t.after(()=>{db.close();kernel.close();if(path.dirname(fs.realpathSync(root))!==fs.realpathSync(os.tmpdir()))throw new Error('Fixture escapes temp.');fs.rmSync(root,{recursive:true,force:true});});
  Object.assign(context.raw.entry,{shelf_id:'shelf',created_at_ms:10000,terminal_at_ms:null});
  const placementValue={folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',
    subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'};
  Object.assign(context.raw.shelf,{shelf_id:'shelf',target_endpoint_id:'endpoint',target_root_location:root,
    target_mount_scope_id:'mount',target_mount_scope_revision:1,current_standard_revision:1,current_placement_revision:1});
  context.raw.placement={revision:1,value:placementValue,policy_digest:D(placementValue)};
  const basis={schemaRef:'helix://contracts/domain-types/CareBasis/v1',schemaVersion:1,objectId:'entry:care-basis',revision:1,shelfEntryId:'entry',
    inventoryRevision:2,standardRevision:1,placementRevision:1,canonicalIdentityDigest:context.raw.identity.identity_digest,sourcePackageId:'package',
    acceptedProductFactSetDigest:D(context.raw.facts),decisionFactSetDigest:D('decisions'),assessments:[]};
  context.basis={...basis,digest:D(basis)};context.knownBindings={digest:D('known-bindings')};
  db.prepare('INSERT INTO arca_shelves VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('shelf','Shelf','endpoint',root,'mount',1,'active',1,1,1,D('route'),10000,10000);
  db.prepare('INSERT INTO arca_shelf_standard_revisions VALUES(?,?,?,?,?,?,?,?)').run('shelf',1,'fixture',1,'fixture-standard','{}',D('standard'),10000);
  db.prepare('INSERT INTO arca_placement_policy_revisions VALUES(?,?,?,?,?,?)').run('shelf',1,'fixture-placement',canonicalJson(placementValue),D(placementValue),10000);
  db.prepare('INSERT INTO arca_shelf_entries VALUES(?,?,?,?,?,?,?,?,?,?)').run('entry','shelf','single','active',1,context.raw.entry.canonical_identity_key,2,1,10000,null);
  db.prepare('INSERT INTO arca_inventory_representations VALUES(?,?,?,?,?)').run('entry',2,context.raw.inventory.representation_digest,'package',10000);
  db.prepare('INSERT INTO arca_canonical_identity_revisions VALUES(?,?,?,?,?,?,?,?)').run('entry',1,'single','internal_identity','internal','fixture-source',context.raw.identity.identity_digest,10000);
  db.prepare('INSERT INTO arca_deck_fact_revisions VALUES(?,?,?,?,?,?,?)').run('entry',1,'active',2,1,D('deck'),10000);
  const people=createPeopleStore({schemaManifest,unitOfWork});
  for(const personId of ['actor-a','actor-b']){
    const value={decisionId:'register-'+personId,newPersonId:personId,libraryKind:'us_adult',canonicalName:personId,aliases:[],providerIdentities:[],actorId:'admin',initialReference:initialReference(personId,'admin')};
    people.registerDirectPerson({...value,decisionDigest:D(value)});
  }
  const roles=[['primary_payload','Original.mkv',500000,11],['metadata_sidecar','Original.nfo',120,22],['poster','poster.jpg',4000,33]];
  context.raw.materials=roles.map(([role,name,size,fill],ordinal)=>{
    const loc=path.join(root,name);fs.writeFileSync(loc,Buffer.alloc(size,fill));
    const observed=computeBoundedMaterialFingerprintSync(loc),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
      fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
    return {ordinal,role,material_key:D({schema:'physical-material-identity@2',...tuple}),mount_scope_id:tuple.mountScopeId,
      inode:tuple.inode,size_bytes:tuple.sizeBytes,fingerprint_algorithm:tuple.fingerprintAlgorithm,fingerprint_version:tuple.fingerprintVersion,
      content_fingerprint:tuple.contentFingerprint,endpoint_id:'endpoint',location:loc,binding_revision:1,digest_hex:D(name),
      episode_claims_json:'{"items":[]}',episode_claim_set_digest:D('claims')};
  });
  for(const row of context.raw.facts){row.fact_digest=D(row.value);row.fact_json=canonicalJson(row.value);row.fact_revision=1;}
  const failures=new Map();
  const failureEvidenceStore={write(ev){failures.set(D(ev),ev);},read(digest){return failures.get(digest)||null;}};
  const dependencies={schemaManifest,unitOfWork,contractValidator:validator,now:()=>10000,aftercareWorkspaceRoot:path.join(root,'aftercare'),failureEvidenceStore};
  const care=createAftercareStore(dependencies),store=createUsAdultActorRefreshStore(dependencies),queryPeople=createPeopleStore(dependencies),
    reader={store:care,read:()=>context,sourceTargetBinding:(_entryId,row)=>({endpointId:'endpoint',rootLocation:root,mountScopeId:'mount',mountScopeRevision:1,location:row.location})},
    query={readUsAdultPersonSnapshot:req=>queryPeople.readUsAdultPersonSnapshot(req),readUsAdultReferencePage:req=>queryPeople.readUsAdultReferencePage({...req,limit:1})},
    command=createUsAdultActorRefreshCommand({actorRefreshStore:store,aftercareContextReader:reader,peopleReferenceQuery:query,contractValidator:validator});
  const request={mode:'specified',idempotencyKey:'refresh',expectedInventoryRevision:2,expectedRepresentationDigest:context.raw.inventory.representation_digest,
    personId:'actor-a',expectedPersonRevision:1,expectedReferenceRevision:1};
  return {root,db,context,request,validator,dependencies,care,store,reader,query,command,failures};
}

function seedSecondEntry(f){
  const id='entry-2',shelf=f.context.raw.shelf,basis={schemaRef:'helix://contracts/domain-types/CareBasis/v1',schemaVersion:1,
    objectId:id+':care-basis',revision:1,shelfEntryId:id,inventoryRevision:1,standardRevision:1,placementRevision:1,
    canonicalIdentityDigest:D('identity-2'),sourcePackageId:'package-2',acceptedProductFactSetDigest:D('facts-2'),
    decisionFactSetDigest:D('decisions-2'),assessments:[]};
  f.db.prepare('INSERT INTO arca_shelf_entries VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,shelf.shelf_id,'single','active',1,D('key-2'),1,1,10000,null);
  f.db.prepare('INSERT INTO arca_inventory_representations VALUES(?,?,?,?,?)').run(id,1,D('rep-2'),'package-2',10000);
  f.db.prepare('INSERT INTO arca_canonical_identity_revisions VALUES(?,?,?,?,?,?,?,?)').run(id,1,'single','internal_identity','internal','fixture-source-2',D('identity-2'),10000);
  f.db.prepare('INSERT INTO arca_deck_fact_revisions VALUES(?,?,?,?,?,?,?)').run(id,1,'active',1,1,D('deck-2'),10000);
  const reqBase={schemaRef:'helix://contracts/domain-types/CareRequirement/v1',schemaVersion:1,requirementId:'req-2',revision:1,
    careBasisDigest:D(basis),requiredEffects:[{objectId:'finding-2',revision:1,schemaRef:'required-effect',digest:D('finding-2'),objectKind:'required-effect'}],
    acceptanceDigest:D('accept-2'),typedParameters:[{parameter:'goal',valueType:'string',value:'presentation:nfo_missing',valueDigest:D('presentation:nfo_missing')}]};
  return f.care.createCase({shelfEntryId:id,careBasis:{...basis,digest:D(basis)},careRequirement:{...reqBase,digest:D(reqBase)},
    findingSetDigest:D('finding-set-2'),triggerDigest:D('trigger-2'),basisInputs:[]});
}

function insertWork(db,work,state,createdAtMs=10000){
  const defJson=canonicalJson(work),defDigest=D(work),
    receiptResult=Object.freeze({kind:'admitted',workId:work.workId,state:'admitted',replayed:false}),
    receiptJson=canonicalJson(receiptResult);
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,state,basis_digest,definition_schema_ref,definition_json,definition_digest,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(work.workId,work.ownerDomain,work.processType,work.processId,work.workKind,state,work.executionBasisDigest,
      work.schemaRef,defJson,defDigest,createdAtMs,createdAtMs);
  db.prepare('INSERT INTO fx_command_receipts(command_receipt_id,owner_domain,command_contract,caller_scope,idempotency_key,request_digest,target_type,target_id,result_schema_ref,result_ref_json,result_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('work-admission/'+work.ownerDomain+'/'+work.workId,work.ownerDomain,'helix.foundation.work.submit@1',
      work.ownerDomain+':'+work.concurrencyScope,work.idempotencyKey,defDigest,'supporting_work',work.workId,
      'helix://foundation/results/WorkAdmissionResult/v1',receiptJson,D(receiptResult),createdAtMs);
}

function insertSucceededWork(db,work,capabilityRef,resultSchemaRef,result,createdAtMs=10000){
  insertWork(db,work,'succeeded',createdAtMs);
  const attemptId=work.workId+':attempt:1',planId=work.workId+':plan',eventId=work.workId+':event',resultId=work.workId+':result',
    bindings=canonicalJson({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]}),
    evidence={evidenceId:'ev-'+eventId,evidenceKind:'fixture',producerRef:capabilityRef,basisDigest:work.executionBasisDigest,
      payloadDigest:D(result),observedAtMs:createdAtMs};
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run(attemptId,work.workId,1,work.executionBasisDigest,'succeeded',createdAtMs,createdAtMs);
  db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(planId,attemptId,'fixture://planner',1,D('catalog'),work.executionBasisDigest,D('graph'),'planned',createdAtMs);
  db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameter_schema_ref,parameters_json,when_schema_ref,when_json,effect_class,fence_schema_ref,fence_basis_json,resource_demand_schema_ref,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(planId,'node',capabilityRef,1,'helix://foundation/types/EventInputBindingSet/v1',bindings,'p','{}','w','null','workspace_write','f','{}','r','{}');
  db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,planId,'node',work.workId,attemptId,'arca',capabilityRef,1,'succeeded','normal_foreground',resultId);
  db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ea-'+eventId,eventId,1,capabilityRef,1,'in',D('in'),D('fence'),'completed','succeeded',createdAtMs,createdAtMs);
  db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(resultId,eventId,'succeeded',resultSchemaRef,canonicalJson(result),D(result),'ev-schema',canonicalJson(evidence),D(evidence),createdAtMs);
}

function setupPipeline(t,{filesOverride}={}){
  const f=localFixture(t);
  const admitted=f.command.request('entry',f.request,'admin'),care=f.care.admitCase(admitted.aftercareCaseId),
    intent=f.store.get(admitted.intentId).intent;
  const workResultReader=createWorkResultReader(f.dependencies);
  const progressProjectionReader=createExecutionProgressProjectionReader(f.dependencies);
  const primary=f.context.raw.materials.find(item=>item.role==='primary_payload');
  const sourceWorkDef=sourceWork(intent,care.aftercareCaseId);
  const sourceHandle=createUsAdultInventorySource({assertAuthority:()=>true,now:()=>10000}).issueReadHandle({
    intent,aftercareCaseId:care.aftercareCaseId,identity:physicalIdentityFromInventoryRow(primary),
    binding:{endpointId:primary.endpoint_id,bindingRevision:primary.binding_revision,location:primary.location},
    target:f.reader.sourceTargetBinding('entry',primary),context:{ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},assertExecutionActive(){}}});
  const ws=createUsAdultInventoryWorkspace({rootSnapshot:{...f.care.aftercareWorkspaceRootSnapshot,resolvedRoot:f.dependencies.aftercareWorkspaceRoot},
    ensureWorkspace:f.care.ensureAftercareWorkspace,registerMaterial:f.care.registerAftercareWorkspaceMaterial,
    assertRegistered:handle=>f.care.listAftercareWorkspaceHandles(care.aftercareCaseId).some(v=>canonicalJson(v)===canonicalJson(handle))});
  const wsCtx={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},assertExecutionActive(){}};
  const writeWs=(kind,bytes)=>ws.write({intent,aftercareCaseId:care.aftercareCaseId,context:wsCtx,kind,bytes});
  const sourceResult=sourcePrepared({intent,aftercareCaseId:care.aftercareCaseId,sourceHandle,sourceProbeDigest:D('probe'),durationMs:1000,
    container:'matroska',analysis:{analysisDigest:D('analysis'),detectedFaceCount:1,modelRef:faceModelReference('western_frame_set'),
      referenceModelRefDigest:intent.referenceModelRefDigest},frameManifestHandle:writeWs('frames',Buffer.from('{}')),
    featuresHandle:writeWs('features',Buffer.from('{}')),atMs:10000});
  insertSucceededWork(f.db,sourceWorkDef,'arca.us_adult.source.prepare@1','helix://contracts/capabilities/arca.us_adult.source.prepare/v1/result',sourceResult,10001);

  const selection=buildSelection({intent,aftercareCaseId:care.aftercareCaseId,sourceRecord:workResultReader.read(sourceWorkDef.workId)[0],
    pages:[],records:[],contractValidator:f.validator}).selection;
  const assetsWorkDef=phaseWork(intent,care,'assets',[{ownerDomain:'arca',objectType:'supporting_work',objectId:sourceWorkDef.workId,revision:1,digest:D(sourceResult)},
    {ownerDomain:'arca',objectType:'actor_refresh_selection',objectId:care.aftercareCaseId,revision:1,digest:selection.selectionDigest}]);
  const facts=buildFacts(f.context,selection),nfoHandle=writeWs('nfo',Buffer.from('<movie><title>actor-a</title></movie>')),
    posterHandle=writeWs('poster',Buffer.from('poster-bytes')),
    factsHandle=writeWs('facts',Buffer.from(canonicalJson({selection,metadata:facts.metadata,cast:facts.cast}))),
    plan=buildFilePlan({context:f.context,selection,outputs:{nfoHandle,posterHandle},
      inventoryPort:{prepare:req=>({decisionDigest:D('place'),members:req.onDeckProductPackage.productMaterialManifest.members.map(m=>({
        sourceMaterialKey:m.materialKey,targetEndpointId:'endpoint',
        targetLocation:path.join(f.root,'actor-a Studio.Scene.1080p',m.role==='poster'?'poster.jpg':m.role==='metadata_sidecar'?'actor-a Studio.Scene.1080p.nfo':'actor-a Studio.Scene.1080p.mkv')}))})},
      sourceTargetBinding:f.reader.sourceTargetBinding,atMs:10000}),
    planHandle=writeWs('plan',Buffer.from(canonicalJson(plan)));
  const assetsBody={aftercareCaseId:care.aftercareCaseId,shelfEntryId:'entry',intentId:intent.intentId,intentDigest:intent.intentDigest,
    selectionDigest:selection.selectionDigest,sourceResultDigest:D(sourceResult),factsHandle,nfoHandle,posterHandle,planHandle,planDigest:plan.planDigest};
  const assetsResult={schemaRef:'helix://contracts/types/ArcaUsAdultAssetsPrepared/v1',schemaVersion:1,
    evidenceId:'ev-assets',evidenceKind:'us_adult_actor_assets',producerRef:CAPS.assets,basisDigest:intent.intentDigest,
    payloadDigest:D(assetsBody),observedAtMs:10000,...assetsBody};
  insertSucceededWork(f.db,assetsWorkDef,CAPS.assets,'helix://contracts/capabilities/arca.us_adult.assets.prepare/v1/result',assetsResult,10002);

  const actorRefreshSource={store:f.store,read:()=>({intent,care}),assertAuthority:()=>true,workspaceRoot:f.care.aftercareWorkspaceRootSnapshot};
  const materialControlProjectionPort={getMaterialControlProjections:keys=>keys.map(k=>({materialKey:k,resultKind:'available',controlState:'controlled',ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:'entry'}))};
  const actorPipelineQuery=createUsAdultActorPipelineQuery({...f.dependencies,actorRefreshSource,aftercareContextReader:f.reader,workResultReader,materialControlProjectionPort,
    createUsAdultInventoryAnalysisPort:({aftercareCaseId:cid})=>({
      readJson:handle=>ws.readJson({intent,aftercareCaseId:cid,context:wsCtx,handle}),
      files:filesOverride?filesOverride(plan):{async stage(){throw new Error('stub');},async observe(){throw new Error('stub');}},
    })});
  const ports=createUsAdultActorPipelinePorts({...f.dependencies,actorPipelineQuery,aftercareContextReader:f.reader,workResultReader,materialControlProjectionPort});
  const stageWorkDef=phaseWork(intent,care,'stage',[
    {ownerDomain:'arca',objectType:'supporting_work',objectId:assetsWorkDef.workId,revision:1,digest:D(assetsResult)},
  ]);
  const cancelledWorks=[];
  let cancelDraining=0;
  const cancelProcessWorks=scope=>{cancelledWorks.push(scope);return {drainingWorks:cancelDraining};};
  const actorRefreshCoordinator=createUsAdultActorRefreshCoordinator({...f.dependencies,actorPipelineQuery,aftercareContextReader:f.reader,workResultReader,cancelProcessWorks});
  const aftercareCoordinator=createAftercareProcessCoordinator({...f.dependencies,contextReader:f.reader,workResultReader,progressProjectionReader,actorRefreshCoordinator,cancelProcessWorks});
  const admin=createUsAdultActorRefreshAdmin({...f.dependencies,actorRefreshSource,actorPipelineQuery,aftercareContextReader:f.reader,workResultReader,peopleReferenceQuery:f.query});
  return {f,care,intent,selection,plan,sourceWorkDef,assetsWorkDef,assetsResult,stageWorkDef,workResultReader,progressProjectionReader,
    actorPipelineQuery,ports,actorRefreshCoordinator,aftercareCoordinator,admin,cancelledWorks,setCancelDraining:n=>{cancelDraining=n;}};
}

test('observeEffectReality classifies transient CIFS I/O errors as unobservable while keeping real conflicts terminal',async t=>{
  let nextObserveError=null;
  const x=setupPipeline(t,{filesOverride:()=>({async observe(){throw nextObserveError;}})});
  insertWork(x.f.db,x.stageWorkDef,'running');
  const stagePort=x.ports[CAPS.stage];
  const reconciler=createEffectReconcilerRegistry({observers:{
    workspace_write:{observe:async()=>({status:'absent',cleanupDeclared:false,evidenceDigest:D('w')})},
    external_request:{observe:async()=>({status:'absent',evidenceDigest:D('e')})},
    domain_fact_commit:{observe:async()=>({status:'absent',revisionMatches:true,fenceValid:true,evidenceDigest:D('d')})},
    responsibility_control_commit:{observe:async()=>({status:'whole_absent',fenceValid:true,evidenceDigest:D('r')})},
    material_commit:{observe:stagePort.observeEffectReality},
    destructive_commit:{observe:async()=>({status:'complete',evidenceDigest:D('x')})},
  }});
  const context={work:{work_id:x.stageWorkDef.workId,owner_domain:'arca',process_type:'arca_shelf_entry',process_id:'entry'},
    event:{event_id:'stage-event',work_id:x.stageWorkDef.workId,capability_ref:CAPS.stage},effect:{effect_class:'material_commit'}};

  for(const err of [
    Object.assign(new Error('EINVAL'),{code:'EINVAL'}),
    Object.assign(new Error('IO failed'),{code:'PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED',details:{causeCode:'EINVAL'}}),
  ]){
    nextObserveError=err;
    const reality=await stagePort.observeEffectReality(context);
    assert.equal(reality.status,'unobservable',err.code);
    assert.equal(reality.rollbackDeclared,false);
    assert.match(reality.evidenceDigest,/^[a-f0-9]{64}$/);
    const rec=await reconciler.reconcile('material_commit',context);
    assert.equal(rec.decision,'observe_again');
  }

  nextObserveError=Object.assign(new Error('Unknown stage file'),{code:'ARCA_US_ADULT_STAGE_CONFLICT'});
  const conflict=await stagePort.observeEffectReality(context);
  assert.equal(conflict.status,'conflict');
  assert.equal(conflict.rollbackDeclared,false);
  const terminal=await reconciler.reconcile('material_commit',context);
  assert.equal(terminal.decision,'terminal_failure');
});

test('pre-stage no-write failure closes Actor Case as unresolved without forging discard and rejects forged closure',async t=>{
  const x=setupPipeline(t,{filesOverride:()=>({async stage(){
    throw Object.assign(new Error('Source changed before staging'),{code:'ARCA_US_ADULT_FILE_CHANGED',details:{effectWriteStarted:false,boundary:'before_stage'}});
  }})});
  const second=seedSecondEntry(x.f);
  assert.equal(x.f.care.admitCase(second.aftercareCaseId).state,'queued');

  insertWork(x.f.db,x.stageWorkDef,'running');
  const snapshot=x.actorPipelineQuery.inspect('entry',x.care.aftercareCaseId);
  const execution={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},workId:x.stageWorkDef.workId,
    eventId:'stage-event',eventAttemptId:'stage-attempt',capabilityRef:CAPS.stage,idempotencyKey:x.stageWorkDef.idempotencyKey,
    assertExecutionActive(){},namedInputs:{usAdultActorExecutionInput:executionInput(snapshot,'stage'),usAdultActorFilePlan:x.plan}};
  const outcome=await x.ports[CAPS.stage].execute(execution);
  assert.equal(outcome.kind,'failed');
  assert.equal(outcome.failureClass,'placement_precondition');
  assert.equal(outcome.retryDirective,'never');
  assert.equal(outcome.evidence.diagnostics.schema,'arca.actor-stage-precondition@1');
  assert.equal(outcome.evidence.diagnostics.boundary,'before_stage');
  assert.equal(outcome.evidence.diagnostics.effectWriteStarted,false);
  x.f.failures.set(D(outcome.evidence),outcome.evidence);

  x.f.db.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_id=?").run(x.stageWorkDef.workId);
  x.f.db.prepare('INSERT INTO fx_workflow_events(event_id,work_id,owner_domain,capability_ref,state,result_id) VALUES(?,?,?,?,?,?)')
    .run('stage-event',x.stageWorkDef.workId,'arca',CAPS.stage,'failed',null);
  x.f.db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,failure_class,failure_code,evidence_digest) VALUES(?,?,?,?,?,?,?,?)')
    .run('stage-attempt','stage-event',1,'completed','failed','placement_precondition','ARCA_US_ADULT_FILE_CHANGED',D(outcome.evidence));
  x.f.db.prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,state) VALUES(?,?,?,?)')
    .run('stage-effect','stage-attempt','material_commit','failed');

  const binding={work:x.stageWorkDef,failure:{eventId:'stage-event',code:'ARCA_US_ADULT_FILE_CHANGED',evidenceDigest:D(outcome.evidence),evidence:outcome.evidence}},
    badDigest=D({schema:'arca.actor-prestage-terminal@1',workId:x.stageWorkDef.workId,aftercareCaseId:x.care.aftercareCaseId,
      intentDigest:x.intent.intentDigest,failureEvidenceDigest:D(outcome.evidence)});
  x.f.db.prepare("UPDATE fx_effect_journal SET state='reconcile_required' WHERE effect_id='stage-effect'").run();
  assert.throws(()=>x.f.care.terminateCase(x.care.aftercareCaseId,'unresolved','ARCA_US_ADULT_FILE_CHANGED',badDigest,null,binding),
    {code:'ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN'});
  x.f.db.prepare("UPDATE fx_effect_journal SET state='failed' WHERE effect_id='stage-effect'").run();

  const forged=structuredClone(binding);forged.failure.evidence.diagnostics.effectWriteStarted=true;forged.failure.evidenceDigest=D(forged.failure.evidence);
  assert.throws(()=>x.f.care.terminateCase(x.care.aftercareCaseId,'unresolved','ARCA_US_ADULT_FILE_CHANGED',badDigest,null,forged),
    {code:'ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN'});

  const result=x.actorRefreshCoordinator.reconcile(x.f.context,x.f.care.getCase(x.care.aftercareCaseId));
  assert.equal(result.kind,'actor_refresh_failed');
  assert.equal(result.reasonCode,'ARCA_US_ADULT_FILE_CHANGED');
  const closed=x.f.care.getCase(x.care.aftercareCaseId);
  assert.equal(closed.state,'unresolved');
  assert.equal(closed.terminalReasonCode,'ARCA_US_ADULT_FILE_CHANGED');
  assert.equal(x.admin.read('entry').canRefresh,true);
  assert.equal(x.f.care.admitCase(second.aftercareCaseId).state,'active');
});

test('basis drift invalidates pre-stage Actor Case after draining while containing post-stage drift',t=>{
  const q=localFixture(t);
  const qWorkReader=createWorkResultReader(q.dependencies);
  const qQuery=createUsAdultActorPipelineQuery({...q.dependencies,actorRefreshSource:{store:q.store},
    aftercareContextReader:q.reader,workResultReader:qWorkReader});
  const qCoord=createUsAdultActorRefreshCoordinator({...q.dependencies,actorPipelineQuery:qQuery,aftercareContextReader:q.reader,
    workResultReader:qWorkReader});
  const queued=q.command.request('entry',q.request,'admin');
  q.context.knownBindings={digest:D('changed-bindings')};
  const qRes=qCoord.reconcile(q.context,q.care.getCase(queued.aftercareCaseId));
  assert.equal(qRes.kind,'case_invalidated');
  assert.equal(qRes.reasonCode,'care_basis_changed');
  assert.equal(q.care.getCase(queued.aftercareCaseId).state,'invalidated');

  const x=setupPipeline(t);
  const second=seedSecondEntry(x.f);
  assert.equal(x.f.care.admitCase(second.aftercareCaseId).state,'queued');
  const dummyAssetWork=phaseWork(x.intent,x.care,'assets',[{ownerDomain:'arca',objectType:'supporting_work',objectId:x.sourceWorkDef.workId,revision:1,digest:D('running')}]);
  insertWork(x.f.db,dummyAssetWork,'running');
  x.f.context.knownBindings={digest:D('drifted-bindings')};
  x.setCancelDraining(1);
  const draining=x.actorRefreshCoordinator.reconcile(x.f.context,x.f.care.getCase(x.care.aftercareCaseId));
  assert.equal(draining.kind,'case_fence_draining');
  assert.equal(x.f.care.getCase(x.care.aftercareCaseId).state,'active');
  assert.equal(x.cancelledWorks.length,1);

  x.f.db.prepare("UPDATE fx_supporting_works SET state='cancelled' WHERE work_id=?").run(dummyAssetWork.workId);
  x.setCancelDraining(0);
  const invalidated=x.actorRefreshCoordinator.reconcile(x.f.context,x.f.care.getCase(x.care.aftercareCaseId));
  assert.equal(invalidated.kind,'case_invalidated');
  assert.equal(invalidated.reasonCode,'care_basis_changed');
  assert.equal(x.f.care.getCase(x.care.aftercareCaseId).state,'invalidated');
  assert.notEqual(x.f.db.prepare('SELECT reclaim_after_ms FROM fx_workspace_registry WHERE workspace_id=?').get(x.care.aftercareCaseId).reclaim_after_ms,null);
  assert.equal(x.f.care.admitCase(second.aftercareCaseId).state,'active');

  const p=setupPipeline(t);
  insertWork(p.f.db,p.stageWorkDef,'failed');
  p.f.context.knownBindings={digest:D('post-stage-drift')};
  const contained=p.actorRefreshCoordinator.reconcile(p.f.context,p.f.care.getCase(p.care.aftercareCaseId));
  assert.equal(contained.kind,'actor_refresh_attention_required');
  assert.equal(contained.reasonCode,'ARCA_US_ADULT_REFRESH_EXECUTION_STALE');
  assert.equal(p.f.care.getCase(p.care.aftercareCaseId).state,'active');
  assert.equal(p.aftercareCoordinator.stopForShelfDeregistration('entry',p.care.aftercareCaseId).kind,'actor_refresh_attention_required');
});

test('caseDetail and caseProgress project us_adult_actor_* plans, active execution, and failures',t=>{
  const x=setupPipeline(t);
  insertWork(x.f.db,x.stageWorkDef,'running',10005);
  const attemptId=x.stageWorkDef.workId+':attempt:1',planId=x.stageWorkDef.workId+':plan',eventId=x.stageWorkDef.workId+':event';
  x.f.db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES(?,?,?,?,?,?)')
    .run(attemptId,x.stageWorkDef.workId,1,x.stageWorkDef.executionBasisDigest,'running',10005);
  x.f.db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(planId,attemptId,'helix://arca/planners/UsAdultActorStage/v1',1,D('catalog'),x.stageWorkDef.executionBasisDigest,D('graph'),'planned',10005);
  x.f.db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameter_schema_ref,parameters_json,when_schema_ref,when_json,effect_class,fence_schema_ref,fence_basis_json,resource_demand_schema_ref,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(planId,'stage',CAPS.stage,1,'helix://foundation/types/EventInputBindingSet/v1',
      canonicalJson({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]}),'p','{}','w','null','material_commit','f','{}','r','{}');
  x.f.db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,planId,'stage',x.stageWorkDef.workId,attemptId,'arca',CAPS.stage,1,'executing','normal_foreground');
  x.f.db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,started_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('ea-'+eventId,eventId,1,CAPS.stage,1,'in',D('in'),D('fence'),'executing',10005);

  const detail=x.aftercareCoordinator.caseDetail(x.care.aftercareCaseId);
  assert.equal(detail.contract,'aftercare_process_actual_plans@1');
  assert.deepEqual(detail.stages.map(s=>s.key),[x.sourceWorkDef.workId,x.assetsWorkDef.workId,x.stageWorkDef.workId]);
  assert.equal(detail.stages[2].label,'暂存文件');
  assert.equal(detail.stages[2].plans[0].nodes[0].label,'暂存更新文件');
  assert.equal(detail.stages[2].plans[0].nodes[0].statusText,'正在执行');

  const runningProgress=x.aftercareCoordinator.caseProgress('entry');
  assert.equal(runningProgress.stage,'preparing_media');
  assert.equal(runningProgress.currentAction.label,'暂存更新文件');
  assert.equal(runningProgress.currentAction.statusText,'正在执行');

  x.f.db.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_id=?").run(x.stageWorkDef.workId);
  x.f.db.prepare("UPDATE fx_workflow_events SET state='failed' WHERE event_id=?").run(eventId);
  x.f.db.prepare("UPDATE fx_event_attempts SET state='completed',outcome_kind='failed',failure_class='executor',failure_code='P4_EVENT_RECOVERY_REALITY_CONFLICT' WHERE event_id=?").run(eventId);

  const failedProgress=x.aftercareCoordinator.caseProgress('entry');
  assert.equal(failedProgress.stage,'waiting_for_recovery');
  const failedDetail=x.aftercareCoordinator.caseDetail(x.care.aftercareCaseId);
  assert.equal(failedDetail.stages[2].state,'attention');
  assert.equal(failedDetail.stages[2].plans[0].nodes[0].state,'failed');
  assert.ok(failedDetail.stages[2].plans[0].nodes[0].technicalDetail.fields.some(field=>field.value==='P4_EVENT_RECOVERY_REALITY_CONFLICT'));
});

test('before_publication failure still requires completed discard work before closing Actor Case unresolved',async t=>{
  const x=setupPipeline(t,{filesOverride:()=>({async publish(){
    throw Object.assign(new Error('Target conflict'),{code:'ARCA_US_ADULT_TARGET_CONFLICT',details:{effectWriteStarted:false,boundary:'before_publication'}});
  }})});
  const stageDir=path.join(x.f.root,'.shelfdeck-us-'+D(x.care.aftercareCaseId).slice(0,32)+'-stage');
  const stageBody={schema:'arca.us-adult-staged-files@1',aftercareCaseId:x.care.aftercareCaseId,planDigest:x.plan.planDigest,directory:stageDir,
    members:x.f.context.raw.materials.map((m,ordinal)=>({ordinal,role:m.role,previousMaterialKey:m.material_key,
      location:path.join(stageDir,String(ordinal).padStart(4,'0')+'.stage'),targetLocation:x.plan.members[ordinal].targetLocation,
      endpointId:'endpoint',physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
        materialKey:m.material_key,mountScopeId:'mount',inode:m.inode,sizeBytes:m.size_bytes,
        fingerprintAlgorithm:m.fingerprint_algorithm,fingerprintVersion:m.fingerprint_version,contentFingerprint:m.content_fingerprint},
      fullByteDigest:D(m.role)}))};
  const stageReceipt={...stageBody,manifestDigest:D(stageBody)};
  const fileResBody={aftercareCaseId:x.care.aftercareCaseId,shelfEntryId:'entry',intentId:x.intent.intentId,intentDigest:x.intent.intentDigest,
    selectionDigest:x.selection.selectionDigest,planDigest:x.plan.planDigest,action:'stage',receipt:stageReceipt,receiptDigest:D(stageReceipt)};
  const stageResult={schemaRef:'helix://contracts/types/ArcaUsAdultFileReceipt/v1',schemaVersion:1,evidenceId:'ev-stage-pub-test',
    evidenceKind:'us_adult_actor_stage',producerRef:CAPS.stage,basisDigest:x.intent.intentDigest,payloadDigest:D(fileResBody),
    observedAtMs:10003,...fileResBody};
  insertSucceededWork(x.f.db,x.stageWorkDef,CAPS.stage,'helix://contracts/capabilities/arca.us_adult.files.stage/v1/result',stageResult,10003);

  const publishWorkDef=phaseWork(x.intent,x.care,'publish',[
    {ownerDomain:'arca',objectType:'supporting_work',objectId:x.assetsWorkDef.workId,revision:1,digest:D(x.assetsResult)},
    {ownerDomain:'arca',objectType:'supporting_work',objectId:x.stageWorkDef.workId,revision:1,digest:D(stageResult)},
  ]);
  insertWork(x.f.db,publishWorkDef,'running',10004);
  const snapshot=x.actorPipelineQuery.inspect('entry',x.care.aftercareCaseId);
  const outcome=await x.ports[CAPS.publish].execute({ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},
    workId:publishWorkDef.workId,eventId:'pub-event',eventAttemptId:'pub-attempt',capabilityRef:CAPS.publish,
    idempotencyKey:publishWorkDef.idempotencyKey,assertExecutionActive(){},
    namedInputs:{usAdultActorExecutionInput:executionInput(snapshot,'publish'),usAdultActorFilePlan:x.plan}});
  assert.equal(outcome.kind,'failed');
  assert.equal(outcome.evidence.diagnostics.schema,'arca.actor-publication-precondition@1');
  x.f.failures.set(D(outcome.evidence),outcome.evidence);

  x.f.db.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_id=?").run(publishWorkDef.workId);
  x.f.db.prepare('INSERT INTO fx_workflow_events(event_id,work_id,owner_domain,capability_ref,state,result_id) VALUES(?,?,?,?,?,?)')
    .run('pub-event',publishWorkDef.workId,'arca',CAPS.publish,'failed',null);
  x.f.db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,failure_class,failure_code,evidence_digest) VALUES(?,?,?,?,?,?,?,?)')
    .run('pub-attempt','pub-event',1,'completed','failed','placement_precondition','ARCA_US_ADULT_TARGET_CONFLICT',D(outcome.evidence));
  x.f.db.prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,state) VALUES(?,?,?,?)')
    .run('pub-effect','pub-attempt','material_commit','failed');

  const noDiscardBinding={work:publishWorkDef,failure:{eventId:'pub-event',code:'ARCA_US_ADULT_TARGET_CONFLICT',evidenceDigest:D(outcome.evidence),evidence:outcome.evidence}},
    prestageLikeDigest=D({schema:'arca.actor-prestage-terminal@1',workId:publishWorkDef.workId,aftercareCaseId:x.care.aftercareCaseId,
      intentDigest:x.intent.intentDigest,failureEvidenceDigest:D(outcome.evidence)});
  assert.throws(()=>x.f.care.terminateCase(x.care.aftercareCaseId,'unresolved','ARCA_US_ADULT_TARGET_CONFLICT',prestageLikeDigest,null,noDiscardBinding),
    {code:'ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN'});

  const pendingDiscard=x.actorRefreshCoordinator.reconcile(x.f.context,x.f.care.getCase(x.care.aftercareCaseId));
  assert.equal(pendingDiscard.kind,'actor_refresh_pending');
  assert.equal(pendingDiscard.phase,'discard');
  assert.equal(x.f.care.getCase(x.care.aftercareCaseId).state,'active');

  const discardWorkDef=phaseWork(x.intent,x.care,'discard',[
    {ownerDomain:'arca',objectType:'supporting_work',objectId:x.assetsWorkDef.workId,revision:1,digest:D(x.assetsResult)},
    {ownerDomain:'arca',objectType:'supporting_work',objectId:x.stageWorkDef.workId,revision:1,digest:D(stageResult)},
    {ownerDomain:'arca',objectType:'failed_actor_publication',objectId:publishWorkDef.workId,revision:1,digest:D(outcome.evidence)},
  ]);
  const discardReceipt={schema:'arca.us-adult-discarded-stage@1',aftercareCaseId:x.care.aftercareCaseId,
    planDigest:x.plan.planDigest,stagedManifestDigest:stageReceipt.manifestDigest,deletedCount:3};
  const discardBody={aftercareCaseId:x.care.aftercareCaseId,shelfEntryId:'entry',intentId:x.intent.intentId,intentDigest:x.intent.intentDigest,
    selectionDigest:x.selection.selectionDigest,planDigest:x.plan.planDigest,action:'discard',receipt:discardReceipt,receiptDigest:D(discardReceipt)};
  const discardResult={schemaRef:'helix://contracts/types/ArcaUsAdultFileReceipt/v1',schemaVersion:1,evidenceId:'ev-discard-pub-test',
    evidenceKind:'us_adult_actor_discard',producerRef:CAPS.retire,basisDigest:x.intent.intentDigest,payloadDigest:D(discardBody),
    observedAtMs:10006,...discardBody};
  x.f.db.prepare("UPDATE fx_supporting_works SET state='succeeded' WHERE work_id=?").run(discardWorkDef.workId);
  x.f.db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run(discardWorkDef.workId+':attempt:1',discardWorkDef.workId,1,discardWorkDef.executionBasisDigest,'succeeded',10006,10006);
  x.f.db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(discardWorkDef.workId+':plan',discardWorkDef.workId+':attempt:1','fixture://planner',1,D('catalog'),discardWorkDef.executionBasisDigest,D('graph'),'planned',10006);
  x.f.db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameter_schema_ref,parameters_json,when_schema_ref,when_json,effect_class,fence_schema_ref,fence_basis_json,resource_demand_schema_ref,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(discardWorkDef.workId+':plan','node',CAPS.retire,1,'helix://foundation/types/EventInputBindingSet/v1',
      canonicalJson({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]}),'p','{}','w','null','material_commit','f','{}','r','{}');
  x.f.db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('discard-event',discardWorkDef.workId+':plan','node',discardWorkDef.workId,discardWorkDef.workId+':attempt:1','arca',CAPS.retire,1,'succeeded','normal_foreground','discard-result');
  x.f.db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('discard-attempt','discard-event',1,CAPS.retire,1,'in',D('in'),D('fence'),'completed','succeeded',10006,10006);
  x.f.db.prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,state) VALUES(?,?,?,?)')
    .run('discard-effect','discard-attempt','material_commit','committed');
  x.f.db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('discard-result','discard-event','succeeded','helix://contracts/capabilities/arca.us_adult.files.retire/v1/result',
      canonicalJson(discardResult),D(discardResult),'ev-schema',canonicalJson({ok:true}),D({ok:true}),10006);

  const closed=x.actorRefreshCoordinator.reconcile(x.f.context,x.f.care.getCase(x.care.aftercareCaseId));
  assert.equal(closed.kind,'actor_refresh_failed');
  assert.equal(closed.reasonCode,'ARCA_US_ADULT_TARGET_CONFLICT');
  assert.equal(x.f.care.getCase(x.care.aftercareCaseId).state,'unresolved');
});
