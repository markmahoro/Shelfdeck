'use strict';
const {readCompletedCatalogueBatches}=require('./us-adult-catalogue-work-results');
const {catalogueObservationWork}=require('./us-adult-catalogue-observation-work');
const {catalogueObservationTarget}=require('./us-adult-catalogue-observation-result');
const PREFIX='helix://libra/input-projections/UsAdultCatalogueObservation',
  PROJECTIONS=Object.freeze({basis:PREFIX+'Basis/v1',batches:PREFIX+'Batches/v1',target:PREFIX+'Target/v1'});
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_OBSERVATION_SCOPE_INVALID'});}
function currentObservationScope(options,runId,mode,expectedBasisDigest){
  if(!['initial','initial_and_supplement'].includes(mode))fail('A catalogue Observation requires one of its two frozen modes.');
  const historical=options.usAdultCatalogueStore.getByRun(runId);if(!historical)fail('No frozen catalogue Basis exists for this Run.');
  const basis=options.usAdultCatalogueStore.readForExecution({libraRunId:runId,expectedBasisDigest:expectedBasisDigest??historical.basisDigest}),
    snapshot=options.movieProductionReader.readRunSnapshot(runId),completedBatches=readCompletedCatalogueBatches(options,snapshot,basis,mode),
    work=catalogueObservationWork({snapshot,basis,completedBatches,validator:options.contractValidator});
  return {basis,snapshot,completedBatches,work};
}
function observationTarget(options,{basis,completedBatches}){
  return catalogueObservationTarget({basis,completedBatches,workspace:options.movieProductionReader.readWorkspace(basis.workspaceId),
    rootSnapshot:options.workspaceProductPort.rootSnapshot()});
}
function observationBindings({basis,completedBatches}){
  const parameters={analysisId:basis.analysisId,basisDigest:basis.basisDigest,mode:completedBatches.mode,completedBatchSetDigest:completedBatches.setDigest};
  return Object.entries({usAdultCatalogueAnalysisBasis:PROJECTIONS.basis,usAdultCatalogueCompletedBatchSet:PROJECTIONS.batches,
    workspaceArtifactOutputTarget:PROJECTIONS.target}).map(([portName,projectionRef])=>({portName,bindingKind:'projected_owner_facts',
    ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId,projectionRef,parameters}));
}
module.exports=Object.freeze({PROJECTIONS,currentObservationScope,observationTarget,observationBindings});
