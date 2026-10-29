'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const sharp = require('sharp');
const {createUsAdultAnalysisEngine} = require('../../src/helix/integrations/us-adult-analysis-engine');
const {createUsAdultReferenceMatcher} = require('../../src/helix/integrations/us-adult-reference-matcher');
const {createCleanWesternAnalysisPort} = require('../../src/clean-western-analysis-port');
const {faceModelReference} = require('../../src/helix/contracts/us-adult-face-model');
const {canonicalDigest, canonicalJson} = require('../../src/helix/contracts/canonical-json');
const {clusterParameters} = require('../../src/helix/domains/libra/model/us-adult-analysis-basis');
const {createCapabilityContractValidator} = require('../../src/helix/foundation/capability/contract-validator');
const model = faceModelReference('western_frame_set'), referenceModel = faceModelReference('single_reference_face');
const V = (a, b = 0) => [a, b, ...Array(126).fill(0)];
const D = canonicalDigest;
function reference(personId, feature = V(1)) {
  const bytes = Buffer.from(canonicalJson({schema:'shared.face-embedding-set@1', dimension:128, vectors:[feature]}));
  const face = {referenceFaceId:'face-' + personId, referenceAssetId:'photo-' + personId,
    embeddingHandleId:'embedding-' + personId, embeddingDigest:require('node:crypto').createHash('sha256').update(bytes).digest('hex'), modelRef:referenceModel.digest};
  const asset = {referenceAssetId:face.referenceAssetId, artifactHandleId:'image-' + personId, artifactDigest:D('photo-' + personId)};
  const contribution = {ownerPersonId:personId, ownerReferenceRevision:3, inheritedReadOnly:false,
    activeFaces:[face], activeAssets:[asset], referenceSetDigest:D({face, asset})};
  const body = {projectionContract:'people.person-reference-projection@1', personId, personRevision:2,
    currentReferenceRevision:3, contributions:[contribution]};
  return {projection:{...body, projectionRevision:4, projectionDigest:D(body)}, bytes, asset, face};
}
function harness(references = [reference('actor-z'), reference('actor-a')], extra = {}) {
  const byId = new Map(references.map(item => [item.face.embeddingHandleId, item])); let reads = 0, active = true;
  const options = {frameExtractor:{extract:async() => []}, faceModel:{analyzeImage:async() => {throw new Error('not used');}},
    context:{assertExecutionActive() { if (!active) throw Object.assign(new Error('execution ended'), {code:'FIXTURE_CANCELLED'}); }},
    referencePort:{readReferenceEmbedding(input) {
      reads++; const item = byId.get(input.artifactHandleId); assert.ok(item); assert.equal(input.personId, item.projection.personId);
      assert.equal(input.artifactDigest, item.face.embeddingDigest); return item.bytes;
    }, readReferenceImage() { throw new Error('not used'); }}, ...extra};
  return {engine:createUsAdultAnalysisEngine(options), options, references, reads:() => reads, cancel:() => {active = false;}};
}

test('the shared matcher accepts Owner-local face groups without Libra handles and preserves global highest-match and reference guards', async () => {
  const h = harness(), matcher = createUsAdultReferenceMatcher(h.options),
    request = {faceModelRefDigest:model.digest,faces:[{faceGroupId:'arca-frame-19-face-0',vector:V(1)}],
      personReferenceProjections:h.references.map(item=>item.projection)};
  const result = await matcher.matchPage(request);
  assert.equal(result.matches.length,1);assert.equal(result.matches[0].personId,'actor-a');
  assert.equal(result.matches[0].faceGroupId,'arca-frame-19-face-0');assert.equal(result.matches[0].score,1);
  assert.equal(Object.hasOwn(result.matches[0],'libraRunId'),false);
  const changed = structuredClone(request);changed.personReferenceProjections[0].personRevision++;
  await assert.rejects(matcher.matchPage(changed),{code:'US_ADULT_REFERENCE_CHANGED'});
  await assert.rejects(matcher.matchPage({...request,faceModelRefDigest:D('unfrozen model')}),{code:'US_ADULT_ANALYSIS_CHANGED'});
  h.cancel();await assert.rejects(matcher.matchPage(request),{code:'FIXTURE_CANCELLED'});
});

test('rejects a borderline 0.367 face at the raised matching threshold', async () => {
  const borderline = 0.367, h = harness([reference('actor-borderline', V(borderline, Math.sqrt(1 - borderline * borderline)))]),
    matcher = createUsAdultReferenceMatcher(h.options), request = {faceModelRefDigest:model.digest,
      faces:[{faceGroupId:'borderline-face',vector:V(1)}], personReferenceProjections:h.references.map(item=>item.projection)};
  const raised = await matcher.matchPage({...request, threshold:0.42});
  assert.deepEqual(raised.matches, []);
  const legacy = await matcher.matchPage({...request, threshold:0.363});
  assert.equal(legacy.matches.length, 1); assert.equal(legacy.matches[0].personId, 'actor-borderline');
  assert.ok(Math.abs(legacy.matches[0].score - borderline) < 1e-12);
});

