'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createWorkResultReader } = require('../../src/helix/foundation/execution/work-result-reader');
const { createCleanWorkspaceProductPort } = require('../../src/clean-workspace-product-port');
const { createDomainCommitCoordinator, createDomainCommitRegistry, createCanonicalTransactionRegistry } =
  require('../../src/helix/foundation/persistence/domain-commit-registry');
const { createProductFactRegistrations } = require('../../src/helix/domains/libra/persistence/product-fact-store');
const factTransaction = require('../../src/helix/contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const { createCleanProductProductionPort } = require('../../src/clean-product-production-port');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { buildEpisodeMetadataScope } = require('../../src/helix/contracts/episode-metadata-scope');
const { buildMetadataFetchIntent, buildMetadataObservation, buildMetadataObservationBasis,
  buildProductMetadataDraft, buildProductMetadataFact, buildArtifactManifestVerification, buildProductFactHandle } = require('../../src/helix/domains/libra/model/product-fact-contracts');
const { createProductMetadataCapabilityPorts } = require('../../src/helix/domains/libra/capabilities/product-metadata-capability-ports');
const { metadataObservationWork, nextMetadataStage } = require('../../src/helix/domains/libra/planning/product-metadata-work');
const { productMetadataContext, createArtifactProductionPlanner, createArtifactProductionProjections, artifactVerificationContext } =
  require('../../src/helix/domains/libra/planning/libra-production-planners');
const { createArtifactProductionCapabilityPorts } = require('../../src/helix/domains/libra/capabilities/artifact-production-capability-ports');
const { buildProductConformanceFactSnapshot, episodeMetadataFieldPresent } = require('../../src/helix/domains/libra/model/product-conformance');

const D = value => canonicalDigest({ value });
const identityBody = { provider:'tmdb', namespace:'tmdb_series', providerKey:'1399', seasonNumber:1 };
const identity = { ...identityBody, identityAnchorDigest:canonicalDigest(identityBody) };
const scope = number => buildEpisodeMetadataScope({ episodeKey:'E'+String(number).padStart(3,'0'), episodeNumber:number, seasonNumber:1 });
function intent(number, sourcePriority = number) {
  return buildMetadataFetchIntent({ libraRunId:'series-run', runExecutionBasisDigest:D('basis'),
    sourceKind:'provider', sourcePriority, contentProfile:'series', resolvedIdentityDigest:D('identity'),
    requestedFields:['episode_number', 'episode_plot', 'episode_title', 'season_number', 'series_title'],
    providerKind:'tmdb', resolvedProviderIdentity:identity, integrationId:'tmdb-main', configRevision:2,
    episodeScope:scope(number) });
}
function chain(input, entries) {
  const result = buildMetadataObservation({ intent:input, descriptiveEntries:entries,
    providerIdentities:[identity], observedAtMs:10 });
  return { ownerDomain:'libra', processType:'libra_run', processId:input.libraRunId,
    workKind:'product_metadata_observation', workState:'succeeded', capabilityRef:'libra.product_metadata.fetch@1',
    resultSchemaRef:'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result', result,
    resultId:'result-'+input.sourcePriority, resultDigest:canonicalDigest(result), evidence:result,
    evidenceDigest:canonicalDigest(result), inputBindings:input, inputBindingDigest:canonicalDigest(input),
    workId:'work-'+input.sourcePriority, attemptId:'attempt-'+input.sourcePriority,
    planId:'plan-'+input.sourcePriority, eventId:'event-'+input.sourcePriority };
}
function episodeEntries(number, overrides = {}) {
  return Object.entries({ series_title:'Show', season_number:1, episode_number:number,
    episode_title:'Title '+number, episode_plot:'Plot '+number, ...overrides }).map(([key,value])=>({key,value}));
}

test('Series Observation capacity is bounded at 1024 sources while Movie retains 16', () => {
  const inputs=Array.from({length:1024},(_,index)=>intent(index+1,index));
  const results=inputs.map((input,index)=>chain(input,episodeEntries(index+1)));
  const basis=buildMetadataObservationBasis({intents:inputs,results,factKind:'product_metadata',expectedRevision:0});
  assert.equal(basis.observationSet.observations.length,1024);
  assert.equal(basis.selection.items.length,1024);
  assert.throws(()=>buildMetadataObservationBasis({intents:[...inputs,intent(1025,1024)],results,
    factKind:'product_metadata',expectedRevision:0}),{code:'P9_METADATA_SOURCE_CAPACITY'});
  const movieIdentity={provider:'tmdb',namespace:'tmdb_movie',providerKey:'42',seasonNumber:null};
  movieIdentity.identityAnchorDigest=canonicalDigest(movieIdentity);
  const movie=Array.from({length:17},(_,sourcePriority)=>buildMetadataFetchIntent({
    libraRunId:'movie-run',runExecutionBasisDigest:D('basis'),sourceKind:'provider',sourcePriority,
    contentProfile:'movie',resolvedIdentityDigest:D('identity'),requestedFields:['title'],
    providerKind:'tmdb',resolvedProviderIdentity:movieIdentity,integrationId:'tmdb-main',configRevision:2}));
  assert.throws(()=>buildMetadataObservationBasis({intents:movie,results:[],
    factKind:'product_metadata',expectedRevision:0}),{code:'P9_METADATA_SOURCE_CAPACITY'});
});

test('Series Observation Set preserves its 8 MiB byte bound', () => {
  const inputs=Array.from({length:768},(_,index)=>intent(index+1,index));
  const results=inputs.map((input,index)=>chain(input,episodeEntries(index+1,{episode_plot:'p'.repeat(12*1024)})));
  assert.throws(()=>buildMetadataObservationBasis({intents:inputs,results,
    factKind:'product_metadata',expectedRevision:0}),{code:'P9_METADATA_SET_SIZE'});
});

test('Episode scope changes Intent, Work identity and Evidence without changing Season identity', () => {
  const first=intent(1,0), second=intent(2,0);
  assert.notEqual(first.intentDigest, second.intentDigest);
  const snapshot={run:{libraRunId:'series-run',executionBasisDigest:D('basis')}};
  assert.notEqual(metadataObservationWork(snapshot,{intent:first}).workId,
    metadataObservationWork(snapshot,{intent:second}).workId);
  assert.deepEqual(first.resolvedProviderIdentity,second.resolvedProviderIdentity);
  assert.notEqual(chain(first,episodeEntries(1)).result.evidenceId,chain(second,episodeEntries(2)).result.evidenceId);
  assert.throws(()=>buildMetadataFetchIntent({...first,episodeScope:scope(2)}),{code:'P9_METADATA_INTENT_IDENTITY'});
});

test('Draft projection preserves E01/E02 independently and cannot flatten Episode metadata into Season', () => {
  const inputs=[intent(1,0),intent(2,1)], results=inputs.map((input,index)=>chain(input,episodeEntries(index+1)));
  const basis=buildMetadataObservationBasis({intents:inputs,results,factKind:'product_metadata',expectedRevision:0});
  for(const number of [1,2]) {
    const projected=buildProductMetadataDraft({sourceBasis:basis,requiredFields:inputs[0].requestedFields,
      episodeScope:scope(number),producedAtMs:10,providerIdentities:[identity]});
    assert.equal(projected.ready,true);
    assert.equal(projected.draft.descriptiveFacts.entries.find(item=>item.key==='episode_title').value,'Title '+number);
    assert.deepEqual(projected.draft.episodeScope,scope(number));
    assert.equal(projected.draft.fieldProvenance.every(item=>item.evidenceDigest===results[number-1].result.payloadDigest),true);
    assert.throws(()=>buildProductMetadataFact({productMetadataDraft:projected.draft}),{code:'P9_METADATA_EPISODE_FACT_SCOPE'});
  }
  const flat=buildProductMetadataDraft({sourceBasis:basis,requiredFields:['episode_title'],producedAtMs:10});
  assert.equal(flat.ready,false);
  assert.deepEqual(flat.missingFields,['episode_title']);
});

test('A foreign Episode in a rehashed durable Result is still rejected against its frozen Intent', () => {
  const input=intent(1,0), exact=chain(input,episodeEntries(1));
  const result={...exact.result,episodeScope:scope(2)};
  assert.throws(()=>buildMetadataObservationBasis({intents:[input],results:[{...exact,result,
    resultDigest:canonicalDigest(result),evidence:result,evidenceDigest:canonicalDigest(result)}],
    factKind:'product_metadata',expectedRevision:0}),{code:'P9_METADATA_OBSERVATION_CHAIN'});
});

test('Scoped Draft refuses contradictory observed Episode number', () => {
  const input=intent(1,0), result=chain(input,episodeEntries(2));
  const basis=buildMetadataObservationBasis({intents:[input],results:[result],factKind:'product_metadata',expectedRevision:0});
  assert.throws(()=>buildProductMetadataDraft({sourceBasis:basis,requiredFields:input.requestedFields,
    episodeScope:scope(1),producedAtMs:10}),{code:'P9_METADATA_EPISODE_SCOPE'});
});

test('Capability refuses an Episode outside the Run Spec or frozen manifest before provider I/O', async () => {
  let calls=0;
  const input=intent(3,0);
  const snapshot={run:{executionBasisDigest:D('basis')},spec:{contentProfile:'series',productScope:{episodeKeys:['E001','E002']}},
    episodeClaims:[{episodeKey:'E001'},{episodeKey:'E002'}]};
  const port=createProductMetadataCapabilityPorts({productProductionPort:{readRelatedNfo(){},fetchProvider(){calls++;}},
    movieProductionReader:{readRunSnapshot:()=>snapshot}})['libra.product_metadata.fetch@1'];
  const request={ownerScope:{processId:'series-run'},namedInputs:{metadataFetchIntent:input,physicalMaterialReadHandleOrIntegrationHandle:{}}};
  await assert.rejects(port.execute(request),/outside the frozen Run/);
  assert.equal(calls,0);
  snapshot.spec.productScope.episodeKeys.push('E003');
  await assert.rejects(port.execute(request),/outside the frozen Run/);
  assert.equal(calls,0);
});

test('Capability returns a scoped Observation only after the exact frozen Run membership matches', async () => {
  const input=intent(1,0);
  const port=createProductMetadataCapabilityPorts({productProductionPort:{readRelatedNfo(){},
    fetchProvider:async()=>({descriptiveEntries:episodeEntries(1),providerIdentities:[identity],peopleHints:[]})},
    movieProductionReader:{readRunSnapshot:()=>({run:{executionBasisDigest:D('basis')},
      spec:{contentProfile:'series',productScope:{episodeKeys:['E001']}},episodeClaims:[{episodeKey:'E001'}]})},now:()=>10})['libra.product_metadata.fetch@1'];
  const outcome=await port.execute({ownerScope:{processId:'series-run'},namedInputs:{metadataFetchIntent:input,physicalMaterialReadHandleOrIntegrationHandle:{}}});
  assert.equal(outcome.kind,'succeeded');
  assert.deepEqual(outcome.result.episodeScope,scope(1));
});

test('Reconcile selects E01 then E02 from frozen delivery and cannot let E01 close E02 gaps', () => {
  const records=[];
  const snapshot={run:{libraRunId:'series-run',executionBasisDigest:D('basis')},
    spec:{contentProfile:'series',productScope:{episodeKeys:['E001','E002']},
      requirements:{metadata:{requiredFieldCodes:['series_title','season_number','episode_number','episode_title','episode_plot']}}},
    episodeClaims:[{episodeKey:'E001'},{episodeKey:'E002'}],members:[],relatedReferences:[]};
  const options={workResultReader:{listWorks:()=>records.map((_,index)=>({work_id:String(index)})),
    read:id=>[{outcomeKind:'succeeded',capabilityRef:'libra.product_metadata.fetch@1',result:records[Number(id)]}]},
    productProductionPort:{resolveCurrentIntegrationHandle:()=>({integrationId:'tmdb-main',configRevision:2})}};
  const resolved={factValue:{identityDigest:D('identity'),providerIdentities:[identity]}};
  const first=nextMetadataStage(options,snapshot,resolved);
  assert.equal(first.kind,'source');
  assert.equal(first.source.intent.episodeScope,undefined);
  assert.deepEqual(first.source.intent.requestedFields,['season_number','series_title']);
  records.push(buildMetadataObservation({intent:first.source.intent,descriptiveEntries:[
    {key:'series_title',value:'Show'},{key:'season_number',value:1}],providerIdentities:[identity],observedAtMs:10,
    seriesPresentationSource:require('../../src/helix/contracts/series-presentation-basis').buildSeriesPresentationSource({
      provider:'tmdb',namespace:'tmdb_series',providerKey:identity.providerKey,seasonIdentityAnchorDigest:identity.identityAnchorDigest,
      integrationId:first.source.intent.integrationId,configRevision:first.source.intent.configRevision,language:'zh-CN',
      sourceRef:'tmdb:tv:'+identity.providerKey,title:'Show',originalTitle:'Show',firstAirDate:'2024-01-01',plot:'Series plot',genres:[]})}));
  const second=nextMetadataStage(options,snapshot,resolved);
  assert.deepEqual(second.source.intent.episodeScope,scope(1));
  records.push(buildMetadataObservation({intent:second.source.intent,descriptiveEntries:episodeEntries(1),providerIdentities:[identity],observedAtMs:10}));
  const third=nextMetadataStage(options,snapshot,resolved);
  assert.deepEqual(third.source.intent.episodeScope,scope(2));
  assert.equal(third.source.intent.sourcePriority,2);
  records.push(buildMetadataObservation({intent:third.source.intent,descriptiveEntries:episodeEntries(2,{episode_plot:''}),providerIdentities:[identity],observedAtMs:10}));
  const unresolved=nextMetadataStage(options,snapshot,resolved);
  assert.equal(unresolved.kind,'unresolved');
  assert.deepEqual(unresolved.missingFields,['episode_plot']);
  records[2]=buildMetadataObservation({intent:third.source.intent,descriptiveEntries:episodeEntries(2),providerIdentities:[identity],observedAtMs:10});
  assert.equal(nextMetadataStage(options,snapshot,resolved).kind,'ready');
  snapshot.spec.productScope.episodeKeys.push('E003');
  assert.throws(()=>nextMetadataStage(options,snapshot,resolved),/differs from the frozen Run/);
});

function productionFixture() {
  const global=buildMetadataFetchIntent({libraRunId:'series-run',runExecutionBasisDigest:D('basis'),sourceKind:'provider',
    sourcePriority:0,contentProfile:'series',resolvedIdentityDigest:D('identity'),requestedFields:['season_number','series_title'],
    providerKind:'tmdb',resolvedProviderIdentity:identity,integrationId:'tmdb-main',configRevision:2});
  const inputs=[global,intent(1,1),intent(2,2)];
  const integrationHandle={integrationId:'tmdb-main',configRevision:2};
  const records=inputs.map((input,index)=>{
    const original=chain(input,index?episodeEntries(index):[{key:'season_number',value:1},{key:'series_title',value:'Show'}]);
    const inputBindings={bindings:[{portName:'metadataFetchIntent',parameters:{intent:input}}]};
    return {...original,state:'succeeded',outcomeKind:'succeeded',inputBindings,
      inputBindingDigest:canonicalDigest(inputBindings),inputSnapshotDigest:canonicalDigest({metadataFetchIntent:input,
        physicalMaterialReadHandleOrIntegrationHandle:integrationHandle})};
  });
  const snapshot={run:{libraRunId:'series-run',subjectId:'series-subject',executionBasisDigest:D('basis')},
    spec:{contentProfile:'series',productScope:{episodeKeys:['E001','E002']},requirements:{metadata:{
      requiredFieldCodes:['series_title','season_number','episode_number','episode_title','episode_plot'],requiredArtifactKinds:['nfo']}}},
    episodeClaims:[{episodeKey:'E001'},{episodeKey:'E002'}],relatedReferences:[]};
  const options={movieProductionReader:{readRunSnapshot:()=>snapshot,
    readFact:()=>({factValue:{identityDigest:D('identity'),providerIdentities:[identity]}})},
    workResultReader:{listWorks:()=>records.map(item=>({work_id:item.workId,state:'succeeded'})),
      read:id=>records.filter(item=>item.workId===id)},productProductionPort:{resolveIntegrationHandle:()=>integrationHandle},
    registry:{snapshot:[],resolve:ref=>({manifest:{effectClass:ref==='libra.product_sidecar.render@1'?'workspace_write':'pure_observation',
      parametersSchemaRef:'helix://contracts/capabilities/'+ref.replace('@1','/v1/parameters'),
      resultSchemaRef:'helix://contracts/capabilities/'+ref.replace('@1','/v1/result')}})},
    policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'fixture-retry',timeoutPolicyRef:'fixture-timeout'})}};
  return {options,snapshot,records};
}

