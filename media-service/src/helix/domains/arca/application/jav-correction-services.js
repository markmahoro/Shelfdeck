'use strict';
const {createJavIdentityCorrectionStore}=require('../persistence/jav-identity-correction-store');
const {createJavCorrectionWorkspaceStore}=require('../persistence/jav-correction-workspace-store');
const {createJavCorrectionContextReader}=require('./jav-correction-context-reader');
const {createJavCorrectionProcessCoordinator}=require('./jav-correction-process-coordinator');
const {createJavIdentityCorrectionPreview}=require('./jav-identity-correction-preview');
const {createJavCorrectionFilePlanPreparation}=require('./jav-correction-file-plan-preparation');
const {createJavCorrectionInventoryPreparation}=require('./jav-correction-inventory-preparation');
const {createJavCorrectionAdmin}=require('./jav-correction-admin');
const {createJavCorrectionWorkQuery}=require('./jav-correction-work-query');
const {createJavCorrectionRecoveryPreparation}=require('./jav-correction-recovery-preparation');
const {createJavCorrectionRetirementPreparation}=require('./jav-correction-retirement-preparation');
const {createJavCorrectionWorkspaceReclaimPreparation}=require('./jav-correction-workspace-reclaim-preparation');
const {createJavCorrectionCleanupCompletion}=require('./jav-correction-cleanup-completion');
const {createJavCorrectionDirectoryPreparation}=require('./jav-correction-directory-preparation');
const {createJavCorrectionDirectoryStore}=require('../persistence/jav-correction-directory-store');
function createJavCorrectionServices(options) {
  const contextReader=options.aftercareContextReader;
  contextReader.store.ensureAftercareWorkspaceRoot();
  const rootSnapshot={...contextReader.store.aftercareWorkspaceRootSnapshot,resolvedRoot:options.aftercareWorkspaceRoot},
    correctionStore=createJavIdentityCorrectionStore({...options,rootSnapshot}),workspaceStore=createJavCorrectionWorkspaceStore({...options,rootSnapshot}),
    correctionContextReader=createJavCorrectionContextReader({...options,correctionStore,contextReader,rootSnapshot}),
    filePlanPreparation=createJavCorrectionFilePlanPreparation({...options,correctionContextReader,workspaceStore}),
    preview=createJavIdentityCorrectionPreview({...options,contextReader}),workspaceIo=options.createJavCorrectionWorkspaceIo({rootSnapshot}),
    formalFiles=options.createJavCorrectionFormalFiles({resolveWorkspaceMaterial:workspaceStore.resolve}),
    inventoryPreparation=createJavCorrectionInventoryPreparation({...options,contextReader,correctionContextReader,filePlanPreparation}),
    retirementPreparation=createJavCorrectionRetirementPreparation({...options,contextReader,correctionStore}),
    retirementIo=options.createJavCorrectionFormalRetirement({validatePlan:value=>options.contractValidator.validate(value.schemaRef,value)}),
    workspaceReclaimPreparation=createJavCorrectionWorkspaceReclaimPreparation({...options,rootSnapshot,correctionStore,workspaceStore,retirementPreparation}),
    workspaceReclaimIo=options.createJavCorrectionWorkspaceReclaim({validatePlan:value=>options.contractValidator.validate(value.schemaRef,value)}),
    cleanupCompletion=createJavCorrectionCleanupCompletion({...options,correctionStore,retirementPreparation,workspaceReclaimPreparation,retirementIo,workspaceReclaimIo}),
    directoryStore=createJavCorrectionDirectoryStore(options),
    directoryPreparation=createJavCorrectionDirectoryPreparation({...options,correctionStore,cleanupStore:cleanupCompletion,readProtection:()=>contextReader.store.recycleProtection()}),
    coordinator=createJavCorrectionProcessCoordinator({...options,correctionStore,correctionContextReader,filePlanPreparation,retirementPreparation,workspaceReclaimPreparation,cleanupCompletion}),
    recoveryPreparation=createJavCorrectionRecoveryPreparation({...options,rootSnapshot,correctionStore,workspaceStore,workspaceIo,
      recoveryScene:options.createJavCorrectionRecoveryScene(),contextReader,correctionContextReader,filePlanPreparation,retirementPreparation,workspaceReclaimPreparation}),
    admin=createJavCorrectionAdmin({correction:{preview,correctionStore,recoveryPreparation}}),
    workQuery=createJavCorrectionWorkQuery({...options,contextReader,correctionStore,admin});
  return Object.freeze({rootSnapshot,correctionStore,workspaceStore,workspaceIo,formalFiles,retirementIo,workspaceReclaimIo,workspaceReclaimPreparation,cleanupCompletion,directoryStore,directoryPreparation,correctionContextReader,coordinator,preview,filePlanPreparation,inventoryPreparation,retirementPreparation,recoveryPreparation,admin,workQuery});
}
module.exports=Object.freeze({createJavCorrectionServices});
