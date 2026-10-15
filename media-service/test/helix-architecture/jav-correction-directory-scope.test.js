'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionDirectoryScope,SCHEMA}=require('../../src/helix/domains/arca/model/jav-correction-directory-scope');
const {createJavCorrectionDirectoryPreparation}=require('../../src/helix/domains/arca/application/jav-correction-directory-preparation');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../../scripts/helix-architecture/shared-type-schema-builder');
const validator=createCapabilityContractValidator({schemas:[...Object.values(buildArcaApplicationSchemas()),...Object.values(buildSharedTypeSchemas())]});
const sign=(body,field)=>({...body,[field]:canonicalDigest(body)});
function fixture(){
  const root=path.resolve('test-directory-scope'),old=path.join(root,'old'),target=path.join(root,'new'),materials=Array.from({length:4},(_,ordinal)=>({ordinal,role:['primary_payload','metadata_sidecar','poster','fanart'][ordinal],location:path.join(old,['film.mkv','film.nfo','poster.jpg','fanart.jpg'][ordinal])}));
  const record={correctionId:'correction',shelfEntryId:'entry',admissionDigest:canonicalDigest('admission'),state:'committed',cleanupState:'completed',proof:{basis:{basisDigest:canonicalDigest('basis'),materials},placementPreviewDigest:canonicalDigest('placement')}};
  const filePlan=sign({schemaRef:'helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1',correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,scopeDigest:canonicalDigest('scope'),basisDigest:record.proof.basis.basisDigest,placementPreviewDigest:record.proof.placementPreviewDigest,target:{rootLocation:root},members:materials.map(original=>({ordinal:original.ordinal,original,targetLocation:path.join(target,path.basename(original.location))}))},'planDigest');
  record.committedContext=sign({schemaRef:'helix://contracts/application-types/ArcaJavCorrectionCommittedContext/v1',schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,receiptDigest:canonicalDigest('commit'),commitReference:{scopeDigest:filePlan.scopeDigest},filePlan},'contextDigest');
  const ref={workId:'work',eventId:'event',resultSchemaRef:'result',resultDigest:canonicalDigest('result')};
  record.cleanupReceipt=sign({schemaRef:'helix://contracts/application-types/ArcaJavCorrectionCleanupReceipt/v1',schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,committedContextDigest:record.committedContext.contextDigest,identityCommitReceiptDigest:record.committedContext.receiptDigest,formalRetirementResult:ref,workspaceReclaimResult:ref,completedAtMs:100},'receiptDigest');
  return {record,cleanupReceipt:record.cleanupReceipt,protection:{scanRoots:[root],protectedLocations:filePlan.members.map(member=>member.targetLocation)},root,old,target};
}
test('freezes only exact previous binding parents after completed cleanup with deterministic closed provenance',()=>{
  const input=fixture(),before=canonicalDigest(input),value=buildJavCorrectionDirectoryScope(input);
  validator.validate(SCHEMA,value);assert.deepEqual(value.directories,[{sourceLocation:input.old,oldBindingOrdinals:[0,1,2,3],eligibility:'eligible'}]);
  assert.equal(value.cleanupReceiptDigest,input.cleanupReceipt.receiptDigest);assert.equal(canonicalDigest(input),before);
  assert.ok(Object.isFrozen(value.directories[0].oldBindingOrdinals));assert.deepEqual(buildJavCorrectionDirectoryScope(input),value);
  assert.throws(()=>validator.validate(SCHEMA,{...value,unknown:'scope'}));
});
test('retains Field/Shelf roots, ancestors containing configured roots and current or other Entry materials',()=>{
  for(const roots of [[fixture().old],[path.join(fixture().old,'nested-field')]]){const input=fixture();input.protection.scanRoots=roots;assert.equal(buildJavCorrectionDirectoryScope(input).directories[0].eligibility,'retained_root');}
  for(const location of [path.join(fixture().old,'film.mkv'),path.join(fixture().old,'other-entry','video.mkv')]){const input=fixture();input.protection.protectedLocations.push(location);assert.equal(buildJavCorrectionDirectoryScope(input).directories[0].eligibility,'retained_in_use');}
});
test('rejects incomplete protection, missing cleanup, substituted receipt and re-signed expanded original scope',()=>{
  for(const change of [input=>{input.protection.protectedLocations=undefined;},input=>{input.record.cleanupState='active';},input=>{input.cleanupReceipt={...input.cleanupReceipt,correctionId:'other'};},
    input=>{const plan=input.record.committedContext.filePlan;plan.members[0].original={...plan.members[0].original,location:path.join(input.root,'foreign','video.mkv')};input.record.committedContext.filePlan=sign(Object.fromEntries(Object.entries(plan).filter(([key])=>key!=='planDigest')),'planDigest');input.record.committedContext=sign(Object.fromEntries(Object.entries(input.record.committedContext).filter(([key])=>key!=='contextDigest')),'contextDigest');}]){
    const input=fixture();change(input);assert.throws(()=>buildJavCorrectionDirectoryScope(input),{code:'ARCA_JAV_CORRECTION_DIRECTORY_SCOPE_INVALID'});
  }
});
test('preparation consumes the actual Owner cleanup reader before publishing any scope and never observes files',()=>{
  const input=fixture(),calls=[],service=createJavCorrectionDirectoryPreparation({correctionStore:{get:id=>{assert.equal(id,'correction');return input.record;}},cleanupStore:{read:id=>{calls.push(id);return input.cleanupReceipt;}},readProtection:()=>input.protection,contractValidator:validator});
  assert.deepEqual(service.prepare('correction'),buildJavCorrectionDirectoryScope(input));assert.deepEqual(calls,['correction']);
  input.record.cleanupState='attention_required';assert.throws(()=>service.prepare('correction'),{code:'ARCA_JAV_CORRECTION_DIRECTORY_NOT_READY'});assert.deepEqual(calls,['correction']);
});
test('keeps all 32 declared parents and rejects a larger scope or canonical budget instead of truncating it',()=>{
  function expanded(count,long=false){const input=fixture(),record=input.record,context=record.committedContext,plan=context.filePlan;
    record.proof.basis.materials=Array.from({length:count},(_,ordinal)=>({ordinal,role:ordinal?'subtitle':'primary_payload',location:path.join(input.root,'old-'+ordinal+(long?'x'.repeat(3000):''),'video.mkv')}));
    record.proof.basis.basisDigest=canonicalDigest(record.proof.basis.materials);
    const filePlan=sign({...Object.fromEntries(Object.entries(plan).filter(([key])=>key!=='planDigest')),basisDigest:record.proof.basis.basisDigest,members:record.proof.basis.materials.map(original=>({ordinal:original.ordinal,original,targetLocation:path.join(input.target,String(original.ordinal)+'.mkv')}))},'planDigest');
    record.committedContext=sign({...Object.fromEntries(Object.entries(context).filter(([key])=>key!=='contextDigest')),filePlan},'contextDigest');
    record.cleanupReceipt=sign({...Object.fromEntries(Object.entries(record.cleanupReceipt).filter(([key])=>key!=='receiptDigest')),committedContextDigest:record.committedContext.contextDigest},'receiptDigest');
    input.cleanupReceipt=record.cleanupReceipt;return input;
  }
  const scope=buildJavCorrectionDirectoryScope(expanded(32));validator.validate(SCHEMA,scope);assert.equal(scope.directories.length,32);assert.equal(scope.directories.flatMap(item=>item.oldBindingOrdinals).length,32);
  assert.throws(()=>buildJavCorrectionDirectoryScope(expanded(33)),{code:'ARCA_JAV_CORRECTION_DIRECTORY_SCOPE_INVALID'});
  assert.throws(()=>buildJavCorrectionDirectoryScope(expanded(32,true)),{code:'ARCA_JAV_CORRECTION_DIRECTORY_SCOPE_INVALID'});
});
