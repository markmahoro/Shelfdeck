'use strict';
const {canonicalDigest}=require('./canonical-json');
const ORIGIN_SCHEMA='helix://contracts/application-types/LibraAcceptedSubjectOrigin/v1';
const CONTINUITY_SCHEMA='helix://contracts/application-types/ArcaJavPerceptionContinuity/v1';
const DIRECT_POLICY='perception.jav-retained-target@1';
const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
  revision=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}),object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
function acceptedSubjectOriginSchema(){return object({schemaRef:{const:ORIGIN_SCHEMA},schemaVersion:{const:1},onDeckPackageId:text(),packageRevision:revision(),
  packageDigest:digest(),subjectId:text(),libraRunId:text(),shelfId:text(),originDigest:digest()});}
function javPerceptionContinuitySchema(){return object({schemaRef:{const:CONTINUITY_SCHEMA},schemaVersion:{const:1},shelfEntryId:text(),shelfId:text(),canonicalIdentityRevision:revision(),
  canonicalIdentityDigest:digest(),correctionId:text(),committedContextDigest:digest(),identityCommitReceiptDigest:digest(),originalOnDeckCommitDigest:digest(),
  acceptedSubjectOrigin:{$ref:ORIGIN_SCHEMA},continuityDigest:digest()});}
function assertSubjectOrigin(value){const {originDigest,...body}=value||{};
  const expected=Object.keys(acceptedSubjectOriginSchema().properties);
  if(!value||Object.keys(value).sort().join(',')!==expected.sort().join(',')||value.schemaRef!==ORIGIN_SCHEMA||value.schemaVersion!==1||
      !Number.isSafeInteger(value.packageRevision)||value.packageRevision<1||!['onDeckPackageId','subjectId','libraRunId','shelfId'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=256)||
      !/^[a-f0-9]{64}$/.test(value.packageDigest)||originDigest!==canonicalDigest(body))throw Object.assign(new TypeError('Accepted Subject origin digest is invalid.'),{code:'JAV_PERCEPTION_ORIGIN_INVALID'});
  return value;
}
function assertJavPerceptionContinuity(value,target){const {continuityDigest,...body}=value||{};assertSubjectOrigin(value?.acceptedSubjectOrigin);
  const expected=Object.keys(javPerceptionContinuitySchema().properties);
  if(Object.keys(value).sort().join(',')!==expected.sort().join(',')||value.schemaRef!==CONTINUITY_SCHEMA||value.schemaVersion!==1||
      !Number.isSafeInteger(value.canonicalIdentityRevision)||value.canonicalIdentityRevision<1||
      !['shelfEntryId','shelfId','correctionId'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=256)||
      !['canonicalIdentityDigest','committedContextDigest','identityCommitReceiptDigest','originalOnDeckCommitDigest'].every(key=>/^[a-f0-9]{64}$/.test(value[key]))||
      continuityDigest!==canonicalDigest(body)||value.acceptedSubjectOrigin.shelfId!==value.shelfId||
      target&&(target.targetType!=='shelf_entry'||target.targetId!==value.shelfEntryId||target.targetRevision!==value.canonicalIdentityRevision||
        target.canonicalIdentityDigest!==value.canonicalIdentityDigest))throw Object.assign(new TypeError('JAV continuity differs from the current target.'),{code:'JAV_PERCEPTION_CONTINUITY_INVALID'});
  return value;
}
module.exports=Object.freeze({ORIGIN_SCHEMA,CONTINUITY_SCHEMA,DIRECT_POLICY,acceptedSubjectOriginSchema,javPerceptionContinuitySchema,assertSubjectOrigin,assertJavPerceptionContinuity});
