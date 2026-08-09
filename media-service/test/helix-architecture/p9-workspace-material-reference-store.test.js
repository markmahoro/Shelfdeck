'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {buildArtifactManifestVerification}=require('../../src/helix/domains/libra/model/product-fact-contracts');
const {buildReferenceDecision,referenceSetDigest,workspaceStateDigest}=require('../../src/helix/domains/libra/model/workspace-material-reference-contracts');
const {createWorkspaceMaterialReferenceStore}=require('../../src/helix/domains/libra/persistence/workspace-material-reference-store');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({fixture:value});

function createHandle(options={}) {
  const workspaceId=D('workspace'),contentFingerprint=options.contentFingerprint||D('content'),inode=options.inode||'42',
    relativePath=options.relativePath||'output/movie.mkv',sizeBytes=options.sizeBytes??100,
    materialKey=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:'mount-1',inode,sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint}),
    basis={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:'',workspaceId,ownerDomain:'libra',processId:'run-1',endpointId:'endpoint-1',materialKey,
      physicalIdentity:{mountScopeId:'mount-1',inode,sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint},rootHandleRef:'root-handle-1',relativePath,digestAlgorithm:'sha256',digestHex:contentFingerprint,sizeBytes,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:''};
  basis.handleId=canonicalDigest({schema:'foundation.workspace-material-handle-id@1',workspaceId,materialKey,relativePath:basis.relativePath,referenceRevision:1});
  basis.fenceDigest=canonicalDigest({schema:'foundation.workspace-material-handle-fence@1',handleId:basis.handleId,workspaceId,ownerDomain:'libra',processId:'run-1',endpointId:'endpoint-1',materialKey,physicalIdentity:basis.physicalIdentity,rootHandleRef:basis.rootHandleRef,relativePath:basis.relativePath,digestAlgorithm:'sha256',digestHex:basis.digestHex,sizeBytes,referenceRevision:1,accessScope:'workspace_material_read'});
  return basis;
}

function insertWorkspaceMaterial(db,handle) {
  db.prepare('INSERT INTO fx_workspace_materials (workspace_id,material_handle_id,material_key,endpoint_id,mount_scope_id,inode,fingerprint_algorithm,fingerprint_version,content_fingerprint,relative_path,digest_algorithm,digest_hex,size_bytes,reference_revision,owner_domain,process_id,root_handle_ref,access_scope,handle_schema_ref,handle_json,handle_digest,fence_digest,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(handle.workspaceId,handle.handleId,handle.materialKey,handle.endpointId,handle.physicalIdentity.mountScopeId,
      handle.physicalIdentity.inode,handle.physicalIdentity.fingerprintAlgorithm,handle.physicalIdentity.fingerprintVersion,handle.physicalIdentity.contentFingerprint,handle.relativePath,'sha256',
      handle.digestHex,handle.sizeBytes,1,'libra','run-1',handle.rootHandleRef,handle.accessScope,handle.schemaRef,
      canonicalJson(handle),canonicalDigest(handle),handle.fenceDigest,'active');
}

