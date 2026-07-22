'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createDomainCommitRegistry}=require('../../src/helix/foundation/persistence/domain-commit-registry');
const {buildArtifactManifestVerification,buildMediaCastDraft,buildMetadataFetchIntent,buildMetadataObservationBasis,
  buildProductFactHandle,buildProductMetadataDraft}=
  require('../../src/helix/domains/libra/model/product-fact-contracts');
const {createProductFactRegistrations}=require('../../src/helix/domains/libra/persistence/product-fact-store');

const schemaManifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),'utf8'));
const d=(value)=>canonicalDigest({value});

function fixture(factKind='media_cast'){const intent=buildMetadataFetchIntent({libraRunId:'run-1',runExecutionBasisDigest:d('run-basis'),sourceKind:'provider',
  sourcePriority:0,contentProfile:'movie',resolvedIdentityDigest:d('identity'),requestedFields:['title'],providerKind:'tmdb',integrationId:'tmdb',configRevision:1});
  const result={schemaRef:'helix://contracts/types/MetadataObservation/v1',schemaVersion:1,evidenceId:'evidence-1',evidenceKind:'metadata_observation',
    producerRef:'libra.product_metadata.fetch@1',basisDigest:d('basis'),payloadDigest:d('payload'),observedAtMs:1,fetchIntentDigest:intent.intentDigest,
    sourceKind:'provider',sourceRef:'tmdb:tmdb@1',sourcePriority:0,identityDigest:intent.resolvedIdentityDigest,contentProfile:'movie',
    descriptiveFacts:{schemaRef:'helix://contracts/records/descriptive-facts/v1',schemaVersion:1,recordKind:'descriptive-facts',recordDigest:d('facts'),entries:[{key:'title',value:'A'}]},
    providerIdentitySet:{schemaRef:'helix://contracts/records/provider-identity-set/v1',schemaVersion:1,recordKind:'provider-identity-set',recordDigest:d('providers'),entries:[]},peopleHints:[],artifactHints:[]};
  const selected={ownerDomain:'libra',processType:'libra_run',processId:'run-1',workKind:'product_metadata_observation',workState:'succeeded',
    capabilityRef:'libra.product_metadata.fetch@1',resultSchemaRef:result.schemaRef,result,resultId:'result-source',resultDigest:canonicalDigest(result),
    evidenceDigest:result.payloadDigest,inputBindingDigest:canonicalDigest(intent),workId:'work-source',attemptId:'attempt-source',planId:'plan-source',eventId:'event-source'};
  const basis=buildMetadataObservationBasis({intents:[intent],results:[selected],factKind,expectedRevision:0});
  const draft=buildMediaCastDraft({subjectId:'subject-1',sourceBasis:basis,relations:[],producedAtMs:1});
  const payload={schema:'libra.media-cast-fact-commit-payload@1',sourceBasis:basis,mediaCastDraft:draft};
  const handle=buildProductFactHandle({libraRunId:'run-1',factKind:'media_cast',expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:d('fence')});
  return {basis,draft,handle,intent,payload,result};}

function metadataFixture(){const source=fixture('product_metadata'),requirement={requirementId:'',revision:1,
  schemaRef:'helix://contracts/requirements/poster/v1',artifactKind:'poster',requirementPayload:{minimumWidth:1000},requirementDigest:''};
  requirement.requirementDigest=canonicalDigest({schema:'shared.artifact-requirement@1',revision:1,schemaRef:requirement.schemaRef,
    artifactKind:'poster',requirementPayload:requirement.requirementPayload});
  requirement.requirementId=canonicalDigest({schema:'shared.artifact-requirement-id@1',requirementDigest:requirement.requirementDigest});
  const draft=buildProductMetadataDraft({sourceBasis:source.basis,requiredFields:['title'],producedAtMs:2,providerIdentities:[],
    artifactRequirements:[requirement]}).draft;
  const handle={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:'artifact-1',artifactKind:'poster',
    ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run-1'},storageRef:'artifact://poster',digestAlgorithm:'sha256',
    digestHex:d('artifact'),sizeBytes:100,mediaType:'image/jpeg',provenanceRef:{objectType:'libra_run',objectId:'run-1',revision:1,digest:d('provenance')},referenceRevision:1};
  const verification=buildArtifactManifestVerification({requirement,artifactHandles:[handle],verifiedAtMs:3});
  const inputBindings={artifactHandleList:[handle],artifactRequirement:requirement},resultDigest=canonicalDigest(verification),
    inputBindingDigest=canonicalDigest(inputBindings);
  const verificationResultRef={workId:'work-verify',attemptId:'attempt-verify',planId:'plan-verify',eventId:'event-verify',resultId:'result-verify',
    capabilityRef:'shared.artifact.manifest.verify@1',resultSchemaRef:verification.schemaRef,resultDigest,inputBindingDigest};
  const item={ordinal:0,artifactHandleId:handle.artifactHandleId,artifactKind:handle.artifactKind,artifactRevision:handle.referenceRevision,
    artifactDigest:handle.digestHex,requirementId:requirement.requirementId,requirementRevision:requirement.revision,
    requirementSchemaRef:requirement.schemaRef,requirementDigest:requirement.requirementDigest,verificationEvidenceId:verification.verificationId,
    verificationEvidenceDigest:verification.verificationDigest,verificationResultRef};item.referenceDigest=canonicalDigest(item);
  const artifactSetDigest=canonicalDigest({schema:'libra.verified-artifact-set@1',items:[item]}),manifest={manifestId:canonicalDigest({
    schema:'libra.verified-artifact-manifest-id@1',libraRunId:'run-1',artifactSetDigest}),libraRunId:'run-1',items:[item],artifactSetDigest};
  manifest.manifestDigest=canonicalDigest(manifest);
  const payload={schema:'libra.product-metadata-fact-commit-payload@1',sourceBasis:source.basis,productMetadataDraft:draft,verifiedArtifactManifest:manifest};
  const commitHandle=buildProductFactHandle({libraRunId:'run-1',factKind:'product_metadata',expectedRevision:0,
    payloadDigest:canonicalDigest(payload),eventFenceDigest:d('metadata-fence')});
  return {...source,draft,requirement,artifactHandle:handle,verification,inputBindings,manifest,payload,handle:commitHandle};}

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

