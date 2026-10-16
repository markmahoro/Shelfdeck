'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const assert=require('node:assert/strict');
const os=require('node:os');
const {canonicalDigest,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createMaterialControlProjectionPort}=require('../../../src/helix/foundation/persistence/material-control');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {createAftercareStore}=require('../../../src/helix/domains/arca/persistence/aftercare-store');
const {createJavIdentityCorrectionStore}=require('../../../src/helix/domains/arca/persistence/jav-identity-correction-store');
const {createJavIdentityCorrectionPreview}=require('../../../src/helix/domains/arca/application/jav-identity-correction-preview');
const {createCleanArcaInventoryPort}=require('../../../src/clean-arca-inventory-port');
const {createPlatformIntegrationServices}=require('../../../src/clean-service-host');
const {buildArcaApplicationSchemas}=require('../../../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../../../scripts/helix-architecture/shared-type-schema-builder');
const {createWorkResultReader}=require('../../../src/helix/foundation/execution/work-result-reader');
const {createJavCorrectionWorkspaceStore}=require('../../../src/helix/domains/arca/persistence/jav-correction-workspace-store');
const {createJavCorrectionContextReader}=require('../../../src/helix/domains/arca/application/jav-correction-context-reader');
const {createJavCorrectionFilePlanPreparation}=require('../../../src/helix/domains/arca/application/jav-correction-file-plan-preparation');
const {createJavCorrectionInventoryPreparation}=require('../../../src/helix/domains/arca/application/jav-correction-inventory-preparation');