test('Artifact input projection builds only the selected Episode with identical frozen values', () => {
  const {options}=productionFixture();
  const all=productMetadataContext(options,'series-run');
  const season=productMetadataContext(options,'series-run',null);
  assert.deepEqual(season.draft,all.draft);
  assert.deepEqual(season.episodeDrafts,[]);
  for(const expected of all.episodeDrafts){
    const selected=productMetadataContext(options,'series-run',expected.episodeScope.episodeKey);
    assert.deepEqual(selected.draft,all.draft);
    assert.deepEqual(selected.episodeDrafts,[expected]);
    assert.deepEqual(selected.basis,all.basis);
  }
  assert.throws(()=>productMetadataContext(options,'series-run','E003'),/outside the frozen Run/);
});

test('Artifact bindings share preparation reads but a fresh preparation revalidates every source', () => {
  const {options,records}=productionFixture();
  const plan=createArtifactProductionPlanner(options).plan({processId:'series-run',ownerDomain:'libra',
    processType:'libra_run',executionBasisDigest:D('basis'),workId:'artifact-work',workAttemptId:'artifact-attempt'});
  const event=plan.nodes.find(node=>node.capabilityRef==='libra.product_sidecar.render@1'&&
    node.inputBindings.bindings.some(binding=>binding.parameters?.episodeKey==='E001'));
  const projections=new Map(createArtifactProductionProjections(options).map(item=>[item.projectionRef,item.projection]));
  const read=options.movieProductionReader.readRunSnapshot;let reads=0;
  options.movieProductionReader.readRunSnapshot=(...args)=>{reads++;return read(...args);};
  const prepare=ownerScope=>Object.fromEntries(event.inputBindings.bindings.map(binding=>[binding.portName,
    projections.get(binding.projectionRef).project({ownerScope,parameters:binding.parameters})]));
  const first=prepare(Object.freeze({processId:'series-run'}));
  assert.equal(reads,1,'all bindings share one verified context per preparation');
  const second=prepare(Object.freeze({processId:'series-run'}));
  assert.equal(reads,2,'later preparation must not reuse earlier reads');
  assert.deepEqual(second,first);
  records[2].inputSnapshotDigest=D('changed-unselected-episode');
  assert.throws(()=>prepare(Object.freeze({processId:'series-run'})),/execution input snapshot changed/);
});

