'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {createMaterialControlProjectionPort}=require('../../../src/helix/foundation/persistence/material-control');
const {createWorkResultReader}=require('../../../src/helix/foundation/execution/work-result-reader');
const {createAftercareStore}=require('../../../src/helix/domains/arca/persistence/aftercare-store');
const {createJavIdentityCorrectionStore}=require('../../../src/helix/domains/arca/persistence/jav-identity-correction-store');
const {createJavCorrectionWorkspaceStore}=require('../../../src/helix/domains/arca/persistence/jav-correction-workspace-store');
const {createJavCorrectionContextReader}=require('../../../src/helix/domains/arca/application/jav-correction-context-reader');
const {createJavCorrectionFilePlanPreparation}=require('../../../src/helix/domains/arca/application/jav-correction-file-plan-preparation');
const {createJavCorrectionRetirementPreparation}=require('../../../src/helix/domains/arca/application/jav-correction-retirement-preparation');
const {createJavCorrectionWorkspaceReclaimPreparation}=require('../../../src/helix/domains/arca/application/jav-correction-workspace-reclaim-preparation');
const {createJavCorrectionRecoveryPreparation}=require('../../../src/helix/domains/arca/application/jav-correction-recovery-preparation');
const {createJavCorrectionRecoveryScene}=require('../../../src/helix/integrations/jav-correction-recovery-scene');
const {createJavCorrectionWorkspaceIo}=require('../../../src/helix/integrations/jav-correction-workspace-io');
const {buildArcaApplicationSchemas}=require('../../../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../../../scripts/helix-architecture/shared-type-schema-builder');
async function recoverCorrection({dataDir,db,correctionId,prepareOnly=false}){
  const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated'),schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    kernel=openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaManifest,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')}),
    root=db.prepare('SELECT * FROM platform_workspace_roots WHERE root_id=?').get('service-arca-aftercare-workspace'),
    options={schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),aftercareWorkspaceRoot:root.resolved_root,aftercareWorkspaceEndpointId:root.endpoint_id,
      aftercareWorkspaceMountScopeId:root.mount_scope_id,aftercareWorkspaceMountScopeRevision:Number(root.mount_scope_revision),
      contractValidator:createCapabilityContractValidator({schemas:[...Object.values(buildArcaApplicationSchemas()),...Object.values(buildSharedTypeSchemas()),
        require('../../../src/helix/domains/arca/model/jav-correction-execution-contract').javCorrectionSourceVerifiedSchema(),
        require('../../../src/helix/domains/arca/model/jav-correction-execution-contract').javCorrectionAssetsPreparedSchema(),
        require('../../../src/helix/domains/arca/model/jav-correction-commit-contract').javCorrectionCommitReceiptSchema(),
        require('../../../src/helix/domains/arca/model/jav-correction-retirement-contract').retirementReceiptSchema(),
        require('../../../src/helix/contracts/types/StagedInventoryManifestRecord/v1/schema.json'),
        require('../../../src/helix/contracts/types/StagedInventoryManifest/v1/schema.json')]})};
  try{
    const store=createAftercareStore(options);store.ensureAftercareWorkspaceRoot();
    const rootSnapshot={...store.aftercareWorkspaceRootSnapshot,resolvedRoot:root.resolved_root},correctionStore=createJavIdentityCorrectionStore({...options,rootSnapshot}),
      contextReader={store,read:id=>({shelfEntryId:id,raw:store.currentContext(id)})},workspaceStore=createJavCorrectionWorkspaceStore({...options,rootSnapshot}),
      materialControlProjectionPort=createMaterialControlProjectionPort(options),workResultReader=createWorkResultReader(options),
      shared={...options,rootSnapshot,correctionStore,contextReader,workspaceStore,materialControlProjectionPort,workResultReader},
      correctionContextReader=createJavCorrectionContextReader(shared),filePlanPreparation=createJavCorrectionFilePlanPreparation({...shared,correctionContextReader}),
      retirementPreparation=createJavCorrectionRetirementPreparation(shared),workspaceReclaimPreparation=createJavCorrectionWorkspaceReclaimPreparation({...shared,retirementPreparation}),
      preparation=createJavCorrectionRecoveryPreparation({...shared,correctionContextReader,filePlanPreparation,retirementPreparation,workspaceReclaimPreparation,
        workspaceIo:createJavCorrectionWorkspaceIo({rootSnapshot}),recoveryScene:createJavCorrectionRecoveryScene()}),record=correctionStore.get(correctionId),
      observed=await preparation.prepare(record.shelfEntryId,correctionId);
    if(prepareOnly)return observed;
    return correctionStore.admitRecovery({shelfEntryId:record.shelfEntryId,correctionId,actorId:'admin',idempotencyKey:'real-file-scene-'+record.stateRevision+'-'+(record.recoveryIntent?.recoveryId||'initial'),
      expectedStateRevision:record.stateRevision,expectedAdmissionDigest:record.admissionDigest,expectedCleanupState:record.cleanupState,
      expectedRecoveryIntentDigest:record.recoveryIntent?.receiptDigest||null},observed).receipt.resultRef;
  }finally{kernel.close();}
}
module.exports=Object.freeze({recoverCorrection});