function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p9-reference-')),databasePath=path.join(root,'shelfdeck.db'),now=1700000000000,
    kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now}),unitOfWork=createSqliteUnitOfWork({kernel}),handle=createHandle();
  try {
    const emptySet=referenceSetDigest(handle.workspaceId,[]),state={workspaceId:handle.workspaceId,workspaceRevision:1,state:'active',workspaceMaterialReferenceSetDigest:emptySet,transitionKind:'admitted',transitionEvidenceDigest:D('admission')};
    state.stateDigest=workspaceStateDigest(state);
    const db=new Database(databasePath);db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO libra_runs (libra_run_id,state,state_revision,state_digest,package_revision_head) VALUES (?,?,?,?,0)').run('run-1','active',1,D('run-state'));
    db.prepare('INSERT INTO libra_run_revisions (libra_run_id,state_revision,state,expected_admission_head_revision,revision_digest) VALUES (?,?,?,?,?)').run('run-1',1,'active',0,D('run-revision'));
    db.prepare('INSERT INTO libra_workspaces (workspace_id,libra_run_id,platform_workspace_endpoint_id,platform_workspace_mount_scope_id,root_handle_ref,current_revision,state,state_digest) VALUES (?,?,?,?,?,?,?,?)').run(handle.workspaceId,'run-1','endpoint-1','mount-1','root-handle-1',1,'active',state.stateDigest);
    db.prepare('INSERT INTO libra_workspace_revisions (workspace_id,workspace_revision,state,material_reference_set_digest,transition_kind,transition_evidence_digest,previous_revision,revision_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run(handle.workspaceId,1,'active',emptySet,'admitted',D('admission'),null,D('workspace-revision'),now);
    insertWorkspaceMaterial(db,handle);
    db.close();
    return run({databasePath,kernel,unitOfWork,handle,state});
  } finally {kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
}

function attachDecision(input) {
  return buildReferenceDecision({operation:'attach_working',libraRunId:'run-1',workspaceId:input.handle.workspaceId,expectedWorkspaceRevision:1,
    expectedWorkspaceStateDigest:input.state.stateDigest,expectedReference:{state:'absent',revision:0,digest:canonicalDigest({schema:'libra.workspace-reference-absent@1',workspaceId:input.handle.workspaceId,materialHandleId:input.handle.handleId})},
    workspaceMaterialHandle:input.handle,episodeClaims:[],episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:null});
}

function verification(handle) {
  const value={schemaRef:'helix://contracts/types/ProductMediaVerification/v1',schemaVersion:1,verificationId:'',verificationKind:'libra_product_media',basisDigest:D('verification-basis'),result:'passed',reasonCodes:[],evidenceRefs:['probe-1'],verifiedAtMs:1700000000000,
    candidateId:D('candidate'),candidateNodeId:'node-1',candidateBasisDigest:D('candidate-basis'),candidateKind:'workspace_output',
    libraRunId:'run-1',producingEventId:'event-1',workspaceMediaHandleId:'workspace-media-1',productMaterialHandleId:handle.handleId,
    productMaterialHandleDigest:canonicalDigest(handle),productMaterialFenceDigest:handle.fenceDigest,mediaRequirementId:D('requirement-id'),mediaRequirementDigest:D('requirement'),
    sourceProbeEvidenceId:'source-probe',sourceProbeEvidenceDigest:D('source-probe'),outputProbeEvidenceId:'output-probe',outputProbeEvidenceDigest:D('output-probe'),
    qualitySummary:{videoCodec:'hevc',container:'matroska',fileExtension:'mkv',displayRasterClass:'4k',primaryAudioClasses:[],sourceDisplayRasterClass:'4k',systemUpscaleDetected:false},
    spaceSummary:{unit:'product',actualSizeBytes:100,maxSizeBytes:null,withinLimit:true}};
  value.verificationId=canonicalDigest({schema:'libra.product-media-verification-id@1',candidateId:value.candidateId,candidateNodeId:value.candidateNodeId,
    candidateBasisDigest:value.candidateBasisDigest,candidateKind:value.candidateKind,libraRunId:'run-1',productMaterialHandleId:handle.handleId,
    productMaterialFenceDigest:handle.fenceDigest,mediaRequirementDigest:value.mediaRequirementDigest,sourceProbeEvidenceDigest:value.sourceProbeEvidenceDigest,
    outputProbeEvidenceDigest:value.outputProbeEvidenceDigest});
  const snapshot={verificationKind:'media',materialRole:'primary_payload',libraRunId:'run-1',
    workspaceMaterialHandleId:handle.handleId,workspaceMaterialHandleDigest:canonicalDigest(handle),
    workspaceMaterialFenceDigest:handle.fenceDigest,schemaRef:'ProductMediaVerification@1',
    verificationId:value.verificationId,verificationValue:value,verificationDigest:canonicalDigest(value)};
  snapshot.snapshotDigest=canonicalDigest(snapshot);
  return snapshot;
}

function artifactVerification(handle,materialRole='metadata_sidecar') {
  const artifactKind={metadata_sidecar:'nfo',poster:'poster',fanart:'fanart'}[materialRole],
    requirementPayload={mediaType:artifactKind==='nfo'?'application/xml':'image/jpeg'},
    requirementDigest=canonicalDigest({schema:'shared.artifact-requirement@1',revision:1,
      schemaRef:'shelfdeck.product-artifact@1',artifactKind,requirementPayload}),
    requirement={requirementId:canonicalDigest({schema:'shared.artifact-requirement-id@1',requirementDigest}),
      revision:1,schemaRef:'shelfdeck.product-artifact@1',artifactKind,requirementPayload,requirementDigest},
    artifactHandle={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,
      artifactHandleId:D('artifact-'+materialRole),artifactKind,ownerDomain:'libra',
      ownerScope:{scopeType:'libra_workspace',scopeId:handle.workspaceId},storageRef:handle.relativePath,
      digestAlgorithm:'sha256',digestHex:handle.digestHex,sizeBytes:handle.sizeBytes,
      mediaType:requirementPayload.mediaType,provenanceRef:{objectType:'libra_run',objectId:'run-1',revision:1,digest:D('artifact-provenance')},
      referenceRevision:1},
    value=buildArtifactManifestVerification({requirement,artifactHandles:[artifactHandle],verifiedAtMs:1700000000000}),
    snapshot={verificationKind:'artifact',materialRole,libraRunId:'run-1',
      workspaceMaterialHandleId:handle.handleId,workspaceMaterialHandleDigest:canonicalDigest(handle),
      workspaceMaterialFenceDigest:handle.fenceDigest,schemaRef:'ArtifactManifestVerification@1',
      verificationId:value.verificationId,verificationValue:value,verificationDigest:canonicalDigest(value),
      artifactHandle,artifactRequirement:requirement};
  snapshot.snapshotDigest=canonicalDigest(snapshot);
  return snapshot;
}

function structuralVerification(handle,materialRole='subtitle') {
  const verifiedMemberDigest=canonicalDigest({schema:'libra.workspace-structural-member@1',libraRunId:'run-1',
      materialRole,workspaceMaterialHandleId:handle.handleId,workspaceMaterialHandleDigest:canonicalDigest(handle),
      workspaceMaterialFenceDigest:handle.fenceDigest}),
    parameter=(name,value)=>({parameter:name,valueType:'string',value,
      valueDigest:canonicalDigest({schema:'libra.manifest-contract-parameter@1',parameter:name,valueType:'string',value})}),
    manifestContract={schemaRef:'helix://contracts/domain-types/ManifestContract/v1',schemaVersion:1,
      contractId:'libra.workspace-structural-material@1',revision:1,digest:D('structural-contract'),
      manifestKind:materialRole,memberSchemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',minMembers:1,maxMembers:1,
      typedParameters:[parameter('libraRunId','run-1'),parameter('materialRole',materialRole),
        parameter('workspaceMaterialHandleDigest',canonicalDigest(handle)),parameter('workspaceMaterialFenceDigest',handle.fenceDigest)]},
    typedManifest={schemaRef:'helix://contracts/domain-types/TypedManifest/v1',schemaVersion:1,objectId:handle.handleId,
      revision:1,digest:verifiedMemberDigest,manifest:{objectId:handle.handleId,revision:1,
        schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',digest:verifiedMemberDigest,objectKind:'typed-manifest'},
      contractRef:manifestContract.contractId,verificationDigest:D('typed-manifest-verification')},
    value={schemaRef:'helix://contracts/types/ManifestVerification/v1',schemaVersion:1,
      verificationId:D('manifest-verification-'+materialRole),verificationKind:'typed_manifest',
      basisDigest:D('manifest-basis-'+materialRole),result:'passed',reasonCodes:[],evidenceRefs:[],verifiedAtMs:1700000000000,
      manifestDigest:verifiedMemberDigest,contractRef:manifestContract.contractId},
    snapshot={verificationKind:'structural',materialRole,libraRunId:'run-1',
      workspaceMaterialHandleId:handle.handleId,workspaceMaterialHandleDigest:canonicalDigest(handle),
      workspaceMaterialFenceDigest:handle.fenceDigest,schemaRef:'ManifestVerification@1',
      verificationId:value.verificationId,verificationValue:value,verificationDigest:canonicalDigest(value),
      typedManifest,manifestContract,verifiedMemberDigest};
  snapshot.snapshotDigest=canonicalDigest(snapshot);
  return snapshot;
}

test('attaches, replays, and promotes one immutable Workspace Reference without moving bytes',()=>fixture((input)=>{
  const store=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:input.unitOfWork}),attach=attachDecision(input),first=store.commit({decision:attach,commitMarker:'attach-marker',resultId:'attach-result'}),replay=store.commit({decision:attach,commitMarker:'attach-marker',resultId:'attach-result'});
  assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);assert.equal(first.result.referenceSnapshot.state,'working');
  const promote=buildReferenceDecision({operation:'promote_to_product_staging',libraRunId:'run-1',workspaceId:input.handle.workspaceId,expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:first.result.workspaceStateDigest,
    expectedReference:{state:'present',revision:1,digest:first.result.referenceSnapshot.referenceDigest},workspaceMaterialHandle:input.handle,episodeClaims:[],episodeScopeDigest:first.result.referenceSnapshot.episodeScopeDigest,productVerificationRef:verification(input.handle)}),second=store.commit({decision:promote,commitMarker:'promote-marker',resultId:'promote-result'});
  assert.equal(second.result.referenceSnapshot.state,'product_staging');assert.equal(second.result.referenceSnapshot.referenceRevision,2);assert.equal(second.result.workspaceRevision,3);
  const db=new Database(input.databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_workspace_material_refs').get().n,2);assert.equal(db.prepare('SELECT current_revision FROM libra_workspaces').get().current_revision,3);assert.equal(db.prepare('SELECT state FROM fx_workspace_materials').get().state,'active');db.close();
}));