test('Formal Artifact Planner projects separate Season/Episode Drafts and distinct immutable events', () => {
  const {options}=productionFixture();
  const metadata=productMetadataContext(options,'series-run');
  assert.equal(metadata.draft.descriptiveFacts.entries.some(item=>item.key.startsWith('episode_')),false);
  assert.deepEqual(metadata.episodeDrafts.map(item=>item.episodeScope.episodeKey),['E001','E002']);
  assert.deepEqual(metadata.draft.episodeMetadata.map(item=>item.episodeScope.episodeKey),['E001','E002']);
  const request={processId:'series-run',ownerDomain:'libra',processType:'libra_run',executionBasisDigest:D('basis'),
    workId:'artifact-work',workAttemptId:'artifact-attempt'};
  const plan=createArtifactProductionPlanner(options).plan(request);
  const producers=plan.nodes.filter(item=>item.capabilityRef==='libra.product_sidecar.render@1');
  assert.equal(producers.length,3);
  assert.equal(plan.nodes.length,6);
  assert.equal(new Set(plan.nodes.map(item=>item.eventId)).size,6);
  const projections=new Map(createArtifactProductionProjections(options).map(item=>[item.projectionRef,item.projection]));
  const requests=[];
  const artifacts=[];
  const actualRenderer=createCleanProductProductionPort({mediaProbe:{probe(){}},workspaceProductPort:{acquireArtifact(){},
    materializeArtifact:request=>{artifacts.push(request);return{artifactHandle:{schemaRef:'helix://contracts/types/ArtifactHandle/v1',
      schemaVersion:1,artifactHandleId:'artifact-'+artifacts.length,artifactKind:'nfo',ownerDomain:'libra',
      ownerScope:{scopeType:'libra_run',scopeId:'series-run'},storageRef:'workspace://'+request.relativePath,
      digestAlgorithm:'sha256',digestHex:crypto.createHash('sha256').update(request.bytes).digest('hex'),sizeBytes:request.bytes.length,
      mediaType:'application/xml',provenanceRef:request.provenanceRef,referenceRevision:1}};}}});
  const port=createArtifactProductionCapabilityPorts({...options,productProductionPort:{renderProductSidecar:request=>{
    requests.push(request);return actualRenderer.renderProductSidecar(request);}}})['libra.product_sidecar.render@1'];
  for(const producer of producers) {
    const namedInputs=Object.fromEntries(producer.inputBindings.bindings.map(binding=>[binding.portName,
      projections.get(binding.projectionRef).project({ownerScope:{processId:'series-run'},parameters:binding.parameters})]));
    assert.equal(port.execute({ownerScope:{processId:'series-run'},namedInputs,eventId:producer.eventId,
      eventAttemptId:'attempt-'+producer.nodeId,idempotencyKey:producer.nodeId}).kind,'succeeded');
  }
  assert.deepEqual(requests.map(request=>request.relativePath),['product/season.nfo','product/E001.nfo','product/E002.nfo']);
  assert.deepEqual(requests.slice(1).map(request=>request.sidecarProfile.typedParameters.find(item=>item.parameter==='episodeNumber').value),[1,2]);
  assert.deepEqual(requests.slice(1).map(request=>request.productMetadataDraft.descriptiveFacts.entries.find(item=>item.key==='episode_title').value),['Title 1','Title 2']);
  assert.match(artifacts[0].bytes.toString(),/<tvshow>/);
  for(const [index,artifact] of artifacts.slice(1).entries()){
    const xml=artifact.bytes.toString();
    assert.match(xml,/<episodedetails>/);
    assert.ok(xml.includes('<title>Title '+(index+1)+'</title>'));
    assert.ok(xml.includes('<plot>Plot '+(index+1)+'</plot>'));
    assert.ok(xml.includes('<episode>'+(index+1)+'</episode>'));
  }
  const draftProjection=projections.get(producers[0].inputBindings.bindings.find(binding=>binding.portName==='productMetadataDraft').projectionRef);
  assert.throws(()=>draftProjection.project({ownerScope:{processId:'series-run'},parameters:{episodeKey:'E003'}}),/outside the frozen Run/);
});

