'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createJavCorrectionCommitStore}=require('../persistence/jav-correction-commit-store');
const {createStagedManifestStore}=require('../persistence/staged-manifest-store');
const {SCHEMA,buildJavCorrectionFormalRetirementPlan}=require('../model/jav-correction-formal-retirement');
const {buildRetirementScope}=require('../model/jav-correction-retirement-contract');
const fail=()=>{throw Object.assign(new Error('Retirement preparation requires exact committed correction provenance and current ownership.'),
  {code:'ARCA_JAV_CORRECTION_RETIREMENT_NOT_READY'});};
function createJavCorrectionRetirementPreparation(options){
  const commitStore=createJavCorrectionCommitStore(options),stagedStore=createStagedManifestStore(options);
  function prepare(correctionId){
    const record=options.correctionStore.get(correctionId),committed=commitStore.readCommitted(correctionId);
    if(record?.state!=='committed'||!committed||!record.committedContext||canonicalDigest(record.committedContext)!==canonicalDigest(committed.committedContext))fail();
    const plan=committed.committedContext.filePlan,manifest=stagedStore.resolve(committed.committedContext.stagedRecord),
      context=options.contextReader.read(record.shelfEntryId);
    if(!context||manifest.sourceProductManifestDigest!==plan.planDigest)fail();
    const keys=[...new Set([...record.proof.basis.materials.map(row=>row.physicalIdentity.materialKey),...context.raw.materials.map(row=>row.material_key)])].sort(),controls=[];
    for(let offset=0;offset<keys.length;offset+=500)controls.push(...options.materialControlProjectionPort.getMaterialControlProjections(keys.slice(offset,offset+500)));
    const value=buildJavCorrectionFormalRetirementPlan({record,commit:committed.commit,plan,manifest,raw:context.raw,controlProjections:controls,
      activeCases:options.contextReader.store.history(record.shelfEntryId).cases});
    options.contractValidator.validate(SCHEMA,value);return value;
  }
  return Object.freeze({prepare,readScope(correctionId){const plan=prepare(correctionId),record=options.correctionStore.get(correctionId);return {record,plan,scope:buildRetirementScope(record,plan)};}});
}
module.exports=Object.freeze({createJavCorrectionRetirementPreparation});