async function admitCorrection({host,dataDir,db,secretRoot,fetchImpl}) {
  await host.close();
  const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated'),
    schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),
    kernel=openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaDdl,schemaManifest}),
    contractValidator=createCapabilityContractValidator({schemas:[...Object.values(buildSharedTypeSchemas()),...Object.values(buildArcaApplicationSchemas())]}),
    options={dataDir,secretRoot,fetchImpl,schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),contractValidator,aftercareWorkspaceRoot:path.join(dataDir,'workspaces','aftercare')};
  try {
    const platform=createPlatformIntegrationServices(options),ownerStore=createAftercareStore(options),
      contextReader={store:ownerStore,read:id=>({shelfEntryId:id,raw:ownerStore.currentContext(id)})},
      inventoryPort=createCleanArcaInventoryPort({...options,workspaceRoot:path.join(dataDir,'workspaces','libra')}),
      previewService=createJavIdentityCorrectionPreview({...options,contextReader,inventoryPort,
        materialControlProjectionPort:createMaterialControlProjectionPort(options),resolveJavSourceHandle:platform.resolveJavSourceHandle,
        observeJavSourceForPreview:platform.previewJavSource}),
      entryId=db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id,
      preview=await previewService.preview(entryId,{javCode:'IPX-178'}),proof=previewService.readPreview(entryId,preview.previewId),
      result=createJavIdentityCorrectionStore(options).admit({shelfEntryId:entryId,actorId:'admin',idempotencyKey:'formal-correction-assets',
        previewId:preview.previewId,basisDigest:proof.basis.basisDigest,proposalDigest:proof.proposal.proposalDigest,
        placementPreviewDigest:proof.placementPreviewDigest},proof);
    return result.receipt.resultRef.correctionId;
  } finally {kernel.close();}
}
async function inspectFilePlan({host,dataDir,db,correctionId,atomicCommit=false}) {
  await host.close();
  const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated'),
    schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),
    kernel=openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaDdl,schemaManifest}),
    contractValidator=createCapabilityContractValidator({schemas:[...Object.values(buildSharedTypeSchemas()),...Object.values(buildArcaApplicationSchemas()),
      require('../../../src/helix/domains/arca/model/jav-correction-commit-contract').javCorrectionCommitReceiptSchema(),
      require('../../../src/helix/contracts/types/JavCorrectionSourceVerified/v1/schema.json'),
      require('../../../src/helix/contracts/types/StagedInventoryManifestRecord/v1/schema.json')]}),
    root=db.prepare('SELECT endpoint_id,mount_scope_id,mount_scope_revision,resolved_root FROM platform_workspace_roots WHERE root_id=?').get('service-arca-aftercare-workspace'),
    options={schemaManifest,contractValidator,unitOfWork:createSqliteUnitOfWork({kernel}),aftercareWorkspaceRoot:root.resolved_root,
      aftercareWorkspaceEndpointId:root.endpoint_id,aftercareWorkspaceMountScopeId:root.mount_scope_id,aftercareWorkspaceMountScopeRevision:Number(root.mount_scope_revision)};
  try {
    const store=createAftercareStore(options);store.ensureAftercareWorkspaceRoot();
    const rootSnapshot={...store.aftercareWorkspaceRootSnapshot,resolvedRoot:root.resolved_root},correctionStore=createJavIdentityCorrectionStore(options),
      materialControlProjectionPort=createMaterialControlProjectionPort(options),contextReader={store,read:id=>({shelfEntryId:id,raw:store.currentContext(id)})},
      correctionContextReader=createJavCorrectionContextReader({...options,rootSnapshot,correctionStore,contextReader,materialControlProjectionPort}),
      workspaceStore=createJavCorrectionWorkspaceStore({...options,rootSnapshot}),workResultReader=createWorkResultReader(options),
      workId=db.prepare("SELECT work_id FROM fx_supporting_works WHERE process_id=? AND work_kind='jav_correction_assets' AND state='succeeded'").get(correctionId).work_id,
      service=createJavCorrectionFilePlanPreparation({...options,correctionContextReader,workspaceStore,workResultReader});
    const plan=service.prepare(correctionId,workId),locations=new Map(plan.members.filter(item=>item.source.kind==='correction_artifact')
      .map(item=>[item.source.workspaceMaterialHandle.handleId,workspaceStore.resolve(correctionId,plan.admissionDigest,item.source.workspaceMaterialHandle)]));
    const people=require('../../../src/helix/domains/people/public').createPeopleProcessServices(options),
      inventoryPreparation=createJavCorrectionInventoryPreparation({...options,correctionContextReader,contextReader,materialControlProjectionPort,
        filePlanPreparation:service,workResultReader,resolveMediaCastReference:input=>people.mediaCastReferenceQuery.resolve(input)}),
      preparedInventory=inventoryPreparation.prepare(correctionId,200),
      rejectedPreparation=createJavCorrectionInventoryPreparation({...options,correctionContextReader,contextReader,materialControlProjectionPort,
        filePlanPreparation:service,workResultReader:{...workResultReader,status:candidateWorkId=>{
          const status=workResultReader.status(candidateWorkId);
          return candidateWorkId===workId?{...status,state:'running'}:status;
        }},
        resolveMediaCastReference:input=>people.mediaCastReferenceQuery.resolve(input)});
    // Source verification belongs to this same assets Work and is the first
    // readiness fence; an unfinished Work cannot prove its Source Result.
    require('node:assert/strict').throws(()=>rejectedPreparation.prepare(correctionId,200),{code:'ARCA_JAV_CORRECTION_SOURCE_RESULT_UNPROVEN'});
    const context=correctionContextReader.read(correctionId),committed=atomicCommit?require('./jav-correction-commit-host').verifyAtomicCommit({options,db,preparedInventory}):null;
    let formalRetirement=null;
    if(committed){
      const current=store.currentContext(context.record.shelfEntryId),record=correctionStore.get(correctionId),
        keys=[...new Set([...current.materials.map(row=>row.material_key),...record.proof.basis.materials.map(row=>row.physicalIdentity.materialKey)])].sort(),controls=[];
      for(let offset=0;offset<keys.length;offset+=500)controls.push(...materialControlProjectionPort.getMaterialControlProjections(keys.slice(offset,offset+500)));
      const {SCHEMA,buildJavCorrectionFormalRetirementPlan}=require('../../../src/helix/domains/arca/model/jav-correction-formal-retirement'),
        input={record,commit:committed,plan,manifest:preparedInventory.manifest,raw:current,controlProjections:controls,activeCases:store.history(record.shelfEntryId).cases};
      formalRetirement=buildJavCorrectionFormalRetirementPlan(input);contractValidator.validate(SCHEMA,formalRetirement);
      const restored=require('../../../src/helix/domains/arca/application/jav-correction-retirement-preparation').createJavCorrectionRetirementPreparation({
        ...options,contextReader,correctionStore,materialControlProjectionPort}).prepare(correctionId);
      require('node:assert/strict').deepEqual(restored,formalRetirement);
      const port=require('../../../src/helix/integrations/jav-correction-formal-retirement').createJavCorrectionFormalRetirement({validatePlan:value=>contractValidator.validate(SCHEMA,value)});
      await port.preflight(formalRetirement,{shouldContinue:()=>true,readCurrentGuardDigest:()=>buildJavCorrectionFormalRetirementPlan(input).guardDigest});
    }
    return {plan,locations,context,results:workResultReader.read(workId),preparedInventory,committed,formalRetirement};
  } finally {kernel.close();}
}
async function inspectCommittedRetirement({host,dataDir,db,correctionId,receiptOnly=false}){
  await host.close();
  const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated'),schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    kernel=openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),schemaManifest}),
    contractValidator=createCapabilityContractValidator({schemas:[...Object.values(buildSharedTypeSchemas()),...Object.values(buildArcaApplicationSchemas()),
      require('../../../src/helix/domains/arca/model/jav-correction-commit-contract').javCorrectionCommitReceiptSchema(),require('../../../src/helix/contracts/types/StagedInventoryManifestRecord/v1/schema.json'),
      require('../../../src/helix/domains/arca/model/jav-correction-retirement-contract').retirementReceiptSchema(),
      require('../../../src/helix/domains/arca/model/jav-correction-workspace-reclaim-contract').workspaceReclaimReceiptSchema(),
      require('../../../src/helix/contracts/types/JavCorrectionAssetsPrepared/v1/schema.json')]}),
    root=db.prepare('SELECT endpoint_id,mount_scope_id,mount_scope_revision,resolved_root FROM platform_workspace_roots WHERE root_id=?').get('service-arca-aftercare-workspace'),
    options={schemaManifest,contractValidator,unitOfWork:createSqliteUnitOfWork({kernel}),aftercareWorkspaceRoot:root.resolved_root,
      aftercareWorkspaceEndpointId:root.endpoint_id,aftercareWorkspaceMountScopeId:root.mount_scope_id,aftercareWorkspaceMountScopeRevision:Number(root.mount_scope_revision)};
  try{
    if(receiptOnly){const correctionStore=createJavIdentityCorrectionStore(options),
      cleanupStore=require('../../../src/helix/domains/arca/persistence/jav-correction-cleanup-store').createJavCorrectionCleanupStore({...options,correctionStore});
      const store=createAftercareStore(options),directoryScope=require('../../../src/helix/domains/arca/application/jav-correction-directory-preparation').createJavCorrectionDirectoryPreparation({
        ...options,correctionStore,cleanupStore,readProtection:()=>store.recycleProtection()}).prepare(correctionId);
      return {cleanupReceipt:cleanupStore.read(correctionId),directoryScope};}
    const store=createAftercareStore(options),correctionStore=createJavIdentityCorrectionStore(options),contextReader={store,read:id=>({shelfEntryId:id,raw:store.currentContext(id)})},
      service=require('../../../src/helix/domains/arca/application/jav-correction-retirement-preparation').createJavCorrectionRetirementPreparation({
        ...options,correctionStore,contextReader,materialControlProjectionPort:createMaterialControlProjectionPort(options)}),
      result=service.prepare(correctionId),port=require('../../../src/helix/integrations/jav-correction-formal-retirement').createJavCorrectionFormalRetirement({validatePlan:value=>contractValidator.validate(value.schemaRef,value)});
    await port.verifyRetired(result,{shouldContinue:()=>true,readCurrentGuardDigest:()=>service.prepare(correctionId).guardDigest});
    const rootSnapshot={...store.aftercareWorkspaceRootSnapshot,resolvedRoot:options.aftercareWorkspaceRoot},workspaceStore=createJavCorrectionWorkspaceStore({...options,rootSnapshot}),
      cleanupStore=require('../../../src/helix/domains/arca/persistence/jav-correction-cleanup-store').createJavCorrectionCleanupStore({...options,correctionStore}),
      cleanupReceipt=cleanupStore.read(correctionId),record=correctionStore.get(correctionId);
    assert.ok(cleanupReceipt);assert.deepEqual(cleanupStore.read(correctionId),cleanupReceipt);
    assert.equal(path.dirname(path.dirname(path.resolve(dataDir))),path.resolve(os.tmpdir()));
    const originalRow=db.prepare('SELECT cleanup_receipt_json,cleanup_receipt_digest FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),
      forged=structuredClone(cleanupReceipt);forged.workspaceReclaimResult.resultDigest='0'.repeat(64);
    const {receiptDigest:discarded,...forgedBody}=forged;forged.receiptDigest=canonicalDigest(forgedBody);
    try{
      db.prepare('UPDATE arca_jav_identity_corrections SET cleanup_receipt_json=?,cleanup_receipt_digest=? WHERE correction_id=?').run(canonicalJson(forged),forged.receiptDigest,correctionId);
      assert.throws(()=>cleanupStore.read(correctionId),{code:'ARCA_JAV_CORRECTION_CLEANUP_INTEGRITY'});
    }finally{db.prepare('UPDATE arca_jav_identity_corrections SET cleanup_receipt_json=?,cleanup_receipt_digest=? WHERE correction_id=?').run(originalRow.cleanup_receipt_json,originalRow.cleanup_receipt_digest,correctionId);}
    const artifact=db.prepare('SELECT artifact_handle_id,storage_ref FROM fx_artifact_registry WHERE owner_scope_type=? AND owner_scope_id=? LIMIT 1').get('jav_identity_correction',correctionId);
    try{
      db.prepare('UPDATE fx_artifact_registry SET storage_ref=? WHERE artifact_handle_id=?').run(artifact.storage_ref+'.foreign',artifact.artifact_handle_id);
      assert.throws(()=>cleanupStore.read(correctionId),{code:'ARCA_JAV_CORRECTION_CLEANUP_INTEGRITY'});
    }finally{db.prepare('UPDATE fx_artifact_registry SET storage_ref=? WHERE artifact_handle_id=?').run(artifact.storage_ref,artifact.artifact_handle_id);}
    assert.deepEqual(cleanupStore.read(correctionId),cleanupReceipt);
    assert.throws(()=>workspaceStore.inspect(correctionId,record.admissionDigest),{code:'ARCA_JAV_CORRECTION_WORKSPACE_FENCED'});
    assert.throws(()=>workspaceStore.inspectCommitted(correctionId,'0'.repeat(64)),{code:'ARCA_JAV_CORRECTION_WORKSPACE_FENCED'});
    assert.throws(()=>workspaceStore.inspectCommitted(correctionId,record.committedContext.contextDigest),{code:'ARCA_JAV_CORRECTION_WORKSPACE_FENCED'});
    const directoryScope=require('../../../src/helix/domains/arca/application/jav-correction-directory-preparation').createJavCorrectionDirectoryPreparation({
      ...options,correctionStore,cleanupStore,readProtection:()=>store.recycleProtection()}).prepare(correctionId);
    const directoryStore=require('../../../src/helix/domains/arca/persistence/jav-correction-directory-store').createJavCorrectionDirectoryStore(options),seed=directoryStore.get(correctionId);
    assert.ok(seed.check_revision>=1);
    assert.equal(seed.cleanup_receipt_digest,cleanupReceipt.receiptDigest);assert.equal(seed.created_at_ms,cleanupReceipt.completedAtMs);
    assert.equal(directoryStore.page(null,1)[0].correction_id,correctionId);
    const checks=directoryScope.directories.map(item=>({sourceLocation:item.sourceLocation,state:'awaiting_confirmation',recycleEntryId:null,errorCode:null})),nextAt=Date.now()+60000;
    assert.throws(()=>directoryStore.record(seed,{scope:directoryScope,checks:[],state:'completed',nextAt}),{code:'ARCA_JAV_DIRECTORY_CHECK_SCOPE_CHANGED'});
    const foreignBody={...directoryScope,committedContextDigest:'0'.repeat(64)};delete foreignBody.scopeDigest;
    assert.throws(()=>directoryStore.record(seed,{scope:{...foreignBody,scopeDigest:canonicalDigest(foreignBody)},checks,state:'attention',nextAt}),{code:'ARCA_JAV_DIRECTORY_CHECK_SCOPE_CHANGED'});
    assert.deepEqual(cleanupStore.read(correctionId),cleanupReceipt);
    return {...result,cleanupReceipt,directoryScope};
  }finally{kernel.close();}
}
module.exports={admitCorrection,inspectFilePlan,inspectCommittedRetirement};