test('rolls Reference, Workspace revision, CAS, Result, and marker back on a crash',()=>fixture((input)=>{
  const crashing={execute(participants){return input.unitOfWork.execute(participants.map((participant)=>participant.participantId!=='workspace_reference_finish'?participant:{...participant,execute(){throw new Error('fixture-crash');}}));}},store=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:crashing});
  assert.throws(()=>store.commit({decision:attachDecision(input),commitMarker:'crash-marker',resultId:'crash-result'}),/fixture-crash/);
  const db=new Database(input.databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_workspace_material_refs').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_workspace_revisions').get().n,1);assert.equal(db.prepare('SELECT current_revision FROM libra_workspaces').get().current_revision,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_event_result_bindings').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_commit_markers').get().n,0);db.close();
}));

test('rejects forged Handle and cross-Handle Product Verification',()=>fixture((input)=>{
  const forged={...input.handle,fenceDigest:D('forged')};assert.throws(()=>buildReferenceDecision({...attachDecision(input),workspaceMaterialHandle:forged,decisionId:undefined,decisionDigest:undefined}),(error)=>error.code==='P9_REFERENCE_HANDLE');
  const other={...verification(input.handle),verificationValue:{...verification(input.handle).verificationValue,productMaterialHandleId:D('other')}};other.verificationDigest=canonicalDigest(other.verificationValue);
  other.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(other).filter(([key])=>key!=='snapshotDigest')));
  assert.throws(()=>buildReferenceDecision({operation:'promote_to_product_staging',libraRunId:'run-1',workspaceId:input.handle.workspaceId,expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:D('state'),expectedReference:{state:'present',revision:1,digest:D('reference')},workspaceMaterialHandle:input.handle,episodeClaims:[],episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:other}),(error)=>error.code==='P9_REFERENCE_VERIFICATION');
}));