test('clustering preserves member vectors and matching selects the highest face score with stable actor tie ordering', async() => {
  const h = harness(), clustered = await h.engine.computeClusters({embeddingSet:{dimension:128, vectors:[V(1), V(0.8, 0.6), V(0, 1)]},
    clusterParameters:clusterParameters(model)});
  assert.equal(clustered.clusters.reduce((n, item) => n + item.vectors.length, 0), 3);
  const request = {faceClusterSetHandle:{faceModelRefDigest:model.digest}, clusters:clustered.clusters,
    personReferenceProjections:h.references.map(item => item.projection)};
  const result = await h.engine.matchReferences(request);
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].personId, 'actor-a'); assert.equal(result.matches[0].score, 1);
  assert.equal(result.matches[0].threshold, 0.42); assert.equal(result.matches[0].referenceAssetId, 'photo-actor-a');
  assert.equal(h.reads(), 2); await h.engine.matchReferences(request); assert.equal(h.reads(), 4, 'Cached vectors still require current Artifact ownership and byte verification.');
  assert.deepEqual(await h.engine.matchReferences({...request, personReferenceProjections:[]}), {matches:[]});
  assert.deepEqual(await h.engine.matchReferences({...request, clusters:[]}), {matches:[]});
  h.cancel(); await assert.rejects(h.engine.matchReferences(request), {code:'FIXTURE_CANCELLED'});
});

test('rejects reference model, projection digest, malformed feature and sampling duration drift', async() => {
  const item = reference('actor-a'), h = harness([item]), request = {faceClusterSetHandle:{faceModelRefDigest:model.digest},
    clusters:[{clusterId:'cluster-1', memberOrdinals:[0], vectors:[V(1)]}], personReferenceProjections:[item.projection]};
  const changed = structuredClone(item.projection); changed.personRevision++;
  await assert.rejects(h.engine.matchReferences({...request, personReferenceProjections:[changed]}), {code:'US_ADULT_REFERENCE_CHANGED'});
  item.projection.contributions[0].activeFaces[0].modelRef = D('other-model');
  const {projectionDigest, projectionRevision, ...body} = item.projection; item.projection.projectionDigest = D(body);
  await assert.rejects(h.engine.matchReferences(request), {code:'US_ADULT_REFERENCE_MODEL_CHANGED'});
  await assert.rejects(h.engine.computeClusters({embeddingSet:{dimension:128, vectors:[V(0)]}, clusterParameters:clusterParameters(model)}), {code:'FACE_VECTOR_INVALID'});
  await assert.rejects(h.engine.extractFrameSet({samplingPlan:{maxFrames:20, typedParameters:[]}}), {code:'US_ADULT_SAMPLING_INVALID'});
});

test('controlled analysis port publishes scored nominal match evidence and rejects a substituted reference photo', async() => {
  const h = harness(), cluster = {clusterId:'face-cluster-000000', memberOrdinals:[0], vectors:[V(1)]},
    clusters = {faceModelRefDigest:model.digest, handleDigest:D('cluster-handle'), artifactHandle:{artifactKind:'face_cluster_set',
      ownerDomain:'libra', ownerScope:{scopeType:'libra_run'}}};
  const port = createCleanWesternAnalysisPort({configuration:{faceModelRef:model, clusterParameters:clusterParameters(model)}, engine:h.engine,
    workspaceProductPort:{materializeArtifact() {}, openFrameCompositeSink() {}, recoverMaterializedArtifact() {},
      readArtifactBytes() { return {bytes:Buffer.from(canonicalJson({schema:'shared.face-cluster-set@1', clusters:[cluster]}))}; }}});
  const result = await port.matchReferences({faceClusterSetHandle:clusters, personReferenceProjectionList:h.references.map(item => item.projection)});
  createCapabilityContractValidator({schemas:[require('../../src/helix/contracts/types/PersonMatchEvidence/v1/schema.json')]}).validate(result.schemaRef, result);
  assert.equal(result.matches[0].personId, 'actor-a'); assert.deepEqual(result.unmatchedClusterIds, []);
  const wrong = createCleanWesternAnalysisPort({configuration:port.configuration(), engine:{...h.engine, matchReferences:async() => ({matches:[{
    ...result.matches[0], artifactDigest:D('wrong-photo'),
  }]})}, workspaceProductPort:{materializeArtifact() {}, openFrameCompositeSink() {}, recoverMaterializedArtifact() {},
    readArtifactBytes() { return {bytes:Buffer.from(canonicalJson({schema:'shared.face-cluster-set@1', clusters:[cluster]}))}; }}});
  await assert.rejects(wrong.matchReferences({faceClusterSetHandle:clusters, personReferenceProjectionList:h.references.map(item => item.projection)}),
    {code:'CLEAN_WESTERN_MATCH_RESULT_INVALID'});
});

