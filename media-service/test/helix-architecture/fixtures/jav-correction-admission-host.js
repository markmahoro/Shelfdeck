'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createMaterialControlProjectionPort}=require('../../../src/helix/foundation/persistence/material-control');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {createAftercareStore}=require('../../../src/helix/domains/arca/persistence/aftercare-store');
const {createOffdeckStore}=require('../../../src/helix/domains/arca/persistence/offdeck-store');
const {createShelfDeregistrationStore}=require('../../../src/helix/domains/arca/persistence/shelf-deregistration-store');
const {createShelfQueryStore}=require('../../../src/helix/domains/arca/persistence/shelf-query-store');
const {createJavIdentityCorrectionStore}=require('../../../src/helix/domains/arca/persistence/jav-identity-correction-store');
const {createJavIdentityCorrectionPreview}=require('../../../src/helix/domains/arca/application/jav-identity-correction-preview');
const {buildJavCorrectionProposal}=require('../../../src/helix/domains/arca/model/jav-identity-correction');
const {createCleanArcaInventoryPort}=require('../../../src/clean-arca-inventory-port');
const {buildArcaApplicationSchemas}=require('../../../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../../../scripts/helix-architecture/shared-type-schema-builder');
const {createJavCorrectionWorkspaceStore}=require('../../../src/helix/domains/arca/persistence/jav-correction-workspace-store');
const {computeBoundedMaterialFingerprintSync}=require('../../../src/helix/integrations/bounded-material-fingerprint');
const {createHash}=require('node:crypto');
const source=require('./jav-correction');