test('stages an NFO only with exact Artifact verification, Registry bytes, replay, and role binding',()=>fixture((input)=>{
  const handle=createHandle({inode:'43',relativePath:'output/movie.nfo',contentFingerprint:D('nfo-content'),sizeBytes:55}),
    productVerificationRef=artifactVerification(handle),artifact=productVerificationRef.artifactHandle,
    db=new Database(input.databasePath);
  db.pragma('foreign_keys = OFF');insertWorkspaceMaterial(db,handle);
  db.prepare('INSERT INTO fx_artifact_registry (artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,storage_ref,digest_algorithm,digest_hex,size_bytes,media_type,provenance_ref,reference_revision,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(artifact.artifactHandleId,artifact.artifactKind,artifact.ownerDomain,artifact.ownerScope.scopeType,
      artifact.ownerScope.scopeId,artifact.storageRef,artifact.digestAlgorithm,artifact.digestHex,artifact.sizeBytes,
      artifact.mediaType,canonicalJson(artifact.provenanceRef),artifact.referenceRevision,'active',1700000000000);
  db.close();
  const store=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:input.unitOfWork}),
    attach=buildReferenceDecision({operation:'attach_working',libraRunId:'run-1',workspaceId:handle.workspaceId,
      expectedWorkspaceRevision:1,expectedWorkspaceStateDigest:input.state.stateDigest,
      expectedReference:{state:'absent',revision:0,digest:canonicalDigest({schema:'libra.workspace-reference-absent@1',
        workspaceId:handle.workspaceId,materialHandleId:handle.handleId})},workspaceMaterialHandle:handle,episodeClaims:[],
      episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:null}),
    attached=store.commit({decision:attach,commitMarker:'nfo-attach',resultId:'nfo-attach-result'}).result,
    promote=buildReferenceDecision({operation:'promote_to_product_staging',libraRunId:'run-1',workspaceId:handle.workspaceId,
      expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:attached.workspaceStateDigest,
      expectedReference:{state:'present',revision:1,digest:attached.referenceSnapshot.referenceDigest},
      workspaceMaterialHandle:handle,episodeClaims:[],episodeScopeDigest:attached.referenceSnapshot.episodeScopeDigest,
      productVerificationRef}),
    staged=store.commit({decision:promote,commitMarker:'nfo-promote',resultId:'nfo-promote-result'}),
    replayStore=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel:input.kernel})}),
    replay=replayStore.commit({decision:promote,commitMarker:'nfo-promote',resultId:'nfo-promote-result'});
  assert.equal(staged.result.referenceSnapshot.productVerificationRef.materialRole,'metadata_sidecar');
  assert.equal(replay.replayed,true);assert.deepEqual(replay.result,staged.result);
  const readonly=new Database(input.databasePath,{readonly:true}),row=readonly.prepare(
    'SELECT product_verification_id,product_verification_digest FROM libra_workspace_material_refs WHERE reference_state=?').get('product_staging');
  assert.equal(row.product_verification_id,productVerificationRef.verificationId);
  assert.equal(row.product_verification_digest,productVerificationRef.snapshotDigest);readonly.close();
  const wrongRole={...productVerificationRef,materialRole:'poster'};
  wrongRole.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(wrongRole).filter(([key])=>key!=='snapshotDigest')));
  assert.throws(()=>buildReferenceDecision({...promote,decisionId:undefined,decisionDigest:undefined,productVerificationRef:wrongRole}),
    (error)=>error.code==='P9_REFERENCE_VERIFICATION');
  const artifactClaim={episodeKey:'E001',seasonClaimDigest:D('season-1'),claimDigest:D('episode-1')},
    artifactClaims=[artifactClaim];
  assert.throws(()=>buildReferenceDecision({...promote,decisionId:undefined,decisionDigest:undefined,
    episodeClaims:artifactClaims,episodeScopeDigest:canonicalDigest({
      schema:'libra.production-episode-scope@1',items:artifactClaims,
    })}),(error)=>error.code==='P9_REFERENCE_CLAIMS');
}));