test('real pinned CPU frames and selected reference feed the shared large-screenshot poster renderer', {
  timeout:60000, skip:!process.env.SHELFDECK_FACE_MODEL_ROOT || !process.env.SHELFDECK_FACE_TEST_IMAGE ? 'Explicit pinned models and benign reference image required.' : false,
}, async t => {
  const {createLocalFaceModel} = require('../../src/helix/integrations/local-face-model'), faceModel = createLocalFaceModel({modelRoot:process.env.SHELFDECK_FACE_MODEL_ROOT});
  t.after(() => faceModel.close());
  const bytes = fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE), face = await faceModel.analyzeImage(bytes, {requireSingleFace:true}),
    item = reference('actor-a', face.faces[0].vector), originalName = require('../../src/helix/contracts/us-adult-presentation').originalNameProvenance('Original source.mp4'),
    selected = {personId:'actor-a', personRevision:2, libraryKind:'us_adult', canonicalName:'Actor A', referenceAssetId:item.asset.referenceAssetId,
      artifactHandleId:item.asset.artifactHandleId, artifactDigest:item.asset.artifactDigest, internalIdentity:'us-adult:fixture', originalName};
  const h = harness([item], {faceModel, actorPresentation:selected}), composite = {members:[{timestampMs:50}], memberPayloads:[{bytesBase64:bytes.toString('base64')}]};
  const personValue={schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
    personId:'actor-a',personRevision:2,canonicalName:'Actor A',aliases:[],personFactDigest:D('person-fact'),referenceProjection:item.projection},
    personSnapshot={...personValue,snapshotDigest:D(personValue)},
    choice=require('../../src/helix/domains/libra/model/us-adult-actor-choice').buildRecord({
      snapshot:{run:{libraRunId:'test-run',subjectId:'test-subject',executionBasisDigest:D('run-basis')}},personSnapshot,
      body:{personId:'actor-a',expectedPersonRevision:2,expectedReferenceRevision:3,expectedChoiceRevision:0,expectedRunStateRevision:1,idempotencyKey:'explicit-render-actor'},actorId:'admin'}),
    selectionValue={schemaRef:'helix://contracts/domain-types/UsAdultActorSelectionBasis/v1',schemaVersion:1,libraRunId:'test-run',subjectId:'test-subject',
      runExecutionBasisDigest:D('run-basis'),resolvedIdentityDigest:D('identity'),analysisId:D('analysis'),analysisBasisDigest:D('analysis-basis'),
      selectionOrigin:'user_choice',actorChoiceRecord:choice,matchCompletion:null,referenceAssetId:item.asset.referenceAssetId,
      selectionId:D({schema:'libra.us-adult-actor-selection-id@1',libraRunId:'test-run',analysisBasisDigest:D('analysis-basis'),
        originDigest:choice.recordDigest,referenceAssetId:item.asset.referenceAssetId})},
    actorSelectionBasis={...selectionValue,selectionDigest:D(selectionValue)};
  require('../../src/helix/domains/libra/model/us-adult-actor-selection').assertActorSelection(actorSelectionBasis);
  selected.actorSelectionDigest=actorSelectionBasis.selectionDigest;
  h.options.referencePort.readReferenceImage = () => ({bytes});
  const embedded = await h.engine.computeEmbeddings({frameComposite:composite, faceModelRef:model}),
    clustered = await h.engine.computeClusters({embeddingSet:embedded, clusterParameters:clusterParameters(model)}),
    matched = await h.engine.matchReferences({faceClusterSetHandle:{faceModelRefDigest:model.digest}, clusters:clustered.clusters, personReferenceProjections:[item.projection]});
  assert.equal(embedded.vectorCount, 1); assert.ok(matched.matches[0].score > 0.99);
  const sharedMatched=await createUsAdultReferenceMatcher(h.options).matchPage({faceModelRefDigest:model.digest,
    faces:[{faceGroupId:'arca-frame-000000-face-000',vector:embedded.vectors[0]}],personReferenceProjections:[item.projection]});
  assert.equal(sharedMatched.matches[0].score,matched.matches[0].score);assert.equal(sharedMatched.matches[0].personId,'actor-a');
  const poster = await h.engine.renderPoster({frameComposite:composite, actorSelectionBasis});
  const metadata = await sharp(poster).metadata(); assert.equal(metadata.width, 1000); assert.equal(metadata.height, 1500);
  const analysis = await h.engine.analyzeWestern({analysisSpec:{typedParameters:[
    {parameter:'actor_name', value:selected.canonicalName}, {parameter:'original_file_name', value:originalName.originalFileName},
    {parameter:'internal_identity', value:selected.internalIdentity},
    {parameter:'actor_selection_digest',value:actorSelectionBasis.selectionDigest},
  ]}});
  assert.equal(analysis.identityAnchor, selected.internalIdentity); assert.equal(analysis.descriptiveFacts.find(item => item.key === 'title').value, 'Actor A Original source');
});
