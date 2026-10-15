'use strict';
const {createStagedManifestStore}=require('../persistence/staged-manifest-store');
const {createInventoryVerificationStore}=require('../persistence/inventory-verification-store');
const {createJavCorrectionCastPreparation}=require('./jav-correction-cast-preparation');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buildJavCorrectionInventoryChange,buildJavCorrectionControlChanges}=require('../model/jav-correction-inventory-change');
const {buildJavCorrectionProposal}=require('../model/jav-identity-correction');
const {readJavCorrectionSourceResult}=require('../model/jav-correction-source-result');
const {SOURCE_CAPABILITY,CAPABILITY,STAGE_CAPABILITY,PUBLISH_CAPABILITY,VERIFY_CAPABILITY,javCorrectionAssetsWorkId,
  javCorrectionFilesWorkId,javCorrectionPublishWorkId,javCorrectionVerifyWorkId}=require('../model/jav-correction-execution-contract');
const fail=()=>{throw Object.assign(new Error('Correction Inventory preparation requires exact completed source, stage, publication and final verification Works.'),
  {code:'ARCA_JAV_CORRECTION_INVENTORY_NOT_READY'});};
function createJavCorrectionInventoryPreparation(options) {
  const stagedStore=createStagedManifestStore(options),verificationStore=createInventoryVerificationStore(options),castPreparation=createJavCorrectionCastPreparation(options);
  function result(c,workId,capabilityRef,refs) {
    const work=options.workResultReader.status(workId),rows=options.workResultReader.read(workId).filter(row=>row.capabilityRef===capabilityRef&&row.outcomeKind==='succeeded');
    if(work?.state!=='succeeded'||work.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==c.record.correctionId||rows.length!==1)fail();
    refs.push({workId,eventId:rows[0].eventId,capabilityRef,resultDigest:canonicalDigest(rows[0].result)});return rows[0].result;
  }
  return Object.freeze({prepare(correctionId,committedAtMs) {
    const c=options.correctionContextReader.read(correctionId);if(!c)fail();
    const source=readJavCorrectionSourceResult({...options,...c}),refs=[source.reference],assetsWorkId=javCorrectionAssetsWorkId(c.scope,c.record),plan=options.filePlanPreparation.prepare(correctionId,assetsWorkId),
      verified=source.result,preparedAssets=result(c,assetsWorkId,CAPABILITY,refs),
      stageRecord=result(c,javCorrectionFilesWorkId(c.scope,plan.planDigest,c.record),STAGE_CAPABILITY,refs),manifest=stagedStore.resolve(stageRecord),
      publication=result(c,javCorrectionPublishWorkId(c.scope,plan.planDigest,c.record),PUBLISH_CAPABILITY,refs),
      verificationRecord=result(c,javCorrectionVerifyWorkId(c.scope,plan.planDigest,c.record),VERIFY_CAPABILITY,refs),verification=verificationStore.resolve(verificationRecord),
      proposal=buildJavCorrectionProposal({basis:c.record.proof.basis,...verified.qualification}),
      cast=castPreparation.prepare({correctionId,admissionDigest:c.record.admissionDigest,basis:c.record.proof.basis,proposal}),
      keys=[...new Set([...c.context.raw.materials.map(row=>row.material_key),...manifest.stagedMembers.map(row=>row.physicalIdentity.materialKey)])].sort(),projections=[];
    for(let offset=0;offset<keys.length;offset+=500)projections.push(...options.materialControlProjectionPort.getMaterialControlProjections(keys.slice(offset,offset+500)));
    const oldKeys=new Set(c.context.raw.materials.map(row=>row.material_key)),change=buildJavCorrectionInventoryChange({record:c.record,scope:c.scope,raw:c.context.raw,
      activeCases:options.contextReader.store.history(c.record.shelfEntryId).cases,controlProjections:projections.filter(row=>oldKeys.has(row.materialKey)),
      verified,plan,manifest,publication,verification,cast,committedAtMs}),controlChanges=buildJavCorrectionControlChanges(change,c.record.proof.basis,projections);
    for(const row of change.facts.filter(row=>['resolved_identity','product_metadata','media_cast'].includes(row.fact_kind)))
      options.contractValidator.validate(row.fact_schema_ref,JSON.parse(row.fact_json));
    options.correctionContextReader.assertCurrent(c.record,c.scope);return Object.freeze({change,controlChanges,cast,plan,verification,
      record:c.record,scope:c.scope,verified,preparedAssets,manifest,publication,stageRecord,verificationRecord,predecessors:refs});
  }});
}
module.exports=Object.freeze({createJavCorrectionInventoryPreparation});