test('rejects Artifact Registry byte drift before any staging commit',()=>fixture((input)=>{
  const nfo=createHandle({inode:'44',relativePath:'output/drift.nfo',contentFingerprint:D('drift-content'),sizeBytes:66}),
    artifactSnapshot=artifactVerification(nfo),artifact=artifactSnapshot.artifactHandle,
    db=new Database(input.databasePath);
  db.pragma('foreign_keys = OFF');insertWorkspaceMaterial(db,nfo);
  db.prepare('INSERT INTO fx_artifact_registry (artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,storage_ref,digest_algorithm,digest_hex,size_bytes,media_type,provenance_ref,reference_revision,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(artifact.artifactHandleId,artifact.artifactKind,artifact.ownerDomain,artifact.ownerScope.scopeType,
      artifact.ownerScope.scopeId,artifact.storageRef,artifact.digestAlgorithm,D('wrong-bytes'),artifact.sizeBytes,
      artifact.mediaType,canonicalJson(artifact.provenanceRef),artifact.referenceRevision,'active',1700000000000);
  db.close();
  const store=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:input.unitOfWork}),
    attach=buildReferenceDecision({operation:'attach_working',libraRunId:'run-1',workspaceId:nfo.workspaceId,
      expectedWorkspaceRevision:1,expectedWorkspaceStateDigest:input.state.stateDigest,
      expectedReference:{state:'absent',revision:0,digest:canonicalDigest({schema:'libra.workspace-reference-absent@1',
        workspaceId:nfo.workspaceId,materialHandleId:nfo.handleId})},workspaceMaterialHandle:nfo,episodeClaims:[],
      episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:null}),
    attached=store.commit({decision:attach,commitMarker:'drift-attach',resultId:'drift-attach-result'}).result,
    promote=buildReferenceDecision({operation:'promote_to_product_staging',libraRunId:'run-1',workspaceId:nfo.workspaceId,
      expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:attached.workspaceStateDigest,
      expectedReference:{state:'present',revision:1,digest:attached.referenceSnapshot.referenceDigest},
      workspaceMaterialHandle:nfo,episodeClaims:[],episodeScopeDigest:attached.referenceSnapshot.episodeScopeDigest,
      productVerificationRef:artifactSnapshot});
  assert.throws(()=>store.commit({decision:promote,commitMarker:'drift-promote',resultId:'drift-promote-result'}),
    (error)=>error.code==='P9_REFERENCE_ARTIFACT_CORRUPT');
}));