async function assertCorrectionAdmission({host,dataDir,db}) {
  await host.close();
  const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated'),
    schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),kernel=openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaDdl,schemaManifest}),
    schemas=buildArcaApplicationSchemas(),contractValidator=createCapabilityContractValidator({schemas:[...Object.values(buildSharedTypeSchemas()),...Object.entries(schemas).filter(([name])=>name.startsWith('ArcaJavCorrection')).map(([,schema])=>schema)]}),
    rootRow=db.prepare('SELECT endpoint_id,mount_scope_id,mount_scope_revision FROM platform_workspace_roots WHERE root_id=?').get('service-arca-aftercare-workspace'),
    options={schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),contractValidator,aftercareWorkspaceRoot:path.join(dataDir,'workspaces','aftercare'),
      aftercareWorkspaceEndpointId:rootRow.endpoint_id,aftercareWorkspaceMountScopeId:rootRow.mount_scope_id,aftercareWorkspaceMountScopeRevision:Number(rootRow.mount_scope_revision)};
  try {
    const ownerStore=createAftercareStore(options),entry=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get(),entryId=entry.shelf_entry_id,
      contextReader={store:ownerStore,read:id=>({shelfEntryId:id,raw:ownerStore.currentContext(id)})},
      inventoryPort=createCleanArcaInventoryPort({...options,workspaceRoot:path.join(dataDir,'workspaces','libra')}),
      previewService=createJavIdentityCorrectionPreview({...options,contextReader,inventoryPort,materialControlProjectionPort:createMaterialControlProjectionPort(options),
        resolveJavSourceHandle:({siteRef})=>source.handle(siteRef),observeJavSourceForPreview:async request=>{
          const observation=source.observation(request.siteRef);return {observation,sourceCoverDigest:observation.cover.byteDigest,posterUrl:'data:image/jpeg;base64,/9j/2Q=='};}});
    const preview=await previewService.preview(entryId,{javCode:'IPX-178'}),proof=previewService.readPreview(entryId,preview.previewId),store=createJavIdentityCorrectionStore(options),
      input={shelfEntryId:entryId,actorId:'admin',idempotencyKey:'correction',previewId:preview.previewId,basisDigest:proof.basis.basisDigest,
        proposalDigest:proof.proposal.proposalDigest,placementPreviewDigest:proof.placementPreviewDigest};
    const preserved={entry:db.prepare('SELECT * FROM arca_shelf_entries').all(),identity:db.prepare('SELECT * FROM arca_canonical_identity_revisions').all(),
      inventory:db.prepare('SELECT * FROM arca_inventory_representations').all(),commits:db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all(),
      video:fs.readFileSync(proof.basis.materials.find(row=>row.role==='primary_payload').location),
      commandCount:db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,markerCount:db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,
      auditCount:db.prepare('SELECT count(*) n FROM fx_audit_records').get().n};
    const bad=structuredClone(proof);bad.basis.materials[0].controlRevision++;
    bad.basis.basisDigest=canonicalDigest(Object.fromEntries(Object.entries(bad.basis).filter(([key])=>key!=='basisDigest')));
    bad.proposal=buildJavCorrectionProposal({basis:bad.basis,...bad.proposal.sourceQualification});
    bad.placementPreviewDigest=canonicalDigest({shelfEntryId:entryId,basisDigest:bad.basis.basisDigest,proposalDigest:bad.proposal.proposalDigest,
      paths:bad.paths,targetRealityDigest:bad.targetRealityDigest});
    assert.throws(()=>store.admit({...input,idempotencyKey:'stale-control',basisDigest:bad.basis.basisDigest,proposalDigest:bad.proposal.proposalDigest,
      placementPreviewDigest:bad.placementPreviewDigest},bad),{code:'ARCA_JAV_CORRECTION_PREVIEW_STALE'});
    assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,preserved.commandCount);
    assert.equal(db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,preserved.markerCount);
    assert.equal(db.prepare('SELECT count(*) n FROM fx_audit_records').get().n,preserved.auditCount);
    const admitted=store.admit(input,previewService.readPreview(entryId,preview.previewId));
    assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,1);
    const restarted=createJavIdentityCorrectionStore(options),replayed=restarted.admit(input);
    assert.deepEqual(replayed.receipt,admitted.receipt);
    const correctionId=admitted.receipt.resultRef.correctionId,initial=restarted.get(correctionId);
    assert.equal(initial.state,'admitted');assert.equal(initial.stateRevision,1);assert.deepEqual(initial.proof,proof);
    ownerStore.ensureAftercareWorkspaceRoot();
    const rootSnapshot={...ownerStore.aftercareWorkspaceRootSnapshot,resolvedRoot:options.aftercareWorkspaceRoot},
      workspace=createJavCorrectionWorkspaceStore({...options,rootSnapshot});
    assert.throws(()=>workspace.ensure(correctionId,initial.admissionDigest),{code:'ARCA_JAV_CORRECTION_WORKSPACE_FENCED'});
    const activate={expectedState:'admitted',expectedStateRevision:1,expectedAdmissionDigest:initial.admissionDigest,nextState:'active'},
      activated=restarted.transition(correctionId,activate);
    assert.equal(activated.state,'active');assert.equal(activated.stateRevision,2);
    assert.equal(restarted.transition(correctionId,activate).stateRevision,2);
    const registered=workspace.ensure(correctionId,initial.admissionDigest);assert.equal(registered.process_type,'jav_identity_correction');
    assert.equal(registered.process_id,correctionId);assert.equal(workspace.ensure(correctionId,initial.admissionDigest).workspace_id,registered.workspace_id);
    const relativePath='nfo/movie.nfo',location=path.join(rootSnapshot.resolvedRoot,registered.workspace_id,'nfo','movie.nfo');
    fs.mkdirSync(path.dirname(location),{recursive:true});const bytes=Buffer.from('<movie><title>Correct film</title><uniqueid type="jav">IPX-178</uniqueid></movie>');fs.writeFileSync(location,bytes,{flag:'wx'});
    const fingerprint=computeBoundedMaterialFingerprintSync(location),physicalIdentity={mountScopeId:rootSnapshot.mountScopeId,inode:String(fingerprint.stat.ino),
      sizeBytes:Number(fingerprint.stat.size),fingerprintAlgorithm:fingerprint.fingerprintAlgorithm,fingerprintVersion:fingerprint.fingerprintVersion,contentFingerprint:fingerprint.contentFingerprint},
      digestHex=createHash('sha256').update(bytes).digest('hex'),unsigned={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,
        handleId:'correction-nfo',workspaceId:registered.workspace_id,ownerDomain:'arca',processId:correctionId,endpointId:rootSnapshot.endpointId,
        materialKey:canonicalDigest({schema:'physical-material-identity@2',...physicalIdentity}),physicalIdentity,rootHandleRef:rootSnapshot.rootHandleRef,
        relativePath,digestAlgorithm:'sha256',digestHex,sizeBytes:bytes.byteLength,referenceRevision:1,accessScope:'workspace_material_read'},
      handle={...unsigned,fenceDigest:canonicalDigest(unsigned)},artifact={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,
        artifactHandleId:'correction-nfo-artifact',artifactKind:'nfo',ownerDomain:'arca',ownerScope:{scopeType:'jav_identity_correction',scopeId:correctionId},
        storageRef:location.split(path.sep).join('/'),digestAlgorithm:'sha256',digestHex,sizeBytes:bytes.byteLength,mediaType:'application/xml',
        provenanceRef:{objectType:'jav_identity_correction',objectId:correctionId,revision:1,digest:initial.admissionDigest},referenceRevision:1};
    assert.deepEqual(workspace.register(correctionId,initial.admissionDigest,handle,artifact),{workspaceMaterialHandle:handle,artifactHandle:artifact});
    assert.deepEqual(workspace.register(correctionId,initial.admissionDigest,handle,artifact),{workspaceMaterialHandle:handle,artifactHandle:artifact});
    assert.equal(workspace.resolve(correctionId,initial.admissionDigest,handle).location,location);
    assert.throws(()=>workspace.resolve(correctionId,initial.admissionDigest,{...handle,digestHex:source.digest('forged-file')}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED'});
    assert.throws(()=>workspace.resolve(correctionId,initial.admissionDigest,{...handle,relativePath:'../outside.nfo'}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_READ_DENIED'});
    assert.throws(()=>workspace.register(correctionId,initial.admissionDigest,handle,{...artifact,storageRef:'E:/outside.nfo'}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_HANDLE_INVALID'});
    assert.throws(()=>workspace.register(correctionId,initial.admissionDigest,handle,{...artifact,ownerScope:{scopeType:'aftercare_case',scopeId:correctionId}}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_HANDLE_INVALID'});
    assert.equal(db.prepare('SELECT count(*) n FROM fx_workspace_materials WHERE workspace_id=?').get(registered.workspace_id).n,1);
    assert.throws(()=>restarted.transition(correctionId,{...activate,expectedAdmissionDigest:source.digest('different-admission')}),{code:'ARCA_JAV_CORRECTION_TRANSITION_STALE'});
    assert.throws(()=>restarted.transition(correctionId,{expectedState:'active',expectedStateRevision:2,expectedAdmissionDigest:initial.admissionDigest,nextState:'committed'}),{code:'ARCA_JAV_CORRECTION_TRANSITION_INVALID'});
    const attention=restarted.transition(correctionId,{expectedState:'active',expectedStateRevision:2,expectedAdmissionDigest:initial.admissionDigest,nextState:'attention_required'});
    assert.equal(attention.stateRevision,3);
    assert.throws(()=>workspace.register(correctionId,initial.admissionDigest,handle,artifact),{code:'ARCA_JAV_CORRECTION_WORKSPACE_FENCED'});
    assert.throws(()=>workspace.resolve(correctionId,initial.admissionDigest,handle),{code:'ARCA_JAV_CORRECTION_WORKSPACE_FENCED'});
    const page=restarted.listActivePage();assert.equal(page.items.length,1);assert.equal(page.items[0].state,'attention_required');assert.equal(page.nextCursor,null);
    assert.throws(()=>restarted.admit({...input,proposalDigest:source.digest('changed')}),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
    assert.throws(()=>restarted.admit({...input,idempotencyKey:'another-correction'},proof),{code:'ARCA_JAV_CORRECTION_BUSY'});
    assert.throws(()=>previewService.readPreview(entryId,preview.previewId),{code:'ARCA_JAV_CORRECTION_BUSY'});
    const controls=createMaterialControlProjectionPort(options),offdeck=createOffdeckStore(options);
    assert.throws(()=>offdeck.createReview({shelfEntryId:entryId,originKind:'direct_intent',actorId:'admin',idempotencyKey:'correction-gate-offdeck'},
      keys=>controls.getMaterialControlProjections(keys)),{code:'ARCA_JAV_CORRECTION_BUSY'});
    assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_reviews').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_offdeck_reservations').get().n,0);
    const shelf=db.prepare('SELECT * FROM arca_shelves WHERE shelf_id=?').get(proof.basis.shelfId),standard=db.prepare('SELECT * FROM arca_shelf_standard_revisions WHERE shelf_id=? AND revision=?').get(shelf.shelf_id,shelf.current_standard_revision);
    assert.throws(()=>createShelfDeregistrationStore(options).admit({idempotencyKey:'correction-gate-deregister',input:{shelfId:shelf.shelf_id,
      expectedStatus:'active',expectedUpdatedAtMs:shelf.updated_at_ms,expectedRoutingProjectionRevision:shelf.routing_projection_revision,
      confirmation:{decision:'deregister_shelf',enteredShelfName:shelf.name,preservePhysicalFilesAcknowledged:true,releaseControlAcknowledged:true}}}),{code:'ARCA_JAV_CORRECTION_BUSY'});
    assert.equal(db.prepare('SELECT count(*) n FROM arca_deregistrations').get().n,0);
    assert.throws(()=>createShelfQueryStore(options).reviseStandard({idempotencyKey:'correction-gate-standard',input:{shelfId:shelf.shelf_id,
      expectedStandardRevision:shelf.current_standard_revision,expectedRoutingProjectionRevision:shelf.routing_projection_revision,
      standard:{ruleTemplateId:standard.rule_template_id,ruleTemplateRevision:standard.rule_template_revision,schemaRef:standard.standard_schema_ref,
        value:JSON.parse(standard.standard_json),digest:standard.standard_digest}}}),{code:'ARCA_JAV_CORRECTION_BUSY'});
    assert.deepEqual(db.prepare('SELECT * FROM arca_shelves WHERE shelf_id=?').get(shelf.shelf_id),shelf);
    assert.deepEqual(db.prepare('SELECT * FROM arca_shelf_entries').all(),preserved.entry);
    assert.deepEqual(db.prepare('SELECT * FROM arca_canonical_identity_revisions').all(),preserved.identity);
    assert.deepEqual(db.prepare('SELECT * FROM arca_inventory_representations').all(),preserved.inventory);
    assert.deepEqual(db.prepare('SELECT * FROM arca_ondeck_commit_receipts').all(),preserved.commits);
    assert.deepEqual(fs.readFileSync(proof.basis.materials.find(row=>row.role==='primary_payload').location),preserved.video);
  } finally {kernel.close();}
}
module.exports={assertCorrectionAdmission};