test('persists Product Metadata only after the explicit Requirement, Artifact, Plan input, and Result chain agrees',()=>{
  const value=metadataFixture(),registry=createDomainCommitRegistry({registrations:createProductFactRegistrations({schemaManifest})}),
    participant=registry.resolve(value.handle,value.payload,{commitMarker:'marker-metadata'}),inserted={facts:[],sources:[]};
  const sourceRows={work:{work_id:'work-source',owner_domain:'libra',process_type:'libra_run',process_id:'run-1',state:'succeeded'},
    attempt:{attempt_id:'attempt-source',work_id:'work-source',state:'succeeded'},plan:{plan_id:'plan-source',attempt_id:'attempt-source',state:'completed'},
    event:{event_id:'event-source',plan_id:'plan-source',node_id:'node-source',work_id:'work-source',attempt_id:'attempt-source',owner_domain:'libra',capability_ref:'libra.product_metadata.fetch@1',state:'succeeded',result_id:'result-source'}};
  const verifyRows={work:{work_id:'work-verify',owner_domain:'libra',process_type:'libra_run',process_id:'run-1',state:'succeeded'},
    attempt:{attempt_id:'attempt-verify',work_id:'work-verify',state:'succeeded'},plan:{plan_id:'plan-verify',attempt_id:'attempt-verify',state:'completed'},
    event:{event_id:'event-verify',plan_id:'plan-verify',node_id:'node-verify',work_id:'work-verify',attempt_id:'attempt-verify',owner_domain:'libra',capability_ref:'shared.artifact.manifest.verify@1',state:'succeeded',result_id:'result-verify'}};
  const foundation={invoke(statement,parameters){const verify=Object.values(parameters).includes('result-verify')||Object.values(parameters).includes('work-verify')||
    Object.values(parameters).includes('attempt-verify')||Object.values(parameters).includes('plan-verify')||Object.values(parameters).includes('event-verify');
    const rows=verify?verifyRows:sourceRows;if(statement==='find_work')return rows.work;if(statement==='find_attempt')return rows.attempt;
    if(statement==='find_plan')return rows.plan;if(statement==='find_event')return rows.event;
    if(statement==='find_node')return verify?{plan_id:'plan-verify',node_id:'node-verify',capability_ref:'shared.artifact.manifest.verify@1',input_bindings_json:JSON.stringify(value.inputBindings)}:
      {plan_id:'plan-source',node_id:'node-source',capability_ref:'libra.product_metadata.fetch@1',input_bindings_json:JSON.stringify(value.intent)};
    if(statement==='find_result')return verify?{result_id:'result-verify',event_id:'event-verify',result_schema_ref:value.verification.schemaRef,
      result_json:JSON.stringify(value.verification),result_digest:canonicalDigest(value.verification),evidence_digest:value.verification.verificationDigest}:
      {result_id:'result-source',event_id:'event-source',result_schema_ref:value.result.schemaRef,result_json:JSON.stringify(value.result),
        result_digest:canonicalDigest(value.result),evidence_digest:value.result.payloadDigest};
    if(statement==='find_artifact')return {artifact_handle_id:'artifact-1',artifact_kind:'poster',digest_algorithm:'sha256',
      digest_hex:value.artifactHandle.digestHex,reference_revision:1,state:'active'};throw new Error(statement);}};
  const owner={invoke(statement,parameters){if(statement==='find_run')return {libra_run_id:'run-1',subject_id:'subject-1',state:'active',state_revision:1,state_digest:d('state')};
    if(statement==='find_fact')return undefined;if(statement==='insert_fact'){inserted.facts.push(parameters);return {changes:1};}
    if(statement==='insert_source'){inserted.sources.push(parameters);return {changes:1};}throw new Error(statement);}};
  participant.readParticipants[0].execute({repository:()=>foundation});const fact=participant.execute({repository:()=>owner,commitTimeMs:20});
  participant.postMarkerParticipants[0].execute({repository:()=>owner,commitTimeMs:20});
  assert.equal(fact.schemaRef,'helix://contracts/types/ProductMetadataFact/v1');assert.equal(inserted.facts[0].artifact_verification_result_count,1);
  assert.equal(inserted.facts[0].verified_artifact_manifest_digest,value.manifest.manifestDigest);
});