test('stages a structural member with the exact role-aware Manifest proof',()=>fixture((input)=>{
  const handle=createHandle({inode:'45',relativePath:'output/movie.en.srt',contentFingerprint:D('subtitle'),sizeBytes:77}),
    db=new Database(input.databasePath);
  db.pragma('foreign_keys = OFF');insertWorkspaceMaterial(db,handle);db.close();
  const store=createWorkspaceMaterialReferenceStore({schemaManifest,unitOfWork:input.unitOfWork}),
    attach=buildReferenceDecision({operation:'attach_working',libraRunId:'run-1',workspaceId:handle.workspaceId,
      expectedWorkspaceRevision:1,expectedWorkspaceStateDigest:input.state.stateDigest,
      expectedReference:{state:'absent',revision:0,digest:canonicalDigest({schema:'libra.workspace-reference-absent@1',
        workspaceId:handle.workspaceId,materialHandleId:handle.handleId})},workspaceMaterialHandle:handle,episodeClaims:[],
      episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:null}),
    attached=store.commit({decision:attach,commitMarker:'subtitle-attach',resultId:'subtitle-attach-result'}).result,
    proof=structuralVerification(handle),
    promote=buildReferenceDecision({operation:'promote_to_product_staging',libraRunId:'run-1',workspaceId:handle.workspaceId,
      expectedWorkspaceRevision:2,expectedWorkspaceStateDigest:attached.workspaceStateDigest,
      expectedReference:{state:'present',revision:1,digest:attached.referenceSnapshot.referenceDigest},
      workspaceMaterialHandle:handle,episodeClaims:[],episodeScopeDigest:attached.referenceSnapshot.episodeScopeDigest,
      productVerificationRef:proof}),
    staged=store.commit({decision:promote,commitMarker:'subtitle-promote',resultId:'subtitle-promote-result'});
  assert.equal(staged.result.referenceSnapshot.productVerificationRef.verificationKind,'structural');
  assert.equal(staged.result.referenceSnapshot.productVerificationRef.materialRole,'subtitle');
}));
