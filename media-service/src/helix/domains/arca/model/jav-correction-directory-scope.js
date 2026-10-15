'use strict';

const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertJavCorrectionCommittedContext}=require('./jav-correction-committed-context');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionDirectoryScope/v1';
const CHECKS_SCHEMA='helix://contracts/application-types/ArcaJavCorrectionDirectoryChecks/v1';
const fail=message=>{throw Object.assign(new TypeError(message),{code:'ARCA_JAV_CORRECTION_DIRECTORY_SCOPE_INVALID'});};
const key=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const compare=(a,b)=>a<b?-1:a>b?1:0;
function signed(value,field){const {[field]:digest,...body}=value||{};return digest===canonicalDigest(body);}
function inside(parent,child){const relative=path.relative(key(parent),key(child));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
function locations(values,name){if(!Array.isArray(values)||values.length>100000||values.some(value=>typeof value!=='string'||!path.isAbsolute(value)))fail(name+' must be a complete bounded absolute-path projection.');return [...new Set(values.map(key))].sort(compare);}
function freeze(value){return value&&typeof value==='object'?Object.freeze(Array.isArray(value)?value.map(freeze):Object.fromEntries(Object.entries(value).map(([name,item])=>[name,freeze(item)]))):value;}

function buildJavCorrectionDirectoryScope({record,cleanupReceipt,protection}){
  if(record?.state!=='committed'||record.cleanupState!=='completed'||!record.cleanupReceipt||
      !cleanupReceipt||cleanupReceipt.schemaRef!=='helix://contracts/application-types/ArcaJavCorrectionCleanupReceipt/v1'||
      !signed(cleanupReceipt,'receiptDigest')||canonicalDigest(cleanupReceipt)!==canonicalDigest(record.cleanupReceipt))
    fail('Directory preparation requires the exact completed cleanup Receipt.');
  const context=assertJavCorrectionCommittedContext(record.committedContext,record),plan=context.filePlan,basis=record.proof.basis;
  if(cleanupReceipt.correctionId!==record.correctionId||cleanupReceipt.shelfEntryId!==record.shelfEntryId||
      cleanupReceipt.committedContextDigest!==context.contextDigest||cleanupReceipt.identityCommitReceiptDigest!==context.receiptDigest||
      !Array.isArray(plan.members)||plan.members.length<4||plan.members.length>1024||basis.materials?.length!==plan.members.length||
      typeof plan.target?.rootLocation!=='string'||!path.isAbsolute(plan.target.rootLocation))
    fail('Directory preparation must conserve the exact committed File Plan and cleanup provenance.');
  const roots=locations(protection?.scanRoots,'Scan roots'),protectedLocations=locations(protection?.protectedLocations,'Protected locations');
  const targetRootLocation=path.resolve(plan.target.rootLocation),groups=new Map();
  for(let ordinal=0;ordinal<plan.members.length;ordinal++){
    const member=plan.members[ordinal],original=basis.materials[ordinal];
    if(member.ordinal!==ordinal||!original||canonicalDigest(member.original)!==canonicalDigest(original)||
        typeof original.location!=='string'||!path.isAbsolute(original.location))
      fail('Only the complete exact previous Inventory bindings may name old directories.');
    const location=path.dirname(path.resolve(original.location)),locationKey=key(location),group=groups.get(locationKey);
    if(group)group.oldBindingOrdinals.push(ordinal);else groups.set(locationKey,{sourceLocation:location,oldBindingOrdinals:[ordinal]});
  }
  if(groups.size>32)fail('Directory scope exceeds the explicit 32-directory budget.');
  const directories=[...groups.values()].sort((a,b)=>compare(key(a.sourceLocation),key(b.sourceLocation))).map(group=>({...group,
    eligibility:key(group.sourceLocation)===key(targetRootLocation)||roots.some(root=>inside(group.sourceLocation,root))?'retained_root':
      protectedLocations.some(location=>inside(group.sourceLocation,location))?'retained_in_use':'eligible'}));
  const body={schemaRef:SCHEMA,schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,
    committedContextDigest:context.contextDigest,cleanupReceiptDigest:cleanupReceipt.receiptDigest,filePlanDigest:plan.planDigest,
    targetRootLocation,protectionDigest:canonicalDigest({scanRoots:roots,protectedLocations}),directories};
  const value={...body,scopeDigest:canonicalDigest(body)};
  if(Buffer.byteLength(canonicalJson(value))>65536)fail('Directory scope exceeds its 64 KiB canonical budget.');
  return freeze(value);
}

function javCorrectionDirectoryScopeSchema(){
  const text=max=>({type:'string',minLength:1,maxLength:max}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
  return object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},correctionId:text(256),shelfEntryId:text(256),
    committedContextDigest:digest(),cleanupReceiptDigest:digest(),filePlanDigest:digest(),targetRootLocation:text(4096),protectionDigest:digest(),
    directories:{type:'array',minItems:1,maxItems:32,items:object({sourceLocation:text(4096),oldBindingOrdinals:{type:'array',minItems:1,maxItems:1024,uniqueItems:true,items:{type:'integer',minimum:0,maximum:1023}},eligibility:{enum:['eligible','retained_root','retained_in_use']}})},scopeDigest:digest()});
}
function javCorrectionDirectoryChecksSchema(){return {type:'array',maxItems:32,items:{type:'object',additionalProperties:false,
  required:['sourceLocation','state','recycleEntryId','errorCode'],properties:{sourceLocation:{type:'string',minLength:1,maxLength:4096},
    state:{enum:['absent','retained_root','retained_in_use','retained_after_restore','awaiting_confirmation','recycle_pending','archived','purged','blocked']},
    recycleEntryId:{anyOf:[{type:'null'},{type:'string',minLength:1,maxLength:256}]},errorCode:{anyOf:[{type:'null'},{type:'string',minLength:1,maxLength:256}]}}}};}
module.exports=Object.freeze({SCHEMA,CHECKS_SCHEMA,buildJavCorrectionDirectoryScope,javCorrectionDirectoryScopeSchema,javCorrectionDirectoryChecksSchema});