// These are exact durable boundary fixtures, not a scheduler or Host journey.
function seedNativeEvent(database, record, executing = false) {
  const state = executing ? 'running' : 'succeeded';
  database.prepare('INSERT OR IGNORE INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(record.workId,'libra','libra_run','series-run',record.workKind,D('basis'),'normal',state,record.workId,1,1);
  database.prepare('INSERT OR IGNORE INTO fx_work_attempts (attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run(record.attemptId,record.workId,0,D('basis'),state,1,executing?null:2);
  database.prepare('INSERT OR IGNORE INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(record.planId,record.attemptId,'libra.planner',1,D('catalog'),D('basis'),D(record.planId),'planned',1);
  database.prepare('INSERT INTO fx_plan_nodes (plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameters_json,when_json,fence_basis_json,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(record.planId,record.eventId,record.capabilityRef,1,'helix://test/native-series-input/v1',JSON.stringify(record.inputBindings),'{}','{}','{}','{}');
  database.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(record.eventId,record.planId,record.eventId,record.workId,record.attemptId,'libra',record.capabilityRef,1,executing?'executing':'succeeded','normal',1,executing?null:record.resultId);
  database.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('execution-'+record.eventId,record.eventId,1,record.capabilityRef,1,'helix://test/native-series-input/v1',record.inputSnapshotDigest||D('input'),D('fence'),executing?'executing':'completed',executing?null:'succeeded',1,executing?null:2);
  if (!executing) persistNativeResult(database,record);
}

function persistNativeResult(database, record) {
  database.prepare('INSERT INTO fx_event_result_bindings (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(record.resultId,record.eventId,'succeeded',record.resultSchemaRef,JSON.stringify(record.result),canonicalDigest(record.result),
      record.evidenceSchemaRef||record.resultSchemaRef,JSON.stringify(record.evidence),canonicalDigest(record.evidence),2);
  database.prepare('UPDATE fx_workflow_events SET state=?,result_id=? WHERE event_id=?').run('succeeded',record.resultId,record.eventId);
  database.prepare('UPDATE fx_event_attempts SET state=?,outcome_kind=?,finished_at_ms=? WHERE event_id=?').run('completed','succeeded',2,record.eventId);
  database.prepare('UPDATE fx_work_attempts SET state=?,finished_at_ms=? WHERE attempt_id=?').run('succeeded',2,record.attemptId);
  database.prepare('UPDATE fx_supporting_works SET state=? WHERE work_id=?').run('succeeded',record.workId);
}

function withNativeSeriesProduct(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-native-product-'));
  const databasePath=path.join(root,'shelfdeck.db'),workspaceRoot=path.join(root,'workspace');
  const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl});
  const unitOfWork=createSqliteUnitOfWork({kernel});
  const database=new Database(databasePath);
  database.pragma('foreign_keys = ON');
  try {
    const {options,records}=productionFixture();
    const workspaceId=canonicalDigest({schema:'libra.workspace-id@1',libraRunId:'series-run'});
    database.prepare('INSERT INTO libra_subjects (subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('series-subject','season','series','active',1,D('continuity'),D('episodes'),1,1);
    database.prepare('INSERT INTO libra_runs (libra_run_id,subject_id,admission_revision,state,state_revision,state_digest,priority_class,priority_intent_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('series-run','series-subject',1,'active',1,D('state'),'normal',D('priority'),1);
    database.prepare('INSERT INTO fx_workspace_registry (workspace_id,owner_domain,process_type,process_id,root_handle_ref,state,created_at_ms) VALUES(?,?,?,?,?,?,?)')
      .run(workspaceId,'libra','libra_run','series-run',D('root'),'active',1);
    for(const record of records)seedNativeEvent(database,{...record,workKind:'product_metadata_observation'});
    options.workResultReader=createWorkResultReader({schemaManifest,unitOfWork});
    const workspace=createCleanWorkspaceProductPort({schemaManifest,unitOfWork,rootPath:workspaceRoot});
    const renderer=createCleanProductProductionPort({mediaProbe:{probe(){}},workspaceProductPort:workspace});
    const ports=createArtifactProductionCapabilityPorts({...options,productProductionPort:renderer});
    const projections=new Map(createArtifactProductionProjections(options).map(item=>[item.projectionRef,item.projection]));
    const plan=createArtifactProductionPlanner(options).plan({processId:'series-run',ownerDomain:'libra',processType:'libra_run',
      executionBasisDigest:D('basis'),workId:'artifact-work',workAttemptId:'artifact-attempt'});
    for(const node of plan.nodes.filter(item=>item.capabilityRef==='libra.product_sidecar.render@1')) {
      const namedInputs=Object.fromEntries(node.inputBindings.bindings.map(binding=>[binding.portName,
        projections.get(binding.projectionRef).project({ownerScope:{processId:'series-run'},parameters:binding.parameters})]));
      const record={workId:'artifact-work',workKind:'artifact_production',attemptId:'artifact-attempt',planId:plan.planId,
        eventId:node.eventId,capabilityRef:node.capabilityRef,inputBindings:node.inputBindings,inputSnapshotDigest:canonicalDigest(namedInputs)};
      seedNativeEvent(database,record,true);
      const idempotencyKey='native-'+node.eventId,eventAttemptId='execution-'+node.eventId;
      database.prepare('INSERT INTO fx_effect_journal (effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,updated_at_ms) VALUES(?,?,?,?,?,?,?)')
        .run(canonicalDigest(['workspace_write',idempotencyKey]),eventAttemptId,'workspace_write',idempotencyKey,D(node.eventId),'intended',1);
      const context={ownerScope:{processId:'series-run'},namedInputs,eventId:node.eventId,eventAttemptId,idempotencyKey};
      const outcome=ports[node.capabilityRef].execute(context);
      assert.equal(outcome.kind,'succeeded');
      assert.deepEqual(ports[node.capabilityRef].execute(context).result,outcome.result,'Exact Workspace replay must keep the Artifact handle');
      persistNativeResult(database,{...record,resultId:'result-'+node.eventId,...outcome});
      const verifyNode=plan.nodes.find(item=>item.capabilityRef==='shared.artifact.manifest.verify@1'&&
        item.inputBindings.bindings.some(binding=>binding.portName==='artifactHandleList'&&binding.eventId===node.eventId));
      const requirement=productMetadataContext(options,'series-run').requirements[0];
      const verifyInputs={artifactHandleList:[outcome.result],artifactRequirement:requirement};
      const verified=ports[verifyNode.capabilityRef].execute({namedInputs:verifyInputs});
      seedNativeEvent(database,{...record,eventId:verifyNode.eventId,capabilityRef:verifyNode.capabilityRef,
        inputBindings:verifyNode.inputBindings,inputSnapshotDigest:canonicalDigest(verifyInputs),resultId:'result-'+verifyNode.eventId,...verified});
    }
    const metadata=productMetadataContext(options,'series-run');
    const artifacts=artifactVerificationContext(options,'series-run');
    const payload={sourceBasis:metadata.basis,productMetadataDraft:metadata.draft,
      verifiedArtifactManifest:artifacts.verifiedArtifactManifest,mediaCastFactRef:null};
    const handle=buildProductFactHandle({libraRunId:'series-run',factKind:'product_metadata',expectedRevision:0,
      payloadDigest:canonicalDigest(payload),eventFenceDigest:D('commit-fence')});
    seedNativeEvent(database,{workId:'metadata-commit-work',workKind:'product_metadata_commit',attemptId:'metadata-commit-attempt',
      planId:'metadata-commit-plan',eventId:'metadata-commit-event',capabilityRef:'libra.product_metadata.commit@1',inputBindings:{}},true);
    const request={transactionId:'helix.transaction.domain-fact-commit',handle,payload,supportingWorkId:'metadata-commit-work',outboxMessages:[],
      commitMarker:{commitMarker:'series-metadata-marker',commitDigest:D('commit')},
      resultBinding:{resultId:'series-metadata-result',eventId:'metadata-commit-event',
        evidenceSchemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',evidence:{schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',
          schemaVersion:1,evidenceId:'series-metadata-evidence',evidenceDigest:D('evidence')}}};
    const coordinator=work=>createDomainCommitCoordinator({schemaManifest,unitOfWork:work,
      registry:createDomainCommitRegistry({registrations:createProductFactRegistrations({schemaManifest})}),
      transactionRegistry:createCanonicalTransactionRegistry({contracts:[factTransaction]})});
    return run({database,kernel,unitOfWork,workspaceRoot,workspaceId,request,coordinator,options});
  } finally {
    database.close();kernel.close();
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
}

test('Native Series Workspace and Product Fact preserve three Artifact chains and both Episode scopes on replay',()=>
  withNativeSeriesProduct(({database,unitOfWork,workspaceRoot,workspaceId,request,coordinator})=>{
    const committed=coordinator(unitOfWork).execute(request);
    assert.equal(committed.replayed,false);
    assert.equal(coordinator(unitOfWork).execute(request).replayed,true);
    const row=database.prepare('SELECT * FROM libra_product_fact_revisions').get(),fact=require('../../src/helix/contracts/episode-metadata-records').readStoredMetadataValue(row);
    assert.equal(JSON.parse(row.fact_json).episodeMetadata,undefined);
    assert.equal(JSON.parse(row.fact_json).episodeMetadataRef.recordCount,2);
    assert.deepEqual(fact.episodeMetadata.map(item=>item.episodeScope.episodeKey),['E001','E002']);
    assert.deepEqual(fact.episodeMetadata.map(item=>item.descriptiveFacts.entries.find(entry=>entry.key==='episode_title').value),['Title 1','Title 2']);
    assert.equal(row.source_ref_count,3);assert.equal(row.artifact_verification_result_count,3);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_fact_source_refs').get().n,3);
    assert.equal(database.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
    assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n,3);
    assert.equal(database.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,1);
    assert.equal(canonicalDigest(JSON.parse(row.fact_json)),row.result_digest);
    assert.match(fs.readFileSync(path.join(workspaceRoot,workspaceId,'product','season.nfo'),'utf8'),/<tvshow>/);
    for(const number of [1,2])assert.match(fs.readFileSync(path.join(workspaceRoot,workspaceId,'product',scope(number).episodeKey+'.nfo'),'utf8'),
      new RegExp('<episode>'+number+'</episode>'));
    for(const source of database.prepare('SELECT * FROM libra_product_fact_source_refs ORDER BY ordinal').all()) {
      const result=database.prepare('SELECT * FROM fx_event_result_bindings WHERE result_id=?').get(source.result_id);
      assert.equal(source.result_digest,result.result_digest);
      assert.equal(source.evidence_digest,JSON.parse(result.result_json).payloadDigest);
    }
  }));

test('Native Series Fact owner-write crash rolls back Fact, source refs, Result and marker without losing rendered Artifacts',()=>
  withNativeSeriesProduct(({database,unitOfWork,request,coordinator})=>{
    const crashing={execute:participants=>unitOfWork.execute(participants.map(participant=>
      participant.participantId!=='libra_product_fact_owner_write'?participant:
        {...participant,execute(){throw new Error('native-series-owner-crash');}}))};
    assert.throws(()=>coordinator(crashing).execute(request),/native-series-owner-crash/);
    for(const table of ['libra_product_fact_revisions','libra_product_fact_source_refs','fx_commit_markers'])
      assert.equal(database.prepare('SELECT count(*) n FROM '+table).get().n,0);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE result_id='series-metadata-result'").get().n,0);
    assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n,3);
    assert.equal(coordinator(unitOfWork).execute(request).replayed,false);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_fact_revisions').get().n,1);
  }));

test('Native Series Fact rejects a durable Episode Result changed after its exact source basis was frozen',()=>
  withNativeSeriesProduct(({database,unitOfWork,request,coordinator})=>{
    const row=database.prepare("SELECT * FROM fx_event_result_bindings WHERE result_id='result-1'").get();
    const changed={...JSON.parse(row.result_json),episodeScope:scope(2)};
    database.prepare('UPDATE fx_event_result_bindings SET result_json=?,result_digest=? WHERE result_id=?')
      .run(JSON.stringify(changed),canonicalDigest(changed),row.result_id);
    assert.throws(()=>coordinator(unitOfWork).execute(request),{code:'P9_PRODUCT_FACT_SOURCE_DIGEST'});
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_fact_revisions').get().n,0);
    assert.equal(database.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,0);
  }));

test('Scoped Intent, Observation and Season Draft pass the actual closed runtime schema graph', () => {
  const contracts=path.resolve(__dirname,'../../src/helix/contracts');
  const schemas=['types','domain-types','application-types'].flatMap(group=>fs.readdirSync(path.join(contracts,group)).map(name=>{
    const root=path.join(contracts,group,name),version=fs.readdirSync(root).find(entry=>/^v[0-9]+$/.test(entry));
    return JSON.parse(fs.readFileSync(path.join(root,version,'schema.json'),'utf8'));
  }));
  const validator=createCapabilityContractValidator({schemas});
  const inputs=Array.from({length:1024},(_,index)=>intent(index+1,index));
  const largeBasis=buildMetadataObservationBasis({intents:inputs,
    results:inputs.map((input,index)=>chain(input,episodeEntries(index+1))),factKind:'product_metadata',expectedRevision:0});
  const basisRef='helix://contracts/domain-types/LibraProductMetadataSourceBasisMetadataObservationWesternAnalysis/v1';
  validator.validate(basisRef,largeBasis);
  assert.throws(()=>validator.validate(basisRef,{...largeBasis,
    observationSet:{...largeBasis.observationSet,contentProfile:'movie'}}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  assert.throws(()=>validator.validate(basisRef,{...largeBasis,
    observationSet:{...largeBasis.observationSet,observations:[
      ...largeBasis.observationSet.observations,largeBasis.observationSet.observations[0]]}}),
  {code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  const input=intent(1,0);
  validator.validate('helix://contracts/domain-types/MetadataFetchIntent/v1',input);
  validator.validate('helix://contracts/types/MetadataObservation/v1',chain(input,episodeEntries(1)).result);
  const {options}=productionFixture(),metadata=productMetadataContext(options,'series-run');
  validator.validate('helix://contracts/types/ProductMetadataDraft/v1',metadata.draft);
  for(const draft of metadata.episodeDrafts)validator.validate('helix://contracts/types/ProductMetadataDraft/v1',draft);
  const fact=buildProductMetadataFact({productMetadataDraft:metadata.draft,sourceBasis:metadata.basis,
    verifiedArtifactManifest:{libraRunId:'series-run',manifestDigest:D('verified-manifest')},
    libraRunId:'series-run',subjectId:'series-subject',expectedRevision:0,commitMarker:'schema-fact',committedAtMs:11});
  validator.validate('helix://contracts/types/ProductMetadataFact/v1',fact);
  assert.throws(()=>validator.validate('helix://contracts/domain-types/MetadataFetchIntent/v1',
    {...input,episodeScope:{...input.episodeScope,foreign:true}}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
});

test('Season Product Fact retains all scoped Episode Metadata and conformance cannot accept one flat winner', () => {
  const {options}=productionFixture();
  const metadata=productMetadataContext(options,'series-run');
  const manifest={libraRunId:'series-run',manifestDigest:D('verified-manifest')};
  const fact=buildProductMetadataFact({productMetadataDraft:metadata.draft,sourceBasis:metadata.basis,
    verifiedArtifactManifest:manifest,libraRunId:'series-run',subjectId:'series-subject',expectedRevision:0,
    commitMarker:'commit-series-metadata',committedAtMs:11});
  assert.deepEqual(fact.episodeMetadata.map(item=>item.episodeScope.episodeKey),['E001','E002']);
  const snapshot=buildProductConformanceFactSnapshot({productFactId:fact.factId,factKind:'product_metadata',factRevision:1,
    schemaRef:fact.schemaRef,factValue:fact,factDigest:fact.factDigest,evidenceDigest:D('evidence')});
  assert.equal(snapshot.factDigest,fact.factDigest);
  assert.equal(episodeMetadataFieldPresent(fact,['E001','E002'],'episode_title'),true);
  assert.equal(episodeMetadataFieldPresent({...fact,episodeMetadata:fact.episodeMetadata.slice(0,1)},['E001','E002'],'episode_title'),false);
  assert.equal(episodeMetadataFieldPresent({descriptiveFacts:{entries:[{key:'episode_title',value:'flat title'}]}},['E001','E002'],'episode_title'),false);
  assert.throws(()=>buildProductConformanceFactSnapshot({productFactId:fact.factId,factKind:'product_metadata',factRevision:1,
    schemaRef:fact.schemaRef,factValue:{...fact,episodeMetadata:fact.episodeMetadata.slice(0,1)},factDigest:fact.factDigest,evidenceDigest:D('evidence')}),
    {code:'P9_CONFORMANCE_FACT_VALUE'});
});

test('Artifact Manifest requires separate Season, E01 and E02 producer chains; duplicate E01 cannot replace E02', () => {
  const {options}=productionFixture();
  const metadata=productMetadataContext(options,'series-run'),requirement=metadata.requirements[0];
  const originalList=options.workResultReader.listWorks,originalRead=options.workResultReader.read;
  const records=[];
  for(const [index,episodeKey] of ['', 'E001', 'E002'].entries()){
    const artifact={artifactHandleId:'nfo-'+index,artifactKind:'nfo',referenceRevision:1,digestHex:D('nfo-'+index)};
    const eventId='producer-'+index;
    const producer={eventId,capabilityRef:'libra.product_sidecar.render@1',outcomeKind:'succeeded',result:artifact,
      inputBindings:{bindings:[{portName:'productMetadataDraft',parameters:episodeKey?{episodeKey}:{}}]}};
    const verification=buildArtifactManifestVerification({requirement,artifactHandles:[artifact],verifiedAtMs:10});
    const inputBindings={bindings:[{portName:'artifactHandleList',eventId}]};
    records.push(producer,{capabilityRef:'shared.artifact.manifest.verify@1',outcomeKind:'succeeded',result:verification,
      workId:'artifact-work',attemptId:'artifact-attempt',planId:'artifact-plan',eventId:'verify-'+index,resultId:'verify-result-'+index,
      resultDigest:canonicalDigest(verification),inputBindings,inputBindingDigest:canonicalDigest(inputBindings),
      inputSnapshotDigest:canonicalDigest({artifactHandleList:[artifact],artifactRequirement:requirement})});
  }
  options.workResultReader={listWorks:query=>query.workKind==='artifact_production'?[{work_id:'artifact-work',state:'succeeded'}]:originalList(query),
    read:id=>id==='artifact-work'?records:originalRead(id)};
  const verified=artifactVerificationContext(options,'series-run');
  assert.equal(verified.verifiedArtifactManifest.items.length,3);
  assert.equal(new Set(verified.verifiedArtifactManifest.items.map(item=>item.verificationResultRef.resultId)).size,3);
  records[4].inputBindings.bindings[0].parameters.episodeKey='E001';
  assert.throws(()=>artifactVerificationContext(options,'series-run'),/not terminal/);
});

test('Scoped Related NFO conserves physical association and treats another Episode document as a gap', async () => {
  const physical={mountScopeId:'fixture-mount',inode:'1',sizeBytes:10,fingerprintAlgorithm:'middle-256k-sha256',
    fingerprintVersion:1,contentFingerprint:D('nfo-bytes')};
  physical.materialKey=canonicalDigest({schema:'physical-material-identity@2',...physical});
  const reference={role:'nfo',referenceId:'nfo-1',referenceDigest:D('reference'),primaryMaterialKey:'primary-1',identity:physical};
  const input=buildMetadataFetchIntent({libraRunId:'series-run',runExecutionBasisDigest:D('basis'),
    sourceKind:'related_nfo',sourcePriority:0,contentProfile:'series',resolvedIdentityDigest:D('identity'),
    requestedFields:['episode_number','episode_plot','episode_title','season_number'],episodeScope:scope(1),
    relatedReferenceId:reference.referenceId,relatedReferenceDigest:reference.referenceDigest,expectedChecksum:physical.contentFingerprint});
  let number=1,reads=0;
  const member={materialKey:'primary-1',episodeClaims:[{episodeKey:'E001'}]};
  const snapshot={run:{executionBasisDigest:D('basis')},spec:{contentProfile:'series',productScope:{episodeKeys:['E001']}},
    episodeClaims:[{episodeKey:'E001'}],members:[member],relatedReferences:[reference]};
  const port=createProductMetadataCapabilityPorts({movieProductionReader:{readRunSnapshot:()=>snapshot},
    productProductionPort:{fetchProvider(){},readRelatedNfo(){reads++;return{documentRoot:'episodedetails',
      entries:episodeEntries(number,{season_number:'1',episode_number:String(number)}),peopleHints:[]};}},now:()=>10})['libra.product_metadata.fetch@1'];
  const request={ownerScope:{processId:'series-run'},namedInputs:{metadataFetchIntent:input,
    physicalMaterialReadHandleOrIntegrationHandle:{identity:physical}}};
  const matching=await port.execute(request);
  assert.equal(matching.result.descriptiveFacts.entries.find(item=>item.key==='episode_number').value,1);
  number=2;
  assert.deepEqual((await port.execute(request)).result.descriptiveFacts.entries,[]);
  member.episodeClaims=[{episodeKey:'E002'}];
  await assert.rejects(port.execute(request),/association is outside/);
  assert.equal(reads,2);
});

test('large Season keeps complete Episode plots in bounded immutable records',()=>{
  const {splitEpisodeMetadata,restoreEpisodeMetadata}=require('../../src/helix/contracts/episode-metadata-records');
  const inputs=Array.from({length:32},(_,index)=>intent(index+1,index));
  const plot='瀹屾暣鍓ф儏'.repeat(400);
  const results=inputs.map((input,index)=>chain(input,episodeEntries(index+1,{episode_plot:plot})));
  const basis=buildMetadataObservationBasis({intents:inputs,results,factKind:'product_metadata',expectedRevision:0});
  const projected=buildProductMetadataDraft({sourceBasis:basis,requiredFields:['episode_plot','episode_title'],episodeScopes:inputs.map(x=>x.episodeScope),producedAtMs:10,providerIdentities:[identity],artifactRequirements:[]});
  assert.equal(projected.ready,true);
  assert.ok(Buffer.byteLength(JSON.stringify(projected.draft))>65536);
  const stored=splitEpisodeMetadata(projected.draft);
  assert.ok(Buffer.byteLength(JSON.stringify(stored.value))<65536);
  assert.deepEqual(restoreEpisodeMetadata(stored.value,stored.recordsJson),projected.draft);
  assert.ok(projected.draft.episodeMetadata.every(record=>record.descriptiveFacts.entries.find(x=>x.key==='episode_plot').value===plot));
  const records=JSON.parse(stored.recordsJson);
  assert.throws(()=>restoreEpisodeMetadata(stored.value,JSON.stringify(records.slice(1))));
  assert.throws(()=>restoreEpisodeMetadata(stored.value,JSON.stringify([...records].reverse())));
  assert.throws(()=>restoreEpisodeMetadata(stored.value,null));
  records[0].descriptiveFacts.entries[0].value='tampered';
  assert.throws(()=>restoreEpisodeMetadata(stored.value,JSON.stringify(records)));
});


test('Series mixed-source-sized evidence exceeds the old byte limit without weakening priority order', () => {
  const inputs = Array.from({length:232}, (_, index) => intent(index+1,index));
  const results = inputs.map((input,index) => chain(input,episodeEntries(index+1,{episode_plot:'p'.repeat(2500)})));
  const basis = buildMetadataObservationBasis({intents:inputs,results,factKind:'product_metadata',expectedRevision:0});
  assert.ok(Buffer.byteLength(JSON.stringify(basis.observationSet)) > 512*1024);
  assert.equal(basis.selection.items.length,232);
  assert.throws(() => buildMetadataObservationBasis({intents:[inputs[1],inputs[0],...inputs.slice(2)],results,
    factKind:'product_metadata',expectedRevision:0}), {code:'P9_METADATA_INTENT_ORDER'});
});
