'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createDomainCommitRegistry}=require('../../src/helix/foundation/persistence/domain-commit-registry');
const {buildMediaCastDraft,buildMetadataFetchIntent,buildMetadataObservationBasis,buildProductFactHandle}=
  require('../../src/helix/domains/libra/model/product-fact-contracts');
const {createProductFactRegistrations}=require('../../src/helix/domains/libra/persistence/product-fact-store');

const schemaManifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),'utf8'));
const d=(value)=>canonicalDigest({value});

function fixture(){const intent=buildMetadataFetchIntent({libraRunId:'run-1',runExecutionBasisDigest:d('run-basis'),sourceKind:'provider',
  sourcePriority:0,contentProfile:'movie',resolvedIdentityDigest:d('identity'),requestedFields:['title'],providerKind:'tmdb',integrationId:'tmdb',configRevision:1});
  const result={schemaRef:'helix://contracts/types/MetadataObservation/v1',schemaVersion:1,evidenceId:'evidence-1',evidenceKind:'metadata_observation',
    producerRef:'libra.product_metadata.fetch@1',basisDigest:d('basis'),payloadDigest:d('payload'),observedAtMs:1,fetchIntentDigest:intent.intentDigest,
    sourceKind:'provider',sourceRef:'tmdb:tmdb@1',sourcePriority:0,identityDigest:intent.resolvedIdentityDigest,contentProfile:'movie',
    descriptiveFacts:{schemaRef:'helix://contracts/records/descriptive-facts/v1',schemaVersion:1,recordKind:'descriptive-facts',recordDigest:d('facts'),entries:[{key:'title',value:'A'}]},
    providerIdentitySet:{schemaRef:'helix://contracts/records/provider-identity-set/v1',schemaVersion:1,recordKind:'provider-identity-set',recordDigest:d('providers'),entries:[]},peopleHints:[],artifactHints:[]};
  const selected={ownerDomain:'libra',processType:'libra_run',processId:'run-1',workKind:'product_metadata_observation',workState:'succeeded',
    capabilityRef:'libra.product_metadata.fetch@1',resultSchemaRef:result.schemaRef,result,resultId:'result-source',resultDigest:canonicalDigest(result),
    evidenceDigest:result.payloadDigest,inputBindingDigest:canonicalDigest(intent),workId:'work-source',attemptId:'attempt-source',planId:'plan-source',eventId:'event-source'};
  const basis=buildMetadataObservationBasis({intents:[intent],results:[selected],factKind:'media_cast',expectedRevision:0});
  const draft=buildMediaCastDraft({subjectId:'subject-1',sourceBasis:basis,relations:[],producedAtMs:1});
  const payload={schema:'libra.media-cast-fact-commit-payload@1',sourceBasis:basis,mediaCastDraft:draft};
  const handle=buildProductFactHandle({libraRunId:'run-1',factKind:'media_cast',expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:d('fence')});
  return {basis,draft,handle,intent,payload,result};}

test('registers exact Product Fact variants and writes reconstructable Libra Owner rows after preparation',()=>{
  const registrations=createProductFactRegistrations({schemaManifest});
  assert.deepEqual(registrations.map((item)=>item.factType),['media_cast','product_metadata']);
  const registry=createDomainCommitRegistry({registrations}),value=fixture(),participant=registry.resolve(value.handle,value.payload,{commitMarker:'marker-1'});
  const inserted={facts:[],sources:[]};
  const foundation={invoke(statement,parameters){const rows={find_work:{work_id:'work-source',owner_domain:'libra',process_type:'libra_run',process_id:'run-1',state:'succeeded'},
    find_attempt:{attempt_id:'attempt-source',work_id:'work-source',state:'succeeded'},find_plan:{plan_id:'plan-source',attempt_id:'attempt-source',state:'completed'},
    find_event:{event_id:'event-source',plan_id:'plan-source',node_id:'node-source',work_id:'work-source',attempt_id:'attempt-source',owner_domain:'libra',capability_ref:'libra.product_metadata.fetch@1',state:'succeeded',result_id:'result-source'},
    find_node:{plan_id:'plan-source',node_id:'node-source',capability_ref:'libra.product_metadata.fetch@1',input_bindings_json:JSON.stringify(value.intent)},
    find_result:{result_id:'result-source',event_id:'event-source',result_schema_ref:value.result.schemaRef,result_json:JSON.stringify(value.result),result_digest:canonicalDigest(value.result),evidence_digest:value.result.payloadDigest}};
    assert.ok(parameters);return rows[statement];}};
  const owner={invoke(statement,parameters){if(statement==='find_run')return {libra_run_id:'run-1',subject_id:'subject-1',state:'active',state_revision:1,state_digest:d('state')};
    if(statement==='find_fact')return undefined;if(statement==='insert_fact'){inserted.facts.push(parameters);return {changes:1};}
    if(statement==='insert_source'){inserted.sources.push(parameters);return {changes:1};}throw new Error(statement);}};
  participant.readParticipants[0].execute({repository:()=>foundation});
  const fact=participant.execute({repository:()=>owner,commitTimeMs:10});
  assert.equal(fact.schemaRef,'helix://contracts/types/MediaCastFact/v1');
  participant.postMarkerParticipants[0].execute({repository:()=>owner,commitTimeMs:10});
  assert.equal(inserted.facts.length,1);assert.equal(inserted.sources.length,1);
  assert.equal(inserted.facts[0].commit_marker,'marker-1');
  assert.equal(inserted.facts[0].result_digest,canonicalDigest(fact));
  assert.equal(inserted.sources[0].reference_digest,value.basis.selection.items[0].sourceReferenceDigest);
});
