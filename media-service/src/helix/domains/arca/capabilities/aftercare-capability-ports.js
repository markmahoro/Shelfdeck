'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createMaterialControlParticipant, createMaterialControlProjectionPort,
  controlScopeDigest } = require('../../../foundation/persistence/material-control');
const { CAPABILITY_REFS:C,
  deriveInventoryMaterialChanges, settlementScopeDigest,
  aftercareSettlementEventId, aftercareServiceCatalogRevision, aftercareSettlementApprovalId, aftercareInventoryCommitId,
  aftercareInventoryCommitDigest,
  buildAftercareSettlementHandles,
  projectHealth, isAftercareArtifactMaterial } = require('../model/aftercare-contract');
const { buildAftercareInventoryRequest,
  placementMaterialReceipts } = require('../model/aftercare-placement');
const { SCHEMA_REF:EPISODE_CLAIMS_SCHEMA,
  emptyArcaMaterialEpisodeClaims } = require('../model/material-episode-claims');
const { observeKnownOldBindings } = require('../model/known-old-binding');
const {
  inspectAftercareMovieNfo,
  renderAftercareMovieNfo,
} = require('../model/aftercare-nfo');
const {
  deriveAftercareSizeBudget,
  evaluateAftercareConformance,
  verifyOutputContinuity,
} = require('../model/aftercare-media-policy');
const { compileFfmpegPipeline } = require('../../../../clean-ffmpeg-pipeline');

const BASE='helix://contracts/capabilities/';
const AFTERCARE_LONG_MEDIA_TIMEOUT_MS=12*60*60*1000;
const SETTLEMENT_EVIDENCE_MAX_ITEMS=256;
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function requireNamed(context,names){for(const name of names)if(!Object.hasOwn(context?.namedInputs||{},name))throw new TypeError('Arca Aftercare Capability input is absent: '+name);}
function evidence(ref,result,at){return Object.freeze({evidenceId:stable('arca-care-capability-evidence-',{ref,result}),evidenceKind:'arca_aftercare',producerRef:ref,basisDigest:result.careBasisDigest||result.factDigest||canonicalDigest(result),payloadDigest:canonicalDigest(result),observedAtMs:at});}
function outcome(ref,result,at){return Object.freeze({kind:'succeeded',resultSchemaRef:BASE+ref.replace('@1','/v1/result'),result,evidenceSchemaRef:BASE+ref.replace('@1','/v1/evidence'),evidence:evidence(ref,result,at)});}
function effectReceipt(context,effectClass,result,at,verificationEvidenceDigest=canonicalDigest(result)){return Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:stable('arca-care-effect-receipt-',{eventId:context.eventId}),effectId:canonicalDigest([effectClass,context.idempotencyKey]),effectClass,idempotencyKey:context.idempotencyKey,commitMarker:stable('arca-care-effect-marker-',{eventId:context.eventId}),externalReceiptRef:null,outputDigest:canonicalDigest(result),verificationEvidenceDigest,committedAtMs:at});}
function committed(context,ref,result,at,effectClass,verificationEvidenceDigest){return Object.freeze({...outcome(ref,result,at),effectReceipt:effectReceipt(context,effectClass,result,at,verificationEvidenceDigest)});}
function effectOccurredAt(execution, fallback) {return Number.isSafeInteger(execution.effectOccurredAtMs) ? execution.effectOccurredAtMs : fallback;}
function finding(kind,code,severity,repairability,basis){const value={kind,code,severity,repairability,basis};return Object.freeze({
  objectId:stable('arca-finding-',{kind,code,basis}),revision:1,
  schemaRef:'helix://arca/findings/'+kind+'/'+code+'/'+severity+'/'+repairability+'/v1',
  snapshotDigest:canonicalDigest(value),objectKind:'finding-draft'});}
function decodeFinding(ref){const parts=String(ref.schemaRef).split('/');if(parts.length<9)return null;return Object.freeze({
  findingId:ref.objectId,findingKind:parts[4] + ':' + parts[5],severity:parts[6],repairability:parts[7],findingDigest:ref.snapshotDigest});}
function assessment(kind,context,findings,at,state=findings.length?'degraded':'healthy',cycleId='initial',incidentKey=null,extras={}){
  const basis=context.basis,evidenceId=stable('arca-'+kind+'-assessment-',{shelfEntryId:context.shelfEntryId,careBasisDigest:basis.digest,cycleId}),
    scopedFindings=findings.map((item)=>Object.freeze({...item,objectId:stable('arca-finding-',{evidenceId,findingDigest:item.snapshotDigest})})),
    base={schemaRef:'helix://contracts/types/'+kind[0].toUpperCase()+kind.slice(1)+'AssessmentEvidence/v1',schemaVersion:1,
    evidenceId,
    evidenceKind:'arca_aftercare_'+kind,producerRef:C[kind],basisDigest:basis.digest,observedAtMs:at,
    shelfEntryId:context.shelfEntryId,inventoryRevision:basis.inventoryRevision,standardRevision:basis.standardRevision,
    placementRevision:basis.placementRevision,decisionFactSetDigest:basis.decisionFactSetDigest,careBasisDigest:basis.digest,
    assessmentState:state,findingDrafts:Object.freeze(scopedFindings),incidentKey,
    ...(kind==='conformance'?{mediaRepairStrategy:extras.mediaRepairStrategy||null}:{})};
  return Object.freeze({...base,payloadDigest:canonicalDigest(base)});
}
function inside(root,location){const resolvedRoot=path.resolve(root),resolved=path.resolve(location);return resolved===resolvedRoot||resolved.startsWith(resolvedRoot+path.sep);}
function fullSha(location){const hash=crypto.createHash('sha256'),fd=fs.openSync(location,'r'),buffer=Buffer.allocUnsafe(1024*1024);try{let read;do{read=fs.readSync(fd,buffer,0,buffer.length,null);if(read)hash.update(buffer.subarray(0,read));}while(read);}finally{fs.closeSync(fd);}return hash.digest('hex');}
function physicalIdentity(location,mountScopeId,fingerprint){const bounded=fingerprint(location),tuple={mountScopeId,inode:String(bounded.stat.ino),sizeBytes:Number(bounded.stat.size),fingerprintAlgorithm:bounded.fingerprintAlgorithm,fingerprintVersion:bounded.fingerprintVersion,contentFingerprint:bounded.contentFingerprint},materialKey=canonicalDigest({schema:'physical-material-identity@2',...tuple});return Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey,...tuple});}
function atomicCopy(source,target){fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target)){if(fullSha(source)===fullSha(target))return;throw Object.assign(new Error('Aftercare target already exists with different bytes.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});}const temporary=target+'.aftercare-'+process.pid+'.tmp';let temporaryOwned=false;try{if(fs.existsSync(temporary)){if(fullSha(source)!==fullSha(temporary))throw Object.assign(new Error('Aftercare copy staging path contains different bytes.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});temporaryOwned=true;}else {temporaryOwned=true;fs.copyFileSync(source,temporary,fs.constants.COPYFILE_EXCL);}fs.renameSync(temporary,target);}catch(error){if(temporaryOwned&&fs.existsSync(temporary))fs.rmSync(temporary,{force:true});throw error;}}
function sameBoundedMedia(left,right,mountScopeId,fingerprint){if(!fs.existsSync(left)||!fs.existsSync(right))return false;const a=physicalIdentity(left,mountScopeId,fingerprint),b=physicalIdentity(right,mountScopeId,fingerprint);return a.sizeBytes===b.sizeBytes&&a.contentFingerprint===b.contentFingerprint;}
async function atomicCopyMedia(source,target,mountScopeId,fingerprint){await fs.promises.mkdir(path.dirname(target),{recursive:true});if(fs.existsSync(target)){if(sameBoundedMedia(source,target,mountScopeId,fingerprint))return;throw Object.assign(new Error('Aftercare media target already exists with different bounded identity.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});}const temporary=target+'.copying';let temporaryOwned=false;try{if(fs.existsSync(temporary)){if(!sameBoundedMedia(source,temporary,mountScopeId,fingerprint))throw Object.assign(new Error('Aftercare media staging path contains different bounded identity.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});temporaryOwned=true;await fs.promises.rename(temporary,target);}if(!fs.existsSync(target)){temporaryOwned=true;await fs.promises.copyFile(source,temporary,fs.constants.COPYFILE_EXCL);await fs.promises.rename(temporary,target);}}catch(error){if(temporaryOwned&&fs.existsSync(temporary))await fs.promises.rm(temporary,{force:true});throw error;}}
function exactInventoryMaterial(location,material,mountScopeId,fingerprint){
  if(!material||!fs.existsSync(location))return false;
  try{return physicalIdentity(location,mountScopeId,fingerprint).materialKey===material.material_key;}catch{return false;}
}
function exactArtifactBytes(location,source){try{return fs.existsSync(location)&&fullSha(location)===fullSha(source);}catch{return false;}}
function samePhysicalLocation(left,right){const a=path.resolve(left),b=path.resolve(right);return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function assertAftercareSettlementHandle(c,care,handle){
  const base=Object.fromEntries(Object.entries(handle||{}).filter(([key])=>key!=='fenceDigest'));
  if(!handle||handle.ownerDomain!=='arca'||handle.ownerScope?.scopeType!=='aftercare_case'||
      handle.ownerScope?.scopeId!==care.aftercareCaseId||handle.fenceDigest!==canonicalDigest(base)||
      !['exact_aftercare_settlement','exact_known_old_binding_settlement'].includes(handle.readScope)||
      handle.identity?.mountScopeId!==c.raw.shelf.target_mount_scope_id||
      Number(handle.mountScopeRevision)!==Number(c.raw.shelf.target_mount_scope_revision)||
      Number(handle.expectedSizeBytes)!==Number(handle.identity?.sizeBytes)||
      !inside(c.raw.shelf.target_root_location,handle.location))
    throw Object.assign(new Error('Aftercare Settlement Handle is outside its exact Arca authority.'),{code:'ARCA_AFTERCARE_SETTLEMENT_HANDLE_INVALID'});
  if(handle.readScope==='exact_known_old_binding_settlement'){
    const matches=(c.raw.oldBindings||[]).filter((item)=>item.material_key===handle.identity.materialKey&&
      samePhysicalLocation(item.location,handle.location)&&item.endpoint_id===handle.endpointId&&
      Number(item.binding_revision)===Number(handle.bindingRevision)&&item.mount_scope_id===handle.identity.mountScopeId);
    if(matches.length!==1)throw Object.assign(new Error('Aftercare known old Settlement Handle is not an exact Arca Binding.'),{code:'ARCA_AFTERCARE_SETTLEMENT_HANDLE_INVALID'});
  }
  return handle;
}
function resolveAftercareSettlementTarget(contextValue,handle){
  if(handle.readScope!=='exact_known_old_binding_settlement')return Object.freeze({readHandle:handle,finalReplacement:null});
  const matches=contextValue.raw.materials.filter((item)=>item.material_key!==handle.identity.materialKey&&
    Number(item.size_bytes)===handle.identity.sizeBytes&&item.fingerprint_algorithm===handle.identity.fingerprintAlgorithm&&
    Number(item.fingerprint_version)===handle.identity.fingerprintVersion&&item.content_fingerprint===handle.identity.contentFingerprint);
  if(matches.length!==1)throw Object.assign(new Error('Aftercare known old Binding has no unique final replacement.'),{code:'ARCA_AFTERCARE_SETTLEMENT_FINAL_MISMATCH'});
  return Object.freeze({readHandle:handle,finalReplacement:Object.freeze({materialKey:matches[0].material_key,location:matches[0].location})});
}
function assertSettlementTargetReality(c,target,fingerprint,consumedReplay=false){
  const handle=target.readHandle;
  if(fs.existsSync(handle.location)){
    if(consumedReplay)throw Object.assign(new Error('Consumed Aftercare Settlement Approval cannot authorize another deletion.'),{code:'ARCA_AFTERCARE_SETTLEMENT_REPLAY_REALITY_CONFLICT'});
    const observed=physicalIdentity(handle.location,handle.identity.mountScopeId,fingerprint);
    if(observed.materialKey!==handle.identity.materialKey)throw Object.assign(new Error('Aftercare superseded Material changed before deletion.'),{code:'ARCA_AFTERCARE_SETTLEMENT_IDENTITY_CHANGED',details:{location:handle.location,expectedMaterialKey:handle.identity.materialKey,observedMaterialKey:observed.materialKey}});
  }
  if(target.finalReplacement){
    let finalObserved;
    try{finalObserved=physicalIdentity(target.finalReplacement.location,c.raw.shelf.target_mount_scope_id,fingerprint);}catch{}
    if(!finalObserved||finalObserved.materialKey!==target.finalReplacement.materialKey||finalObserved.sizeBytes!==handle.identity.sizeBytes||finalObserved.contentFingerprint!==handle.identity.contentFingerprint)
      throw Object.assign(new Error('Aftercare known old Binding has no exact final replacement.'),{code:'ARCA_AFTERCARE_SETTLEMENT_FINAL_MISMATCH'});
  }
}
function permitsMissingArtifactReplacement(care,artifactKind){
  if(!['nfo','poster'].includes(artifactKind))return false;
  const codes=new Set((care?.careRequirement?.typedParameters||[]).map((item)=>String(item.value)));
  return codes.has('custody:artifact_missing')&&codes.has('presentation:'+artifactKind+'_missing');
}
function rollbackArtifactReplacement({source,location,retiredLocation,oldMaterial,mountScopeId,fingerprint}){
  if(exactArtifactBytes(location,source)&&!exactInventoryMaterial(location,oldMaterial,mountScopeId,fingerprint))fs.rmSync(location,{force:true});
  if(oldMaterial&&fs.existsSync(retiredLocation)&&!fs.existsSync(location)){
    if(!exactInventoryMaterial(retiredLocation,oldMaterial,mountScopeId,fingerprint))throw Object.assign(new Error('Aftercare Artifact rollback old identity changed.'),{code:'ARCA_AFTERCARE_ROLLBACK_IDENTITY_CHANGED'});
    fs.renameSync(retiredLocation,location);
  }
}
function materializeArtifactWithRollback({source,location,retiredLocation,oldMaterial,mountScopeId,fingerprint,revalidate,allowMissingOld=false,copy=atomicCopy,rename=fs.renameSync}){
  const currentIsSource=exactArtifactBytes(location,source),currentIsOld=exactInventoryMaterial(location,oldMaterial,mountScopeId,fingerprint),
    retiredIsOld=exactInventoryMaterial(retiredLocation,oldMaterial,mountScopeId,fingerprint);
  if(fs.existsSync(location)&&!currentIsSource&&!currentIsOld)throw Object.assign(new Error('Aftercare Artifact target changed outside this Case.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(oldMaterial&&fs.existsSync(retiredLocation)&&!retiredIsOld)throw Object.assign(new Error('Aftercare Artifact superseded identity changed.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(allowMissingOld&&oldMaterial&&(currentIsOld||retiredIsOld))throw Object.assign(new Error('Aftercare Artifact target reappeared after the frozen missing finding.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(oldMaterial&&!currentIsOld&&!retiredIsOld&&!allowMissingOld)throw Object.assign(new Error('Aftercare Artifact current-old identity is absent.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(currentIsOld&&fs.existsSync(retiredLocation))throw Object.assign(new Error('Aftercare Artifact has two current-old copies.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  try{
    if(!currentIsSource){
      if(currentIsOld)rename(location,retiredLocation);
      copy(source,location);
    }
    const identity=physicalIdentity(location,mountScopeId,fingerprint);
    revalidate();
    return identity;
  }catch(error){
    try{rollbackArtifactReplacement({source,location,retiredLocation,oldMaterial,mountScopeId,fingerprint});}catch(rollbackError){throw Object.assign(new Error('Aftercare Artifact rollback failed.'),{code:'ARCA_AFTERCARE_ROLLBACK_FAILED',cause:error,rollbackError});}
    throw error;
  }
}
async function rollbackMediaReplacement({source,location,oldLocation=location,supersededLocation,staged,oldMaterial,mountScopeId,fingerprint}){
  if(fs.existsSync(location)&&sameBoundedMedia(location,source,mountScopeId,fingerprint)&&
       !exactInventoryMaterial(location,oldMaterial,mountScopeId,fingerprint))await fs.promises.rm(location,{force:true});
  if(oldMaterial&&fs.existsSync(supersededLocation)&&!fs.existsSync(oldLocation)){
    if(!exactInventoryMaterial(supersededLocation,oldMaterial,mountScopeId,fingerprint))throw Object.assign(new Error('Aftercare Primary rollback old identity changed.'),{code:'ARCA_AFTERCARE_ROLLBACK_IDENTITY_CHANGED'});
    await fs.promises.rename(supersededLocation,oldLocation);
  }
  if(fs.existsSync(staged)&&sameBoundedMedia(staged,source,mountScopeId,fingerprint))await fs.promises.rm(staged,{force:true});
}
async function materializeMediaWithRollback({source,location,oldLocation=location,supersededLocation,staged,oldMaterial,mountScopeId,fingerprint,revalidate,copy=atomicCopyMedia,rename=fs.promises.rename}){
  const currentIsSource=fs.existsSync(location)&&sameBoundedMedia(location,source,mountScopeId,fingerprint),
    currentIsOld=exactInventoryMaterial(oldLocation,oldMaterial,mountScopeId,fingerprint),
    supersededIsOld=exactInventoryMaterial(supersededLocation,oldMaterial,mountScopeId,fingerprint);
  if(fs.existsSync(location)&&!currentIsSource&&!(path.resolve(location)===path.resolve(oldLocation)&&currentIsOld))throw Object.assign(new Error('Aftercare Primary target changed outside this Case.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(path.resolve(location)!==path.resolve(oldLocation)&&fs.existsSync(oldLocation)&&!currentIsOld)throw Object.assign(new Error('Aftercare current Primary changed outside this Case.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(fs.existsSync(supersededLocation)&&!supersededIsOld)throw Object.assign(new Error('Aftercare Primary superseded identity changed.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(oldMaterial&&!currentIsOld&&!supersededIsOld)throw Object.assign(new Error('Aftercare Primary current-old identity is absent.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(currentIsSource&&currentIsOld&&path.resolve(location)!==path.resolve(oldLocation))throw Object.assign(new Error('Aftercare Primary has both current and replacement copies.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(currentIsOld&&fs.existsSync(supersededLocation))throw Object.assign(new Error('Aftercare Primary has two current-old copies.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  if(fs.existsSync(staged)&&!sameBoundedMedia(staged,source,mountScopeId,fingerprint))throw Object.assign(new Error('Aftercare Primary staged identity changed.'),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  try{
    if(!currentIsSource){
      if(!fs.existsSync(staged))await copy(source,staged,mountScopeId,fingerprint);
      revalidate();
      if(currentIsOld)await rename(oldLocation,supersededLocation);
      revalidate();
      await rename(staged,location);
    }
    if(!sameBoundedMedia(location,source,mountScopeId,fingerprint))throw new Error('Aftercare Primary placement verification failed.');
    const identity=physicalIdentity(location,mountScopeId,fingerprint);
    revalidate();
    return identity;
  }catch(error){
    try{await rollbackMediaReplacement({source,location,oldLocation,supersededLocation,staged,oldMaterial,mountScopeId,fingerprint});}catch(rollbackError){throw Object.assign(new Error('Aftercare Primary rollback failed.'),{code:'ARCA_AFTERCARE_ROLLBACK_FAILED',cause:error,rollbackError});}
    throw error;
  }
}
function progressSample(current,total,rate,terminal=false){const bounded=Math.max(0,Math.min(total,current)),ratio=total>0?bounded/total:0;return Object.freeze({mode:'determinate',currentValue:Math.floor(bounded),totalValue:Math.floor(total),unit:'microseconds',rate:Number.isFinite(rate)&&rate>=0?rate:null,etaMs:Number.isFinite(rate)&&rate>0?Math.max(0,Math.ceil((total-bounded)/rate/1000)):null,sourceSequence:null,progressBucket:terminal?'completed':String(Math.min(100,Math.floor(ratio*100))),terminal});}
function remainingDeadlineMs(deadlineAtMs,atMs=Date.now()){return Number.isSafeInteger(deadlineAtMs)?Math.max(1,deadlineAtMs-atMs):AFTERCARE_LONG_MEDIA_TIMEOUT_MS;}
function runFfmpeg(binary,args,rawOptions={}){const options=typeof rawOptions==='number'?{timeoutMs:rawOptions}:rawOptions,timeoutMs=Number.isSafeInteger(options.deadlineAtMs)?remainingDeadlineMs(options.deadlineAtMs):options.timeoutMs||AFTERCARE_LONG_MEDIA_TIMEOUT_MS,durationUs=Math.max(0,Number(options.durationUs||0)),offsetUs=Math.max(0,Number(options.offsetUs||0)),totalUs=Math.max(durationUs,Number(options.totalUs||durationUs));return new Promise((resolve,reject)=>{const child=spawn(binary,['-progress','pipe:1','-nostats',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']}),chunks=[];let bytes=0,retained=0,timedOut=false,cancelled=false,stdout='',lastReportAt=0,lastReportedPercent=-1,lastCurrent=offsetUs,currentRate=null;options.processRegistry?.register(child);const cleanup=()=>{clearTimeout(timer);clearInterval(fence);options.processRegistry?.unregister(child);},stop=(kind)=>{if(kind==='timeout')timedOut=true;else cancelled=true;child.kill('SIGKILL');},timer=setTimeout(()=>stop('timeout'),timeoutMs),fence=setInterval(()=>{try{if(options.shouldContinue&&options.shouldContinue()===false)stop('cancel');}catch{stop('cancel');}},1000);child.stderr.on('data',(chunk)=>{bytes+=chunk.length;chunks.push(Buffer.from(chunk));retained+=chunk.length;while(retained>256*1024&&chunks.length){const first=chunks[0],excess=retained-256*1024;if(first.length<=excess){chunks.shift();retained-=first.length;}else{chunks[0]=first.subarray(excess);retained-=excess;}}});child.stdout.on('data',(chunk)=>{stdout+=chunk.toString('utf8');const lines=stdout.split(/\r?\n/);stdout=lines.pop()||'';for(const line of lines){const [key,value]=line.split('=',2);if(key==='speed'){const parsed=Number(String(value||'').replace(/x$/,''));currentRate=Number.isFinite(parsed)&&parsed>=0?parsed:null;continue;}if(key!=='out_time_us'&&key!=='out_time_ms')continue;const local=Math.max(0,Number(value)||0),current=Math.max(lastCurrent,Math.min(totalUs,offsetUs+local)),nowMs=Date.now(),percent=totalUs>0?Math.floor(current/totalUs*100):0;lastCurrent=current;if(typeof options.reportProgress==='function'&&durationUs>0&&(nowMs-lastReportAt>=5000||percent>lastReportedPercent)){lastReportAt=nowMs;lastReportedPercent=percent;try{options.reportProgress(progressSample(current,totalUs,currentRate));}catch{}}}});child.once('error',(error)=>{cleanup();reject(error);});child.once('close',(code)=>{cleanup();if(timedOut)return reject(Object.assign(new Error('Aftercare FFmpeg timed out.'),{code:'ARCA_AFTERCARE_MEDIA_TIMEOUT'}));if(cancelled)return reject(Object.assign(new Error('Aftercare FFmpeg stopped because its Care Basis or modification authority changed.'),{code:'ARCA_AFTERCARE_EFFECT_FENCED'}));if(code!==0)return reject(Object.assign(new Error('Aftercare FFmpeg failed.'),{code:'ARCA_AFTERCARE_MEDIA_FAILED',details:{code,stderr:Buffer.concat(chunks).toString('utf8').slice(-8192)}}));resolve();});});}
function resolveAftercareFfmpegPath(explicit){
  if(typeof explicit==='string'&&explicit.trim())return explicit.trim();
  if(typeof process.env.FFMPEG_PATH==='string'&&process.env.FFMPEG_PATH.trim())return process.env.FFMPEG_PATH.trim();
  try{const bundled=require('ffmpeg-static');if(typeof bundled==='string'&&bundled)return bundled;}catch{}
  return 'ffmpeg';
}
function xml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
function workspaceRoot(options,store,caseId){store.ensureAftercareWorkspace(caseId);const root=path.resolve(options.aftercareWorkspaceRoot||path.join(os.tmpdir(),'shelfdeck-aftercare-workspaces'));const target=path.join(root,caseId);if(!inside(root,target))throw new Error('Aftercare Workspace escaped its configured root.');fs.mkdirSync(target,{recursive:true});return target;}
function workspaceLocation(store,handle){const snapshot=store.aftercareWorkspaceRootSnapshot;if(handle.rootHandleRef!==snapshot.rootHandleRef||handle.endpointId!==snapshot.endpointId||handle.physicalIdentity?.mountScopeId!==snapshot.mountScopeId)throw new Error('Aftercare Workspace Handle no longer matches its Platform root.');return store.aftercareWorkspaceLocation(handle.workspaceId,handle.relativePath);}
function buildWorkspaceMaterialHandle(contextValue,store,caseId,kind,location,digestAlgorithm,digestHex,fingerprint){const snapshot=store.aftercareWorkspaceRootSnapshot,relative=store.aftercareWorkspaceRelativePath(caseId,location),identity=physicalIdentity(location,snapshot.mountScopeId,fingerprint),base={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:stable('arca-care-workspace-material-',{caseId,kind,digestHex}),workspaceId:caseId,ownerDomain:'arca',processId:contextValue.shelfEntryId,endpointId:snapshot.endpointId,materialKey:identity.materialKey,physicalIdentity:Object.freeze({mountScopeId:identity.mountScopeId,inode:identity.inode,sizeBytes:identity.sizeBytes,fingerprintAlgorithm:identity.fingerprintAlgorithm,fingerprintVersion:identity.fingerprintVersion,contentFingerprint:identity.contentFingerprint}),rootHandleRef:snapshot.rootHandleRef,relativePath:relative,digestAlgorithm,digestHex,sizeBytes:identity.sizeBytes,referenceRevision:1,accessScope:'workspace_material_read'};return Object.freeze({...base,fenceDigest:canonicalDigest(base)});}
function artifactHandle(context,caseId,kind,location,at,mediaType=null,provenanceDigest=context.basis.digest){const digestHex=fullSha(location),stat=fs.statSync(location),base={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:stable('arca-care-artifact-',{caseId,kind,digestHex}),artifactKind:kind,ownerDomain:'arca',ownerScope:Object.freeze({scopeType:'aftercare_case',scopeId:caseId}),storageRef:location.replace(/\\/g,'/'),digestAlgorithm:'sha256',digestHex,sizeBytes:Number(stat.size),mediaType:mediaType||(kind==='nfo'?'application/xml':'image/jpeg'),provenanceRef:Object.freeze({objectType:'aftercare_case',objectId:caseId,revision:1,digest:provenanceDigest}),referenceRevision:1};return Object.freeze(base);}
function isPrimaryMaterial(item){return String(item.role||'').toLowerCase().includes('primary');}
function isNfoMaterial(item){return isAftercareArtifactMaterial(item,'nfo');}
function isPosterMaterial(item){return isAftercareArtifactMaterial(item,'poster');}
function custodyIdentityChangedFinding(item){const nfo=isNfoMaterial(item);return finding('custody',isPrimaryMaterial(item)?'primary_identity_changed':nfo?'nfo_identity_changed':'material_identity_changed','critical',nfo?'auto_repair':'attention_required',item.material_key);}
function nfoSourceGuard(contextValue,current,fingerprint){const sourceMaterialIdentity=current&&fs.existsSync(current.location)?physicalIdentity(current.location,current.mount_scope_id,fingerprint):null;return Object.freeze({sourceMaterialIdentity,digest:canonicalDigest({schema:'arca.aftercare-nfo-source-guard@1',careBasisDigest:contextValue.basis.digest,sourceMaterialIdentity})});}
function inventoryRowForIdentity(template,identity){return Object.freeze({...template,material_key:identity.materialKey,mount_scope_id:identity.mountScopeId,inode:identity.inode,size_bytes:identity.sizeBytes,fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:identity.fingerprintVersion,content_fingerprint:identity.contentFingerprint});}
function nfoCommitSource(contextValue,output,location,inventoryMaterial,mountScopeId,fingerprint){const currentIdentity=fs.existsSync(location)?physicalIdentity(location,mountScopeId,fingerprint):null,expectedGuard=canonicalDigest({schema:'arca.aftercare-nfo-source-guard@1',careBasisDigest:contextValue.basis.digest,sourceMaterialIdentity:currentIdentity});if(output.provenanceRef?.digest!==expectedGuard)throw Object.assign(new Error('Aftercare NFO source changed after preparation.'),{code:'ARCA_AFTERCARE_NFO_SOURCE_STALE'});const exactInventory=inventoryMaterial&&exactInventoryMaterial(location,inventoryMaterial,mountScopeId,fingerprint);return Object.freeze({material:currentIdentity&&!exactInventory?inventoryRowForIdentity(inventoryMaterial||{},currentIdentity):inventoryMaterial,supersededMaterialIdentity:currentIdentity&&!exactInventory?currentIdentity:null});}
function existingMaterials(items,predicate){return [...items].filter(predicate).filter((item)=>{try{return fs.statSync(item.location).isFile();}catch{return false;}}).sort((left,right)=>Number(left.ordinal||0)-Number(right.ordinal||0)||String(left.location).localeCompare(String(right.location)));}
function selectedNfoMaterial(items){const existing=existingMaterials(items,isNfoMaterial);return existing.find((item)=>validNfo(item.location))||existing[0]||null;}
function isRepairablePresentationArtifact(item){const role=String(item.role||'').toLowerCase(),extension=path.extname(item.location||'').toLowerCase();return role.includes('poster')||role.includes('fanart')||role.includes('nfo')||role==='metadata_sidecar'||extension==='.nfo';}
function custodyBlocksDependentAssessment(custody){return custody?.assessmentState==='not_assessable'||custody?.findingDrafts?.some((item)=>/\/(primary_|binding_)/.test(item.schemaRef));}
function boundedBytes(location,maxBytes=16*1024*1024){const stat=fs.statSync(location);if(!stat.isFile()||stat.size>maxBytes)return null;return fs.readFileSync(location);}
function validNfo(location){try{const bytes=boundedBytes(location,256*1024);return Boolean(bytes&&inspectAftercareMovieNfo(bytes).usable);}catch{return false;}}
async function inspectImageBytes(bytes){try{if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>16*1024*1024)return null;const image=sharp(bytes,{failOn:'error',limitInputPixels:100_000_000,sequentialRead:true}),metadata=await image.metadata();if(!['jpeg','png','webp'].includes(metadata.format)||Number(metadata.width)<=0||Number(metadata.height)<=0)return null;await sharp(bytes,{failOn:'error',limitInputPixels:100_000_000,sequentialRead:true}).stats();return Object.freeze({format:metadata.format,width:Number(metadata.width),height:Number(metadata.height),mediaType:'image/'+metadata.format});}catch{return null;}}
async function validImageBytes(bytes){return Boolean(await inspectImageBytes(bytes));}
async function validImage(location){try{const bytes=boundedBytes(location);return Boolean(bytes&&await validImageBytes(bytes));}catch{return false;}}
function representationMember(item, ordinal) {
  return Object.freeze({
    ordinal,
    materialKey: item.material_key,
    role: item.role,
    episodeClaims: JSON.parse(item.episode_claims_json),
    endpointId: item.endpoint_id,
    location: item.location,
    bindingRevision: Number(item.binding_revision),
    physicalIdentity: Object.freeze({
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
      schemaVersion: 2,
      materialKey: item.material_key,
      mountScopeId: item.mount_scope_id,
      inode: item.inode,
      sizeBytes: Number(item.size_bytes),
      fingerprintAlgorithm: item.fingerprint_algorithm,
      fingerprintVersion: Number(item.fingerprint_version),
      contentFingerprint: item.content_fingerprint,
    }),
    digestHex: item.digest_hex,
    sizeBytes: Number(item.size_bytes),
  });
}
function acceptedRating(context){if(Number.isInteger(context.raw.perceptionRating?.rating))return context.raw.perceptionRating.rating;for(const fact of context.raw.facts){if(fact.fact_kind!=='decision_fact')continue;const value=fact.value||{};
  for(const key of ['rating','normalizedRating','ratingValue','stars'])if(Number.isInteger(value[key])&&value[key]>=1&&value[key]<=5)return value[key];}return null;}
function effectiveRequirements(context){const profiles=context.raw.standard.value?.profileRuleSets||[],profile=profiles.find((item)=>item.contentProfile===(context.raw.entry.structure_kind==='season'?'series':'movie'))||profiles[0];if(!profile)return null;const rating=acceptedRating(context);if(rating===null)return profile.baseRequirements;const branch=(profile.decisionBranches||[]).find((item)=>item.predicate?.rating===rating||item.rating===rating||item.decisionValue===rating);return branch?.requirements||branch?.resultRequirements||profile.baseRequirements;}
function primaryReadHandle(context,item){return Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
  handleId:stable('arca-aftercare-primary-handle-',{shelfEntryId:context.shelfEntryId,materialKey:item.material_key,revision:Number(item.binding_revision||1)}),
  identity:Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:item.material_key}),
  endpointId:item.endpoint_id,location:item.location,accessMode:'read_only',bindingRevision:Number(item.binding_revision||1),
  handleDigest:canonicalDigest({materialKey:item.material_key,endpointId:item.endpoint_id,location:item.location,bindingRevision:Number(item.binding_revision||1)})});}
function aftercareMediaProbeEvidence(raw,handle,sizeBytes,observedAtMs){
  const base={schemaRef:'helix://contracts/types/MediaProbeEvidence/v1',schemaVersion:1,
    evidenceId:stable('arca-care-media-probe-',{handle,raw}),evidenceKind:'media_probe',producerRef:'shared.material.media.probe@1',
    basisDigest:canonicalDigest(handle),payloadDigest:'',observedAtMs:Number(observedAtMs),sourceHandleDigest:canonicalDigest(handle),
    resultKind:raw.resultKind,...(raw.resultKind==='not_media'?{reasonCode:'probe_not_media'}:{container:raw.container||'unknown',durationMs:Number(raw.durationMs||0)}),
    sizeBytes:Number(sizeBytes),videoStreams:Object.freeze((raw.videoStreams||[]).map((stream)=>{
      const codedWidth=Math.max(1,Number(stream.codedWidth||stream.width||1)),codedHeight=Math.max(1,Number(stream.codedHeight||stream.height||1)),
        rotation=Number(stream.rotation||0),rotated=Math.abs(rotation)%180===90,
        displayWidth=Math.max(1,Number(stream.displayWidth||(rotated?codedHeight:codedWidth))),displayHeight=Math.max(1,Number(stream.displayHeight||(rotated?codedWidth:codedHeight)));
      return Object.freeze({streamIndex:Number(stream.streamIndex),dispositionDefault:Boolean(stream.dispositionDefault),codec:stream.codec||'unknown',
        codecProfile:stream.codecProfile||stream.profile||'unknown',pixelFormat:stream.pixelFormat||'unknown',bitDepth:Math.max(1,Number(stream.bitDepth||8)),
        chroma:stream.chroma||'unknown',colorRange:stream.colorRange||'unknown',colorPrimaries:stream.colorPrimaries||'unknown',
        colorTransfer:stream.colorTransfer||'unknown',colorMatrix:stream.colorMatrix||'unknown',dynamicRangeKind:stream.dynamicRangeKind||'unknown',
        ...(stream.dolbyVision?{dolbyVision:stream.dolbyVision}:{}),codedWidth,codedHeight,sampleAspectRatio:stream.sampleAspectRatio||'1:1',
        rotation,displayWidth,displayHeight,longEdge:Math.max(displayWidth,displayHeight),shortEdge:Math.min(displayWidth,displayHeight)});
    })),audioStreams:Object.freeze((raw.audioStreams||[]).map((stream)=>Object.freeze({streamIndex:Number(stream.streamIndex),
      dispositionDefault:Boolean(stream.dispositionDefault),codec:stream.codec||'unknown',profile:stream.profile||'unknown',
      channels:Math.max(1,Number(stream.channels||1)),channelLayout:stream.channelLayout||'unknown',
      formatTags:Object.freeze((stream.formatTags||[]).map(String).filter(Boolean)),normalizedAudioClass:stream.normalizedAudioClass||'other',
      ...(Number.isSafeInteger(stream.bitRateBps)&&stream.bitRateBps>0?{bitRateBps:stream.bitRateBps}:{}),
      ...(stream.language?{language:stream.language}:{})}))),subtitleStreams:Object.freeze((raw.subtitleStreams||[]).map((stream)=>Object.freeze({
      streamIndex:Number(stream.streamIndex),codec:stream.codec||'unknown',...(stream.language?{language:stream.language}:{})}))),
    ...(raw.discTopology?{discTopology:raw.discTopology}:{})};
  base.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(base).filter(([key])=>key!=='payloadDigest')));
  return Object.freeze(base);
}
function probeConformance(context,probe){const requirements=effectiveRequirements(context),mandatory=requirements?.mandatoryMedia||{},space=requirements?.space||{},primary=context.raw.materials.find(isPrimaryMaterial),findings=[];
  if(!primary)return [finding('conformance','primary_missing','critical','attention_required',context.shelfEntryId)];
  const result=evaluateAftercareConformance({mandatoryMedia:mandatory,space,probe,location:primary.location,sizeBytes:Number(primary.size_bytes)}),
    autoRepair=new Set(['video_codec_unmet','file_extension_unmet','container_unmet','max_size_exceeded']);
  for(const code of result.reasonCodes)findings.push(finding('conformance',code,'critical',autoRepair.has(code)?'auto_repair':'attention_required',primary.material_key));
  return findings;}

const AFTERCARE_DEVICE_ORDER=Object.freeze(['nvidia_nvenc','intel_qsv','amd_vaapi','remote_worker','software_cpu']);
function readyDeviceSnapshots(runtime){
  if(!runtime||typeof runtime.listReadyDeviceRefs!=='function'||typeof runtime.readDeviceSnapshot!=='function')return Object.freeze([]);
  const listQuery={queryContract:'platform.compute-ready-device-refs@1',limit:64};listQuery.queryDigest=canonicalDigest(listQuery);
  const listed=runtime.listReadyDeviceRefs(listQuery);if(listed?.resultKind!=='available')return Object.freeze([]);
  const order=new Map(AFTERCARE_DEVICE_ORDER.map((kind,index)=>[kind,index]));
  return Object.freeze(listed.items.map((ref)=>{const query={deviceId:ref.deviceId,expectedProbeRevision:ref.probeRevision,
    expectedCapabilityDigest:ref.capabilityDigest};query.queryDigest=canonicalDigest(query);const read=runtime.readDeviceSnapshot(query);
    return read?.resultKind==='found'?read.snapshot:null;}).filter(Boolean).sort((a,b)=>(order.get(a.deviceClass)??999)-
      (order.get(b.deviceClass)??999)||Buffer.from(a.deviceId).compare(Buffer.from(b.deviceId))));
}
function repairVideoProfile(probe){const primary=(probe.videoStreams||[]).filter((item)=>item.dispositionDefault===true),
  streams=primary.length?primary:(probe.videoStreams||[]).slice(0,1),stream=streams[0]||{},dolby=stream.dynamicRangeKind==='dolby_vision';
  if(dolby&&(!stream.dolbyVision?.blPresent||stream.dolbyVision?.baseLayerKind!=='pq_bt2020_compatible'))return null;
  return Object.freeze({dynamicRangeOperation:dolby?'tone_map_to_sdr_bt709':'preserve',
    pipelineProfileId:dolby?'pq_bt2020_base_to_sdr_bt709_hevc@1':'ordinary_to_hevc@1',
    outputDynamicRangeKind:dolby?'sdr':(stream.dynamicRangeKind||'unknown'),outputPixelFormat:dolby?'yuv420p':(stream.pixelFormat||'encoder_selected'),
    outputColorProfile:dolby?Object.freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}):
      Object.freeze({range:'source',primaries:'source',transfer:'source',matrix:'source'})});
}
function buildProductionVideoProfile(video){
  if(!video)return null;
  const profile=Object.freeze({dynamicRangeOperation:video.dynamicRangeOperation,
    pipelineProfileId:video.pipelineProfileId,outputDynamicRangeKind:video.outputDynamicRangeKind,
    outputPixelFormat:video.outputPixelFormat,outputColorProfile:video.outputColorProfile});
  return Object.freeze({...profile,profileDigest:canonicalDigest(profile)});
}
function aftercareBitrate(requirements,probe,sourceSizeBytes){const maximum=requirements?.space?.maxSizeBytes;if(!Number.isSafeInteger(maximum)||maximum<=0)return null;
  try{return deriveAftercareSizeBudget({maxSizeBytes:maximum,sourceSizeBytes:Number(sourceSizeBytes),durationMs:Number(probe.durationMs),audioStreams:probe.audioStreams,subtitleStreams:probe.subtitleStreams}).targetVideoBitrateBps;}catch{return null;}
}
function strategyIntent(context,probe,device,mode,ordinal,profile){const requirements=effectiveRequirements(context),primary=context.raw.materials.find(isPrimaryMaterial),target=aftercareBitrate(requirements,probe,primary?.size_bytes),
  video=Object.freeze({codec:'hevc',rateControlMode:mode,targetVideoBitrateBps:mode==='quality_bound'?null:target,
    qualityBound:mode==='quality_bound'?23:null,...profile}),base={schemaRef:'AftercareMediaRepairIntent@1',schemaVersion:1,
    intentId:stable('arca-care-media-intent-',{entry:context.shelfEntryId,basis:context.basis.digest,device:device.deviceId,mode,ordinal}),
    revision:1,careBasisDigest:context.basis.digest,sourceHandleDigest:canonicalDigest(primaryReadHandle(context,context.raw.materials.find(isPrimaryMaterial))),
    strategyOrdinal:ordinal,deviceClass:device.deviceClass,video,audio:Object.freeze({mode:'copy'}),subtitle:Object.freeze({mode:'copy'}),
    outputContainer:'matroska',outputExtension:'mkv'};return Object.freeze({...base,intentDigest:canonicalDigest(base)});}
function structuralStrategyRejection(probe,device,intent){const pipeline=(device.capabilityPayload?.validatedVideoPipelines||[]).find((item)=>
  item.pipelineProfileId===intent.video.pipelineProfileId),stream=(probe.videoStreams||[]).find((item)=>item.dispositionDefault===true)||probe.videoStreams?.[0],reasons=[];
  if(!pipeline)reasons.push('required_pipeline_profile_unavailable');
  if(!(device.capabilityPayload?.supportedVideoCodecs||[]).includes('hevc'))reasons.push('output_profile_unsupported');
  if(!(device.capabilityPayload?.supportedRateControlModes||[]).includes(intent.video.rateControlMode))reasons.push('rate_control_unsupported');
  if(pipeline&&stream&&!pipeline.inputDynamicRangeKinds.includes(stream.dynamicRangeKind))reasons.push('source_dynamic_range_unsupported');
  if(pipeline&&stream&&!pipeline.inputPixelFormats.includes(stream.pixelFormat))reasons.push('source_pixel_format_unsupported');
  return Object.freeze(reasons);
}
async function assessMediaRepairStrategy(options,context,probe,sourceProbeEvidence){const profile=repairVideoProfile(probe);if(!profile||typeof options.mediaEffectPort?.verifyTranscodeInput!=='function')return null;
  const requirements=effectiveRequirements(context),hasLimit=Number.isSafeInteger(requirements?.space?.maxSizeBytes),devices=readyDeviceSnapshots(options.platformComputeRuntime),
    ordinary=devices.filter((item)=>item.deviceClass!=='software_cpu'),cpu=devices.filter((item)=>item.deviceClass==='software_cpu'),rejected=[];
  let ordinal=0;for(const device of [...ordinary,...cpu]){if(device.deviceClass==='remote_worker')continue;const modes=device.deviceClass==='software_cpu'
      ?(hasLimit?['two_pass_abr','strict_abr']:['quality_bound']):(hasLimit?['target_size','strict_abr']:['quality_bound']);
    for(const mode of modes){ordinal+=1;const intent=strategyIntent(context,probe,device,mode,ordinal,profile);
      if(mode!=='quality_bound'&&!intent.video.targetVideoBitrateBps){rejected.push(Object.freeze({deviceId:device.deviceId,deviceClass:device.deviceClass,
        deviceSnapshotDigest:device.snapshotDigest,disposition:'strategy_rejected',rejectionScope:'rate_control_strategy',
        reasonCodes:Object.freeze(['media_size_budget_infeasible']),preflightDigest:canonicalDigest({intent:intent.intentDigest,reason:'media_size_budget_infeasible'})}));continue;}
      const structural=structuralStrategyRejection(probe,device,intent);let preflight=null;if(!structural.length){preflight=await options.mediaEffectPort.verifyTranscodeInput({sourceHandle:primaryReadHandle(context,context.raw.materials.find(isPrimaryMaterial)),
          sourceProbeEvidence,productionIntent:intent,deviceSnapshot:device});}
      const reasons=structural.length?structural:(preflight?.reasonCode?[preflight.reasonCode]:[]);if(reasons.length){rejected.push(Object.freeze({deviceId:device.deviceId,
        deviceClass:device.deviceClass,deviceSnapshotDigest:device.snapshotDigest,disposition:'strategy_rejected',
        rejectionScope:reasons.includes('rate_control_unsupported')?'rate_control_strategy':'device_pipeline',reasonCodes:Object.freeze(reasons),
        preflightDigest:preflight?.preflightDigest||canonicalDigest({intent:intent.intentDigest,reasons})}));continue;}
      const base={schemaRef:'helix://contracts/domain-types/AftercareMediaRepairStrategy/v1',schemaVersion:1,
        strategyId:stable('arca-care-media-strategy-',{basis:context.basis.digest,intent:intent.intentDigest,device:device.snapshotDigest}),revision:1,
        careBasisDigest:context.basis.digest,sourceHandleDigest:intent.sourceHandleDigest,
        sourceProbeEvidenceId:sourceProbeEvidence.evidenceId,sourceProbeEvidenceDigest:canonicalDigest(sourceProbeEvidence),
        sourceVideoProfileDigest:canonicalDigest(repairVideoProfile(probe)),
        selectedDeviceSnapshot:device,selectedDeviceSnapshotDigest:device.snapshotDigest,
        selectedDeviceClass:device.deviceClass,video:intent.video,priorStrategyAssessments:Object.freeze(rejected),
        selectedPreflightDigest:preflight.preflightDigest};const strategyDigest=canonicalDigest(base);return Object.freeze({...base,strategyDigest,digest:strategyDigest});}
  }return null;}
async function verifyPlaybackBounded(options,store,workspaceMediaHandle,probe,run=runFfmpeg){const handle=workspaceMediaHandle.workspaceMaterialHandle,location=workspaceLocation(store,handle),duration=Math.max(1,Number(probe.durationMs||1))/1000,points=[5,50,95],passed=[];for(const point of points){try{await run(resolveAftercareFfmpegPath(options.ffmpegPath),['-hide_banner','-nostdin','-loglevel','error','-ss',(duration*point/100).toFixed(3),'-i',location,'-map','0:v:0','-frames:v','1','-f','null',process.platform==='win32'?'NUL':'/dev/null'],30_000);passed.push(point);}catch{}}return Object.freeze({samplePointsPercent:Object.freeze(points),passedSamplePointsPercent:Object.freeze(passed),decodeDigest:canonicalDigest({schema:'arca.aftercare-playback-decode@1',handleDigest:canonicalDigest(handle),points,passed})});}

function createAftercareCapabilityPorts(options){const now=options.now||Date.now,contextReader=options.contextReader,store=contextReader.store,controls=createMaterialControlProjectionPort(options),fingerprint=options.computeBoundedMaterialFingerprintSync;
  if(typeof fingerprint!=='function')throw new TypeError('Arca Aftercare requires the bounded Physical Material fingerprint port.');
  function context(execution){const value=contextReader.read(execution.ownerScope.processId);if(!value)throw new Error('Arca Aftercare Shelf Entry is unavailable.');return value;}
  function activeCase(c){const value=store.history(c.shelfEntryId).cases.find((item)=>item.state==='active');if(!value)throw new Error('Arca Aftercare active Case is unavailable.');if(value.careBasisDigest!==c.basis.digest)throw Object.assign(new Error('Arca Aftercare Case Basis is stale.'),{code:'ARCA_AFTERCARE_CASE_BASIS_STALE'});if(c.raw.shelf.status!=='active'||c.raw.reservations.some((item)=>item.state==='active'))throw Object.assign(new Error('Arca Aftercare modification authority is fenced.'),{code:'ARCA_AFTERCARE_MODIFICATION_FENCED'});return value;}
  function revalidateCaseAuthority(execution,expectedCase){const current=context(execution),care=activeCase(current);if(expectedCase&&(care.aftercareCaseId!==expectedCase.aftercareCaseId||care.careBasisDigest!==expectedCase.careBasisDigest))throw Object.assign(new Error('Arca Aftercare Case authority changed during an external effect.'),{code:'ARCA_AFTERCARE_EFFECT_FENCED'});return Object.freeze({context:current,care});}
  function postInventoryCaseAuthority(current,care,inventoryRevision){const frozen=care?.careBasis;if(!current||!care||care.state!=='active'||current.raw.shelf.status!=='active'||current.raw.reservations.some((item)=>item.state==='active')||Number(current.basis.inventoryRevision)!==Number(inventoryRevision)||Number(inventoryRevision)!==Number(frozen.inventoryRevision)+1||current.basis.standardRevision!==frozen.standardRevision||current.basis.placementRevision!==frozen.placementRevision||current.basis.canonicalIdentityDigest!==frozen.canonicalIdentityDigest||current.basis.sourcePackageId!==frozen.sourcePackageId||current.basis.acceptedProductFactSetDigest!==frozen.acceptedProductFactSetDigest||current.basis.decisionFactSetDigest!==frozen.decisionFactSetDigest)throw Object.assign(new Error('Arca Aftercare post-Inventory Case authority is stale.'),{code:'ARCA_AFTERCARE_INVENTORY_BASIS_STALE'});return current;}
  function settlementAuthority(shelfEntryId,caseId,approvalId,scope,allowConsumed=false){const current=contextReader.read(shelfEntryId),care=current&&store.history(shelfEntryId).cases.find((item)=>item.aftercareCaseId===caseId&&item.state==='active'),frozen=care?.careBasis,approval=care&&store.getSettlementApproval(caseId,scope);
    if(!current||!care||current.raw.shelf.status!=='active'||current.raw.reservations.some((item)=>item.state==='active')||
        !approval||approval.approvalId!==approvalId||!(approval.state==='active'||(allowConsumed&&approval.state==='consumed'))||
        Number(current.basis.inventoryRevision)!==Number(frozen.inventoryRevision)+1||current.basis.standardRevision!==frozen.standardRevision||
        current.basis.placementRevision!==frozen.placementRevision||current.basis.canonicalIdentityDigest!==frozen.canonicalIdentityDigest||
        current.basis.sourcePackageId!==frozen.sourcePackageId||current.basis.acceptedProductFactSetDigest!==frozen.acceptedProductFactSetDigest||
        current.basis.decisionFactSetDigest!==frozen.decisionFactSetDigest)throw Object.assign(new Error('Aftercare Settlement authority is stale.'),{code:'ARCA_AFTERCARE_SETTLEMENT_BASIS_STALE'});
    return Object.freeze({current,care,approval});}
  function resultFor(execution,capabilityRef){return options.workResultReader.read(execution.workId).find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===capabilityRef)?.result||null;}
  function providerHandle(c){const provenance=c.raw.facts.map((item)=>item.value?.provenance||item.value?.sourceProvenance||{}).find((item)=>item.integrationId&&item.configRevision),intent={providerKind:c.raw.identity.provider,integrationId:provenance?.integrationId,configRevision:Number(provenance?.configRevision)};return options.resolveAftercareIntegrationHandle?.({operationId:C.binaryAcquire,artifactKind:'poster',intent})||null;}
  function preparationWorkId(execution){for(const binding of options.workResultReader.readBindings(execution.workId).flatMap((item)=>item.inputBindings?.bindings||[])){const source=binding.parameters?.sourceWorkId||(binding.parameters?.dependencyRefs||[]).find((item)=>item.objectType==='repair_prepare_work')?.objectId;if(source)return source;}return null;}
  function validateAtomicInventoryOutcome(value){const validator=options.contractValidator;if(!validator||typeof validator.validate!=='function')throw new TypeError('Aftercare atomic Inventory commit requires the frozen Capability contract validator.');validator.validate('helix://contracts/types/CapabilityOutcome/v1',value);validator.validate(value.resultSchemaRef,value.result);validator.validate(value.evidenceSchemaRef,value.evidence);validator.validate('helix://contracts/types/EffectReceipt/v1',value.effectReceipt);if(!value.result?.newInventoryRevision)throw new TypeError('Aftercare Inventory Commit Receipt is invalid.');return value;}
  function pure(ref,names,build){return Object.freeze({validateInputs(c){requireNamed(c,names);},execute(c){return outcome(ref,build(c.namedInputs,context(c),now(),c),now());},validateResult(_c,o){if(!o?.result)throw new TypeError(ref+' Result is absent.');}});}
  const ports={};
  ports[C.custody]=pure(C.custody,['careBasis','inventoryRevision','knownBindings'],(_n,c,at,execution)=>{
    const findings=[];let endpointUnavailable=false;
    for(const item of c.raw.materials){const location=item.location;
      try{const stat=fs.statSync(location,{bigint:true});if(!stat.isFile()){findings.push(finding('custody',isPrimaryMaterial(item)?'primary_not_regular':'artifact_not_regular','critical',!isPrimaryMaterial(item)&&isRepairablePresentationArtifact(item)?'auto_repair':'attention_required',item.material_key));continue;}
        const observed=fingerprint(location),identityChanged=
          String(observed.stat.ino)!==String(item.inode)||Number(observed.stat.size)!==Number(item.size_bytes)||
          observed.fingerprintAlgorithm!==item.fingerprint_algorithm||Number(observed.fingerprintVersion)!==Number(item.fingerprint_version)||
          observed.contentFingerprint!==item.content_fingerprint;
        if(identityChanged){findings.push(custodyIdentityChangedFinding(item));continue;}
      }catch(error){const causeCode=error?.details?.causeCode||error?.code;if(['ENOENT'].includes(causeCode)){findings.push(finding('custody',isPrimaryMaterial(item)?'primary_missing':'artifact_missing','critical',!isPrimaryMaterial(item)&&isRepairablePresentationArtifact(item)?'auto_repair':'attention_required',item.material_key));}
        else if(['EACCES','EPERM','ENOTCONN','EHOSTDOWN','ENODEV','EIO'].includes(causeCode)){endpointUnavailable=true;break;}
        else findings.push(finding('custody',isPrimaryMaterial(item)?'primary_unreadable':'artifact_unreadable','critical',!isPrimaryMaterial(item)&&isRepairablePresentationArtifact(item)?'auto_repair':'attention_required',item.material_key));}
    }
    if(endpointUnavailable){const incidentKey='endpoint:'+canonicalDigest({endpointId:c.raw.shelf.target_endpoint_id,incidentKind:'unavailable'});return assessment('custody',c,[finding('custody','endpoint_unavailable','warning','observe',incidentKey)],at,'not_assessable',execution.workId,incidentKey);}
    return assessment('custody',c,findings,at,undefined,execution.workId);
  });
  ports[C.presentation]=Object.freeze({validateInputs(c){requireNamed(c,['careBasis','inventoryMetadataArtifactRefs','standard']);},async execute(execution){const c=context(execution),at=now(),custody=resultFor(execution,C.custody);
    if(custodyBlocksDependentAssessment(custody))return outcome(C.presentation,assessment('presentation',c,[],at,'not_assessable',execution.workId,custody.incidentKey),at);
    const nfoRows=c.raw.materials.filter(isNfoMaterial),posterRows=c.raw.materials.filter(isPosterMaterial),nfos=existingMaterials(c.raw.materials,isNfoMaterial),posters=existingMaterials(c.raw.materials,isPosterMaterial),findings=[];
    if(nfos.length===0)findings.push(finding('presentation','nfo_missing','warning','auto_repair',c.shelfEntryId));
    else if(!nfos.some((item)=>validNfo(item.location)))findings.push(finding('presentation','nfo_corrupt','warning','auto_repair',c.shelfEntryId));
    else {const current=nfos.find((item)=>validNfo(item.location)),metadata=c.raw.facts.find((item)=>item.fact_kind==='product_metadata')?.value,cast=c.raw.facts.find((item)=>item.fact_kind==='media_cast')?.value;try{const existingBytes=boundedBytes(current.location,256*1024),rendered=renderAftercareMovieNfo({existingBytes,metadata,cast,identity:{provider:c.raw.identity.provider,providerKey:c.raw.identity.provider_key}});if(!existingBytes.equals(rendered.bytes))findings.push(finding('presentation','nfo_update_required','warning','auto_repair',c.shelfEntryId));}catch{findings.push(finding('presentation','nfo_content_unverifiable','warning','attention_required',c.shelfEntryId));}}
    let hasValidPoster=false;for(const poster of posters){if(await validImage(poster.location)){hasValidPoster=true;break;}}
    if(posters.length===0)findings.push(finding('presentation','poster_missing','warning',
      c.raw.identity.provider&&c.raw.identity.provider_key&&providerHandle(c)?'auto_repair':'attention_required',c.shelfEntryId));
    else if(!hasValidPoster)findings.push(finding('presentation','poster_corrupt','warning',
      c.raw.identity.provider&&c.raw.identity.provider_key&&providerHandle(c)?'auto_repair':'attention_required',c.shelfEntryId));
    return outcome(C.presentation,assessment('presentation',c,findings,at,undefined,execution.workId),at);},validateResult(_c,o){if(!o?.result)throw new TypeError('Presentation Assessment Result is absent.');}});
  ports[C.conformance]=Object.freeze({validateInputs(c){requireNamed(c,['careBasis','inventoryRevision','knownBindings','standard','placement']);},async execute(execution){const c=context(execution),at=now(),custody=resultFor(execution,C.custody);
    if(custodyBlocksDependentAssessment(custody))return outcome(C.conformance,assessment('conformance',c,[],at,'not_assessable',execution.workId,custody.incidentKey),at);
    const primary=c.raw.materials.find(isPrimaryMaterial);if(!primary)return outcome(C.conformance,assessment('conformance',c,[finding('conformance','primary_missing','critical','attention_required',c.shelfEntryId)],at,undefined,execution.workId),at);
    const readHandle=primaryReadHandle(c,primary),probe=await options.mediaProbe.probe(readHandle),sourceProbeEvidence=aftercareMediaProbeEvidence(probe,readHandle,primary.size_bytes,now());let findings=probeConformance(c,probe);const needsTranscode=findings.some((item)=>
      /\/(video_codec_unmet|max_size_exceeded)\//.test(item.schemaRef)),mediaRepairStrategy=needsTranscode&&probe.resultKind==='probed'
        ?await assessMediaRepairStrategy(options,c,probe,sourceProbeEvidence):null;
    if(needsTranscode&&!mediaRepairStrategy)findings=[...findings.filter((item)=>!/\/(video_codec_unmet|max_size_exceeded)\//.test(item.schemaRef)),
      finding('conformance','media_strategy_unavailable','critical','attention_required',canonicalDigest({basis:c.basis.digest,probeDigest:canonicalDigest(probe)}))];
    const initial=c.raw.initialPlacementDecision,initialStillCurrent=initial&&Number(initial.placement_revision)===Number(c.basis.placementRevision)&&initial.target_endpoint_id===c.raw.shelf.target_endpoint_id&&c.raw.materials.every((item)=>path.resolve(path.dirname(item.location))===path.resolve(initial.target_location)),placementRequest=initialStillCurrent?null:buildAftercareInventoryRequest(c,options.inventoryPort,at,stable('arca-care-assessment-placement-',{entry:c.shelfEntryId,basis:c.basis.digest})),desired=placementRequest?options.inventoryPort.resolveTargetLocation(placementRequest):null,placementUnmet=Boolean(desired)&&c.raw.materials.some((item)=>item.endpoint_id!==c.raw.shelf.target_endpoint_id||path.resolve(path.dirname(item.location))!==path.resolve(desired.targetDirectory));
    if(placementUnmet)findings.push(finding('conformance','placement_unmet','critical','auto_repair',canonicalDigest({endpointId:c.raw.shelf.target_endpoint_id,targetDirectory:desired.targetDirectory,placementRevision:c.basis.placementRevision})));
    for(const observed of observeKnownOldBindings(c.raw,fingerprint)){
      if(observed.kind==='absent')continue;
      const basis=canonicalDigest({materialKey:observed.binding.material_key,location:observed.binding.location,evidenceDigest:observed.binding.evidence_digest,kind:observed.kind});
      if(observed.kind==='duplicate_of_final')findings.push(finding('conformance','settlement_gap','critical',placementUnmet?'auto_repair':'attention_required',basis));
      else findings.push(finding('conformance','old_binding_'+observed.kind,'critical','attention_required',basis));
    }
    return outcome(C.conformance,assessment('conformance',c,findings,at,undefined,execution.workId,null,{mediaRepairStrategy}),at);},validateResult(_c,o){if(!o?.result)throw new TypeError('Conformance Assessment Result is absent.');}});
  ports[C.textRender]=Object.freeze({validateInputs(c){requireNamed(c,['acceptedProductFacts','artifactProfile']);},execute(execution){const c=context(execution),care=activeCase(c),at=now(),root=workspaceRoot(options,store,care.aftercareCaseId),location=path.join(root,'artifacts','movie.nfo'),metadata=c.raw.facts.find((item)=>item.fact_kind==='product_metadata')?.value,cast=c.raw.facts.find((item)=>item.fact_kind==='media_cast')?.value,current=selectedNfoMaterial(c.raw.materials),guard=nfoSourceGuard(c,current,fingerprint),existingBytes=current&&fs.existsSync(current.location)?boundedBytes(current.location,256*1024):null,rendered=renderAftercareMovieNfo({existingBytes,metadata,cast,identity:{provider:c.raw.identity.provider,providerKey:c.raw.identity.provider_key}}),bytes=rendered.bytes;
    fs.mkdirSync(path.dirname(location),{recursive:true});if(fs.existsSync(location)){if(!fs.readFileSync(location).equals(bytes))throw new Error('Aftercare NFO Workspace replay conflicts with existing bytes.');}else fs.writeFileSync(location,bytes,{flag:'wx'});const result=artifactHandle(c,care.aftercareCaseId,'nfo',location,at,null,guard.digest),member=buildWorkspaceMaterialHandle(c,store,care.aftercareCaseId,'nfo',location,'sha256',result.digestHex,fingerprint);store.registerAftercareWorkspaceMaterial(member,result);return committed(execution,C.textRender,result,at,'workspace_write');},validateResult(_c,o){if(o?.result?.artifactKind!=='nfo')throw new TypeError('Aftercare rendered NFO Artifact is invalid.');}});
  ports[C.binaryAcquire]=Object.freeze({
    validateInputs(c){requireNamed(c,['stableProviderIdentity','integrationHandle']);},
    async execute(execution){
      const c=context(execution),care=activeCase(c),at=now(),n=execution.namedInputs,basis=canonicalDigest(n),
        resolvedProviderIdentity=Object.freeze({provider:n.stableProviderIdentity.providerId,
          providerKey:n.stableProviderIdentity.providerObjectId,
          namespace:n.stableProviderIdentity.providerId==='tmdb'?'tmdb_movie':n.stableProviderIdentity.providerId,
          seasonNumber:null,identityAnchorDigest:n.stableProviderIdentity.identityDigest});
      if(n.integrationHandle.allowedOperation!==C.binaryAcquire||
          n.stableProviderIdentity.providerId!==c.raw.identity.provider||
          String(n.stableProviderIdentity.providerObjectId)!==String(c.raw.identity.provider_key)||
          n.stableProviderIdentity.identityDigest!==c.raw.identity.identity_digest)
        return Object.freeze({kind:'failed',failureClass:'executor',code:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE',message:'Aftercare Provider input does not match the current Case identity and operation.',retryDirective:'contract_policy',evidence:Object.freeze({errorName:'AftercareProviderInputError',errorCode:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE'})});
      if(typeof options.fetchAftercareArtifact!=='function')
        throw Object.assign(new Error('Aftercare Provider Artifact adapter is unavailable.'),{code:'ARCA_AFTERCARE_PROVIDER_UNAVAILABLE'});
      const response=await options.fetchAftercareArtifact({operationId:C.binaryAcquire,artifactKind:'poster',
          integrationHandle:n.integrationHandle,resolvedProviderIdentity}),
        evidenceValue={evidenceId:stable('arca-care-poster-evidence-',{care:care.aftercareCaseId,basis}),
          evidenceKind:'aftercare_provider_artifact',producerRef:C.binaryAcquire,basisDigest:basis,
          payloadDigest:canonicalDigest({resultKind:response?.resultKind||'not_available',basis}),observedAtMs:at};
      revalidateCaseAuthority(execution,care);
      if(response?.resultKind!=='acquired'){
        const result=Object.freeze({schemaRef:'helix://contracts/types/ArtifactAcquisitionResult/v1',schemaVersion:1,
          resultKind:'not_available',artifactHandle:null,reasonCode:response?.reasonCode||'provider_not_available',
          evidence:Object.freeze(evidenceValue)});
        return Object.freeze({...outcome(C.binaryAcquire,result,at),effectReceipt:effectReceipt(execution,'workspace_write',result,at)});
      }
      if(response.artifactKind!=='poster'||response.integrationId!==n.integrationHandle.integrationId||
          response.configRevision!==n.integrationHandle.configRevision||
          canonicalDigest(response.resolvedProviderIdentity)!==canonicalDigest(resolvedProviderIdentity))
        throw Object.assign(new Error('Aftercare Provider response does not match the frozen Artifact Handle.'),{code:'ARCA_AFTERCARE_PROVIDER_RESPONSE_STALE'});
      if(!Buffer.isBuffer(response.bytes))
        throw Object.assign(new Error('Aftercare Provider Artifact bytes are absent.'),{code:'ARCA_AFTERCARE_ARTIFACT_VERIFICATION_FAILED'});
      const image=await inspectImageBytes(response.bytes);
      revalidateCaseAuthority(execution,care);
      if(!image)throw Object.assign(new Error('Aftercare Provider Artifact cannot be decoded as a supported image.'),{code:'ARCA_AFTERCARE_ARTIFACT_VERIFICATION_FAILED'});
      const extension=image.format==='jpeg'?'jpg':image.format,root=workspaceRoot(options,store,care.aftercareCaseId),
        location=path.join(root,'artifacts','poster.'+extension);
      fs.mkdirSync(path.dirname(location),{recursive:true});
      if(fs.existsSync(location)){if(!fs.readFileSync(location).equals(response.bytes))throw new Error('Aftercare Poster Workspace replay conflicts with existing bytes.');}
      else fs.writeFileSync(location,response.bytes,{flag:'wx'});
      const handle=artifactHandle(c,care.aftercareCaseId,'poster',location,at,image.mediaType),
        member=buildWorkspaceMaterialHandle(c,store,care.aftercareCaseId,'poster',location,'sha256',handle.digestHex,fingerprint),
        verifiedEvidence=Object.freeze({...evidenceValue,evidenceKind:'aftercare_artifact_verification',
          payloadDigest:canonicalDigest({schema:'arca.aftercare-artifact-verification@1',basis,artifactKind:'poster',
            digestHex:handle.digestHex,sizeBytes:handle.sizeBytes,mediaType:handle.mediaType,width:image.width,
            height:image.height,result:'passed'})});
      store.registerAftercareWorkspaceMaterial(member,handle);
      const result=Object.freeze({schemaRef:'helix://contracts/types/ArtifactAcquisitionResult/v1',schemaVersion:1,
        resultKind:'acquired',artifactHandle:handle,reasonCode:null,evidence:verifiedEvidence});
      return Object.freeze({...outcome(C.binaryAcquire,result,at),effectReceipt:effectReceipt(execution,'workspace_write',result,at)});
    },
    validateResult(_c,o){if(!['acquired','not_available'].includes(o?.result?.resultKind))throw new TypeError('Aftercare Artifact acquisition Result is invalid.');},
  });
  ports[C.artifactMaterialize]=Object.freeze({validateInputs(c){requireNamed(c,['verifiedArtifactOrWorkspaceMediaHandle','inventoryTargetHandle']);},async execute(execution){const c=context(execution),care=activeCase(c),at=now(),n=execution.namedInputs,output=n.verifiedArtifactOrWorkspaceMediaHandle,target=n.inventoryTargetHandle;if(!inside(c.raw.shelf.target_root_location,target.targetDirectory)||!inside(target.targetDirectory,target.slotDirectory))throw new Error('Aftercare output target escapes the Shelf Target.');const primary=c.raw.materials.find(isPrimaryMaterial),isMedia=Boolean(output.workspaceMediaHandleId),source=isMedia?workspaceLocation(store,output.workspaceMaterialHandle):output.storageRef;let location,supersededLocation=null,kind,identity;
    if(!isMedia){store.resolveAftercareArtifact(output);if(output.ownerScope?.scopeId!==care.aftercareCaseId)throw Object.assign(new Error('Aftercare Artifact belongs to another Case.'),{code:'ARCA_AFTERCARE_ARTIFACT_HANDLE_STALE'});const artifactBytes=boundedBytes(source,output.artifactKind==='nfo'?256*1024:16*1024*1024),verified=artifactBytes&&artifactBytes.length===Number(output.sizeBytes)&&fullSha(source)===output.digestHex&&(output.artifactKind==='nfo'?inspectAftercareMovieNfo(artifactBytes).usable:Boolean(await validImageBytes(artifactBytes)));if(!verified)throw Object.assign(new Error('Aftercare Artifact failed exact verification before Material commit.'),{code:'ARCA_AFTERCARE_ARTIFACT_VERIFICATION_FAILED'});revalidateCaseAuthority(execution,care);}
    let supersededMaterialIdentity=null;if(isMedia){if(!primary)throw new Error('Aftercare media replacement has no current Primary.');const oldLocation=primary.location,sourceExtension=path.extname(source)||path.extname(oldLocation);location=path.join(path.dirname(oldLocation),path.parse(oldLocation).name+sourceExtension);kind='primary_payload';supersededLocation=oldLocation+'.superseded-'+care.aftercareCaseId;const staged=location+'.staged-'+care.aftercareCaseId,mountScopeId=c.raw.shelf.target_mount_scope_id;if(fs.existsSync(supersededLocation))supersededMaterialIdentity=physicalIdentity(supersededLocation,mountScopeId,fingerprint);else if(fs.existsSync(oldLocation)&&!sameBoundedMedia(oldLocation,source,mountScopeId,fingerprint))supersededMaterialIdentity=physicalIdentity(oldLocation,mountScopeId,fingerprint);identity=await materializeMediaWithRollback({source,location,oldLocation,supersededLocation,staged,oldMaterial:primary,mountScopeId,fingerprint,revalidate:()=>revalidateCaseAuthority(execution,care)});}
    else {kind=output.artifactKind;const posterExtension=output.mediaType==='image/png'?'.png':output.mediaType==='image/webp'?'.webp':'.jpg',name=kind==='nfo'?(path.parse(primary?.location||'movie.mkv').name+'.nfo'):('poster'+posterExtension);location=path.join(target.slotDirectory,name);const retiredLocation=location+'.superseded-'+care.aftercareCaseId,inventoryMaterial=c.raw.materials.find((item)=>(kind==='nfo'?isNfoMaterial(item):isPosterMaterial(item))&&path.resolve(item.location)===path.resolve(location)),sourceGuard=kind==='nfo'?nfoCommitSource(c,output,location,inventoryMaterial,c.raw.shelf.target_mount_scope_id,fingerprint):Object.freeze({material:inventoryMaterial,supersededMaterialIdentity:null});if(sourceGuard.supersededMaterialIdentity){supersededMaterialIdentity=sourceGuard.supersededMaterialIdentity;supersededLocation=retiredLocation;}identity=materializeArtifactWithRollback({source,location,retiredLocation,oldMaterial:sourceGuard.material,mountScopeId:c.raw.shelf.target_mount_scope_id,fingerprint,revalidate:()=>revalidateCaseAuthority(execution,care),allowMissingOld:permitsMissingArtifactReplacement(care,kind)});}
    const canonicalLocation=location.replace(/\\/g,'/'),retiredMaterials=(isMedia?[]:c.raw.materials.filter((item)=>kind==='nfo'?isNfoMaterial(item):isPosterMaterial(item)).map((item)=>{const deterministic=item.location+'.superseded-'+care.aftercareCaseId,hasSuperseded=path.resolve(item.location)===path.resolve(location)&&fs.existsSync(deterministic),retiredLocation=hasSuperseded?deterministic:item.location,requiresSettlement=!supersededMaterialIdentity&&(hasSuperseded||(fs.existsSync(retiredLocation)&&path.resolve(retiredLocation)!==path.resolve(location)));return Object.freeze({identity:Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:item.material_key,mountScopeId:item.mount_scope_id,inode:item.inode,sizeBytes:Number(item.size_bytes),fingerprintAlgorithm:item.fingerprint_algorithm,fingerprintVersion:Number(item.fingerprint_version),contentFingerprint:item.content_fingerprint}),location:retiredLocation.replace(/\\/g,'/'),requiresSettlement});})).sort((a,b)=>a.identity.materialKey.localeCompare(b.identity.materialKey)),targetBindingDigest=canonicalDigest({endpointId:c.raw.shelf.target_endpoint_id,location:canonicalLocation,identity}),base={schemaRef:'helix://contracts/types/MaterialEffectReceipt/v1',schemaVersion:1,receiptId:stable('arca-care-materialized-',{caseId:care.aftercareCaseId,kind,targetBindingDigest}),receiptKind:'aftercare_output_materialized',ownerDomain:'arca',scopeType:'aftercare_case',scopeId:care.aftercareCaseId,scopeDigest:care.careRequirementDigest,effectReceiptRef:stable('arca-care-effect-receipt-',{eventId:execution.eventId}),committedAtMs:at,targetBindingDigest,materialEffectKind:isMedia?'primary_replace':'artifact_materialize',effectReceiptId:stable('arca-care-effect-receipt-',{eventId:execution.eventId}),finalRealityDigest:canonicalDigest({identity,location:canonicalLocation}),finalMaterialIdentity:identity,targetEndpointId:c.raw.shelf.target_endpoint_id,targetLocation:canonicalLocation,retiredMaterials:Object.freeze(retiredMaterials),...(supersededLocation&&supersededMaterialIdentity?{supersededLocation:supersededLocation.replace(/\\/g,'/'),supersededMaterialIdentity}:{})};const result=Object.freeze(base);return committed(execution,C.artifactMaterialize,result,at,'material_commit');},validateResult(_c,o){if(o?.result?.receiptKind!=='aftercare_output_materialized')throw new TypeError('Aftercare Material effect Receipt is invalid.');}});
  async function mediaEffect(execution,kind){const c=context(execution),care=activeCase(c),at=now(),n=execution.namedInputs,primary=c.raw.materials.find(isPrimaryMaterial);if(!primary)throw new Error('Aftercare current Primary Binding is absent.');const source=primary.location;fingerprint(source);const strategy=kind==='transcode'?n.aftercareMediaRepairStrategy:null,sourceProbe=await options.mediaProbe.probe(primaryReadHandle(c,primary)),durationUs=Math.max(0,Math.floor(Number(sourceProbe?.durationMs||0)*1000)),shouldContinue=()=>{const current=contextReader.read(c.shelfEntryId),active=current&&store.history(c.shelfEntryId).cases.find((item)=>item.state==='active');return Boolean(current&&active?.aftercareCaseId===care.aftercareCaseId&&active.careBasisDigest===current.basis.digest&&current.raw.shelf.status==='active'&&!current.raw.reservations.some((item)=>item.state==='active'));},progress=(offsetUs,totalUs)=>Object.freeze({durationUs,offsetUs,totalUs,deadlineAtMs:execution.deadlineAtMs,reportProgress:execution.reportProgress,shouldContinue,processRegistry:options.ffmpegProcessRegistry});
    revalidateCaseAuthority(execution,care);
    if(strategy){const unsigned=Object.fromEntries(Object.entries(strategy).filter(([key])=>!['strategyDigest','digest'].includes(key)));if(strategy.careBasisDigest!==care.careBasisDigest||strategy.digest!==strategy.strategyDigest||strategy.strategyDigest!==canonicalDigest(unsigned)||strategy.sourceHandleDigest!==canonicalDigest(primaryReadHandle(c,primary))||!strategy.sourceProbeEvidenceId||!strategy.sourceProbeEvidenceDigest||!strategy.sourceVideoProfileDigest||strategy.selectedDeviceSnapshotDigest!==strategy.selectedDeviceSnapshot.snapshotDigest)throw new Error('Aftercare media repair Strategy fence is invalid.');}
    const root=workspaceRoot(options,store,care.aftercareCaseId),relative='media/'+kind+(strategy?'-'+strategy.strategyId.slice(-16):'')+'.mkv',target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)){const temporary=target+'.tmp',binary=resolveAftercareFfmpegPath(options.ffmpegPath);if(kind==='remux'){await runFfmpeg(binary,['-hide_banner','-nostdin','-y','-fflags','+genpts','-i',source,'-map','0','-c','copy','-f','matroska',temporary],progress(0,durationUs));revalidateCaseAuthority(execution,care);}else {
        const video=strategy.video,pipeline=compileFfmpegPipeline({deviceClass:strategy.selectedDeviceClass,video}),
          normalizeDolbyVision=video.dynamicRangeOperation==='tone_map_to_sdr_bt709',normalizedVideoTarget=temporary+'.normalized-video.ts';
        const muxNormalizedVideo=async()=>{await runFfmpeg(binary,['-hide_banner','-nostdin','-y','-i',normalizedVideoTarget,'-i',source,
          '-map','0:v:0','-map','1:a?','-map','1:s?','-c:v','copy','-c:a','copy','-c:s','copy','-map_metadata','-1','-f','matroska',temporary],progress(0,durationUs));revalidateCaseAuthority(execution,care);};
        if(video.rateControlMode==='two_pass_abr'){
          const passlog=temporary+'.passlog',nullTarget=process.platform==='win32'?'NUL':'/dev/null';
          try{
            await runFfmpeg(binary,['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,'-map','0:v:0',...pipeline.videoArgs,
              '-pass','1','-passlogfile',passlog,'-an','-sn','-f','null',nullTarget],progress(0,durationUs*2));
            revalidateCaseAuthority(execution,care);
            const pass2Target=normalizeDolbyVision?normalizedVideoTarget:temporary,pass2Format=normalizeDolbyVision?'mpegts':'matroska';
            await runFfmpeg(binary,['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,'-map','0:v:0',
              ...(normalizeDolbyVision?[]:['-map','0:a?','-map','0:s?']),...pipeline.videoArgs,'-pass','2','-passlogfile',passlog,
              ...(normalizeDolbyVision?['-an','-sn']:['-c:a','copy','-c:s','copy']),'-f',pass2Format,pass2Target],progress(durationUs,durationUs*2));
            revalidateCaseAuthority(execution,care);
            if(normalizeDolbyVision)await muxNormalizedVideo();
          }finally{
            for(const suffix of ['', '.log', '.log.mbtree', '-0.log', '-0.log.mbtree']){const item=passlog+suffix;if(fs.existsSync(item))fs.rmSync(item,{force:true});}
            if(fs.existsSync(normalizedVideoTarget))fs.rmSync(normalizedVideoTarget,{force:true});
          }
        }else if(normalizeDolbyVision){
          try{
            await runFfmpeg(binary,['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,'-map','0:v:0',...pipeline.videoArgs,
              '-an','-sn','-f','mpegts',normalizedVideoTarget],progress(0,durationUs));
            revalidateCaseAuthority(execution,care);
            await muxNormalizedVideo();
          }finally{if(fs.existsSync(normalizedVideoTarget))fs.rmSync(normalizedVideoTarget,{force:true});}
        }else{
          await runFfmpeg(binary,['-hide_banner','-nostdin','-y',...pipeline.inputArgs,'-i',source,'-map','0:v:0','-map','0:a?','-map','0:s?',
            ...pipeline.videoArgs,'-c:a','copy','-c:s','copy','-f','matroska',temporary],progress(0,durationUs));
          revalidateCaseAuthority(execution,care);
        }
      }fs.renameSync(temporary,target);}
    revalidateCaseAuthority(execution,care);
    if(typeof execution.reportProgress==='function'&&durationUs>0){try{execution.reportProgress(progressSample(kind==='transcode'&&strategy?.video?.rateControlMode==='two_pass_abr'?durationUs*2:durationUs,kind==='transcode'&&strategy?.video?.rateControlMode==='two_pass_abr'?durationUs*2:durationUs,null,true));}catch{}}
    const bounded=physicalIdentity(target,store.aftercareWorkspaceRootSnapshot.mountScopeId,fingerprint),digestHex=bounded.contentFingerprint,workspaceMaterialHandle=buildWorkspaceMaterialHandle(c,store,care.aftercareCaseId,kind,target,'middle-256k-sha256',digestHex,fingerprint);store.registerAftercareWorkspaceMaterial(workspaceMaterialHandle);const effectId=canonicalDigest(['workspace_write',execution.idempotencyKey]),effectReceiptId=stable('arca-care-effect-receipt-',{eventId:execution.eventId}),intentDigest=strategy?.strategyDigest||canonicalDigest({kind,requirement:n.careRequirement.digest}),productionVideoProfile=buildProductionVideoProfile(strategy?.video),base={schemaRef:'helix://contracts/types/WorkspaceMediaHandle/v1',schemaVersion:1,workspaceMediaHandleId:stable('arca-care-workspace-media-',{caseId:care.aftercareCaseId,kind,digestHex}),sourceMaterialHandleDigest:canonicalDigest(n.knownBindings),workspaceMaterialHandle,workspaceMaterialHandleDigest:canonicalDigest(workspaceMaterialHandle),outputTargetId:stable('arca-care-output-',{caseId:care.aftercareCaseId,kind}),outputTargetDigest:canonicalDigest({target,kind,strategyDigest:strategy?.strategyDigest||null}),producingEventId:execution.eventId,productionIntentKind:kind==='transcode'?'encode':'remux',productionIntentDigest:intentDigest,executionDeviceRef:strategy?Object.freeze({deviceId:strategy.selectedDeviceSnapshot.deviceId,deviceClass:strategy.selectedDeviceClass,deviceSnapshotDigest:strategy.selectedDeviceSnapshotDigest}):null,productionVideoProfile,effectReceiptRef:Object.freeze({effectId,effectReceiptId,effectReceiptDigest:canonicalDigest({effectId,effectReceiptId})})};const result=Object.freeze({...base,resultDigest:canonicalDigest(base)});return committed(execution,C[kind],result,at,'workspace_write');}
  ports[C.remux]=Object.freeze({validateInputs(c){requireNamed(c,['knownBindings','careRequirement']);},execute:(c)=>mediaEffect(c,'remux'),validateResult(_c,o){if(!o?.result?.workspaceMediaHandleId)throw new TypeError('Aftercare Remux output is invalid.');}});
  ports[C.transcode]=Object.freeze({validateInputs(c){requireNamed(c,['knownBindings','careRequirement','aftercareMediaRepairStrategy']);},execute:(c)=>mediaEffect(c,'transcode'),validateResult(_c,o){if(!o?.result?.workspaceMediaHandleId||!o.result.executionDeviceRef)throw new TypeError('Aftercare Transcode output is invalid.');}});
  ports[C.mediaVerify]=Object.freeze({validateInputs(c){requireNamed(c,['workspaceMediaHandle','careRequirement']);},async execute(execution){const c=context(execution),care=activeCase(c),at=now(),n=execution.namedInputs,workspace=n.workspaceMediaHandle.workspaceMaterialHandle,location=workspaceLocation(store,workspace),identity=physicalIdentity(location,workspace.physicalIdentity.mountScopeId,fingerprint),probe=await options.mediaProbe.probe(Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,identity,location:location.replace(/\\/g,'/')})),sourcePrimary=c.raw.materials.find(isPrimaryMaterial),sourceProbe=await options.mediaProbe.probe(primaryReadHandle(c,sourcePrimary)),reasons=probeConformance({...c,raw:{...c.raw,materials:[{...sourcePrimary,location,size_bytes:identity.sizeBytes}]}},probe).map((item)=>item.schemaRef.split('/')[5]),profile=n.workspaceMediaHandle.productionVideoProfile;
    reasons.push(...verifyOutputContinuity({sourceProbe,outputProbe:probe}).reasonCodes);
    const playback=await verifyPlaybackBounded(options,store,n.workspaceMediaHandle,probe);if(playback.passedSamplePointsPercent?.length!==3)reasons.push('playback_decode_failed');
    revalidateCaseAuthority(execution,care);
    if(profile?.dynamicRangeOperation==='tone_map_to_sdr_bt709'){const video=probe.videoStreams?.find((item)=>item.dispositionDefault===true)||probe.videoStreams?.[0];if(video?.dynamicRangeKind!=='sdr')reasons.push('dynamic_range_conversion_unmet');if(video?.pixelFormat!=='yuv420p'||!['tv','mpeg'].includes(video?.colorRange)||video?.colorPrimaries!=='bt709'||video?.colorTransfer!=='bt709'||video?.colorMatrix!=='bt709')reasons.push('output_color_profile_unmet');if(video?.dolbyVision)reasons.push('dolby_vision_metadata_not_removed');}
    const unique=Object.freeze([...new Set(reasons)].sort()),base={schemaRef:'helix://contracts/types/CareProductVerification/v1',schemaVersion:1,verificationId:stable('arca-care-media-verification-',{caseId:care.aftercareCaseId,workspace:n.workspaceMediaHandle.workspaceMediaHandleId}),verificationKind:'aftercare_media',basisDigest:c.basis.digest,result:unique.length?'failed':'passed',reasonCodes:unique,evidenceRefs:Object.freeze([probe.payloadDigest,playback?.decodeDigest].filter(Boolean)),verifiedAtMs:at,aftercareCaseId:care.aftercareCaseId,careRequirementDigest:n.careRequirement.digest,workspaceMediaHandleId:n.workspaceMediaHandle.workspaceMediaHandleId};const result=Object.freeze(base);return outcome(C.mediaVerify,result,at);},validateResult(_c,o){if(!['passed','failed'].includes(o?.result?.result))throw new TypeError('Aftercare Product Verification is invalid.');}});
  ports[C.assessmentCommit]=Object.freeze({validateInputs(c){requireNamed(c,['professionalAssessmentsSharingOneCareBasis','domainFactCommitHandle']);},execute(execution){const c=context(execution),set=execution.namedInputs.professionalAssessmentsSharingOneCareBasis;
    if(set.careBasisDigest!==c.basis.digest||set.assessments.length!==3)throw new Error('Aftercare professional Assessments do not share the current Care Basis.');
    const rows=options.workResultReader.read(execution.workId).filter((item)=>item.outcomeKind==='succeeded'&&
      [C.custody,C.presentation,C.conformance].includes(item.capabilityRef)).map((item)=>item.result);
    if(![1,3].includes(rows.length)||rows.some((item)=>item.careBasisDigest!==c.basis.digest))throw new Error('Aftercare terminal Assessment set is incomplete or stale.');
    const committedSet=store.commitAssessmentSet({shelfEntryId:c.shelfEntryId,inventoryRevision:c.basis.inventoryRevision,standardRevision:c.basis.standardRevision,
      placementRevision:c.basis.placementRevision,decisionFactSetDigest:c.basis.decisionFactSetDigest,careBasisDigest:c.basis.digest,
      assessments:rows.map((item)=>({assessmentId:item.evidenceId,assessmentKind:item.evidenceKind.replace('arca_aftercare_',''),result:item.assessmentState,incidentKey:item.incidentKey,
        evidenceDigest:item.payloadDigest,findings:item.findingDrafts.map(decodeFinding).filter(Boolean)}))});
    const setDigest=canonicalDigest(committedSet.assessments.map((item)=>item.evidenceDigest).sort()),base={schemaRef:'helix://contracts/types/AssessmentRevision/v1',schemaVersion:1,
      factId:stable('arca-assessment-revision-',{shelfEntryId:c.shelfEntryId,careBasisDigest:c.basis.digest}),ownerDomain:'arca',aggregateType:'shelf_entry',aggregateId:c.shelfEntryId,
      revision:1,factSchemaRef:'helix://arca/facts/AftercareAssessmentRevision/v1',commitMarker:stable('arca-assessment-marker-',{shelfEntryId:c.shelfEntryId,careBasisDigest:c.basis.digest}),
      committedAtMs:committedSet.committedAtMs,shelfEntryId:c.shelfEntryId,careBasisDigest:c.basis.digest,professionalAssessmentSetDigest:setDigest};
    const result=Object.freeze({...base,factDigest:canonicalDigest(base)});return committed(execution,C.assessmentCommit,result,now(),'domain_fact_commit');},validateResult(_c,o){if(!o?.result?.professionalAssessmentSetDigest)throw new TypeError('Aftercare Assessment Revision is invalid.');}});
  ports[C.inventoryCommit]=Object.freeze({validateInputs(c){requireNamed(c,['verifiedCareInventoryChange','responsibilityControlCommitHandle']);},execute(execution){const c=context(execution),n=execution.namedInputs,caseId=n.verifiedCareInventoryChange.aftercareCaseId,history=store.history(c.shelfEntryId),prior=history.commits.find((item)=>item.aftercareCaseId===caseId),care=prior?store.getCase(caseId):activeCase(c);if(!care||care.state!=='active'||caseId!==care.aftercareCaseId)throw new Error('Aftercare Inventory change belongs to another or terminal Case.');const sourceWorkId=preparationWorkId(execution),frozenMaterials=contextReader.inventoryMaterials(c.shelfEntryId,care.careBasis.inventoryRevision),receipts=[...options.workResultReader.read(execution.workId).filter((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===C.artifactMaterialize).map((item)=>item.result),...placementMaterialReceipts(c,options.workResultReader,sourceWorkId,care,frozenMaterials)];if(!receipts.length)throw new Error('Aftercare Inventory commit lacks durable Material Effect receipts.');const settlementEventId=aftercareSettlementEventId(execution.workAttemptId),hasSettlementEvent=options.workResultReader.readBindings(execution.workId).some((item)=>item.capabilityRef===C.settlement),settlementApprovalFor=(targetContext,observedAtMs)=>{const handles=buildAftercareSettlementHandles({context:targetContext,aftercareCaseId:care.aftercareCaseId,receipts,frozenMaterials,observedOldBindings:observeKnownOldBindings(targetContext.raw,fingerprint),observedAtMs});return Object.freeze({aftercareCaseId:care.aftercareCaseId,settlementScopeDigest:settlementScopeDigest(handles),serviceCatalogRevision:aftercareServiceCatalogRevision(options.registry),shelfStandardRevision:care.careBasis.standardRevision,careBasisDigest:care.careBasisDigest,settlementEventId});};let record;
    if(prior)throw Object.assign(new Error('Aftercare Inventory exists without Foundation completing its atomic Event Result.'),{code:'ARCA_AFTERCARE_ATOMIC_RESULT_REQUIRED'});
    {const planned=deriveInventoryMaterialChanges(frozenMaterials,receipts),releasedKeys=new Set(planned.filter((item)=>item.action==='release').map((item)=>item.identity.materialKey)),materials=frozenMaterials.filter((item)=>!releasedKeys.has(item.material_key)).map((item)=>({...item}));
      for(const receipt of receipts){const identity=receipt.finalMaterialIdentity,existing=materials.find((item)=>item.material_key===identity.materialKey);if(existing)continue;const extension=path.extname(receipt.targetLocation).toLowerCase(),retiredKey=receipt.retiredMaterials?.[0]?.identity?.materialKey||receipt.supersededMaterialIdentity?.materialKey,sourceRow=retiredKey?c.raw.materials.find((item)=>item.material_key===retiredKey):null,role=receipt.materialEffectKind==='placement_migrate'&&sourceRow?sourceRow.role:receipt.materialEffectKind==='primary_replace'?'primary_payload':extension==='.nfo'?'metadata_sidecar':/(jpg|jpeg|png|webp)$/.test(extension.slice(1))?'poster':'sidecar',episodeClaims=sourceRow?JSON.parse(sourceRow.episode_claims_json):emptyArcaMaterialEpisodeClaims();materials.push({shelf_entry_id:c.shelfEntryId,inventory_revision:c.raw.entry.current_inventory_revision+1,ordinal:materials.length,material_key:identity.materialKey,role,episode_claims_schema_ref:EPISODE_CLAIMS_SCHEMA,episode_claims_json:canonicalJson(episodeClaims),episode_claim_set_digest:sourceRow?.episode_claim_set_digest||episodeClaims.episodeClaimSetDigest,endpoint_id:receipt.targetEndpointId,location:receipt.targetLocation,binding_revision:1,mount_scope_id:identity.mountScopeId,inode:identity.inode,fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:String(identity.fingerprintVersion),content_fingerprint:identity.contentFingerprint,digest_hex:identity.contentFingerprint,size_bytes:identity.sizeBytes,active_guard:role==='primary_payload'?1:0});}
      const scope=Object.freeze({ownerDomain:'arca',scopeType:'shelf_entry',scopeId:c.shelfEntryId}),projections=controls.getMaterialControlProjections(planned.map((item)=>item.identity.materialKey)),byKey=new Map(projections.map((item)=>[item.materialKey,item])),changes=planned.map((item)=>{const projection=byKey.get(item.identity.materialKey);return Object.freeze({identity:item.identity,action:item.action,expectedRevision:Number(projection.controlRevision),expectedProjectionDigest:projection.projectionDigest,...(item.action==='release'?{fromScope:scope}:{toScope:scope})});});
      if(n.responsibilityControlCommitHandle.controlScopeDigest!==controlScopeDigest(changes))throw new Error('Aftercare Control Handle does not cover the exact Inventory change.');
      const nextRevision=Number(c.raw.entry.current_inventory_revision)+1,
        representationDigest=canonicalDigest({schema:'arca.inventory-representation@1',shelfEntryId:c.shelfEntryId,
          inventoryRevision:nextRevision,sourcePackageId:c.raw.inventory.source_package_id,members:materials.map(representationMember)}),
        committedAtMs=now(),inventoryRequest={aftercareCaseId:care.aftercareCaseId,shelfEntryId:c.shelfEntryId,
          previousInventoryRevision:c.raw.entry.current_inventory_revision,representationDigest,
          controlChangeDigest:n.responsibilityControlCommitHandle.controlScopeDigest},
        inventoryCommitId=aftercareInventoryCommitId(inventoryRequest),at=effectOccurredAt(execution,committedAtMs),
        result=Object.freeze({schemaRef:'helix://contracts/types/AftercareInventoryCommitReceipt/v1',schemaVersion:1,
          receiptId:inventoryCommitId,receiptKind:'aftercare_inventory_committed',ownerDomain:'arca',scopeType:'shelf_entry',
          scopeId:c.shelfEntryId,scopeDigest:care.careBasisDigest,
          effectReceiptRef:stable('arca-care-effect-receipt-',{eventId:execution.eventId}),committedAtMs,
          aftercareCaseId:care.aftercareCaseId,shelfEntryId:c.shelfEntryId,
          previousInventoryRevision:Number(c.raw.entry.current_inventory_revision),newInventoryRevision:nextRevision,
          controlChangeDigest:n.responsibilityControlCommitHandle.controlScopeDigest}),
        commitDigest=aftercareInventoryCommitDigest(inventoryRequest,canonicalDigest(result)),
        atomicOutcome=validateAtomicInventoryOutcome(committed(execution,C.inventoryCommit,result,at,
          'responsibility_control_commit',commitDigest)),
        controlParticipant=createMaterialControlParticipant({schemaManifest:options.schemaManifest,
          participantId:'arca_aftercare_inventory_control',handle:n.responsibilityControlCommitHandle,changes,
          authorizedScopeDigest:n.responsibilityControlCommitHandle.controlScopeDigest,
          commitMarker:atomicOutcome.effectReceipt.commitMarker}),
        projectedPostCommitContext=Object.freeze({...c,raw:Object.freeze({...c.raw,
          entry:Object.freeze({...c.raw.entry,current_inventory_revision:nextRevision}),materials:Object.freeze(materials)})}),
        settlementApproval=hasSettlementEvent?settlementApprovalFor(projectedPostCommitContext,committedAtMs):null,
        written=store.commitInventory({...inventoryRequest,materials,related:c.raw.related,facts:c.raw.facts,people:c.raw.people,
          committedAtMs,settlementApproval,resultBinding:Object.freeze({
            resultId:stable('arca-care-inventory-result-',{eventId:execution.eventId}),eventId:execution.eventId,
            outcomeKind:atomicOutcome.kind,resultSchemaRef:atomicOutcome.resultSchemaRef,result:atomicOutcome.result,
            evidenceSchemaRef:atomicOutcome.evidenceSchemaRef,evidence:atomicOutcome.evidence,
            effectReceiptId:atomicOutcome.effectReceipt.effectReceiptId,effectReceipt:atomicOutcome.effectReceipt})},controlParticipant);
      record=Object.freeze({inventoryCommitId:written.inventory_commit_id,previousInventoryRevision:written.previousInventoryRevision,
        newInventoryRevision:written.newInventoryRevision,controlChangeDigest:written.control_change_digest,
        committedAtMs:written.committed_at_ms,atomicOutcome});}
    const postCommitContext=postInventoryCaseAuthority(contextReader.read(c.shelfEntryId),care,record.newInventoryRevision);
    if(hasSettlementEvent)store.issueSettlementApproval(settlementApprovalFor(postCommitContext,record.committedAtMs));
    return record.atomicOutcome;},validateResult(_c,o){if(!o?.result?.newInventoryRevision)throw new TypeError('Aftercare Inventory Commit Receipt is invalid.');}});
  ports[C.settlement]=Object.freeze({
    validateInputs(c){requireNamed(c,['supersededInventoryHandleList','aftercareSettlementApproval']);},
    async execute(execution){
      const c=context(execution),care=store.history(c.shelfEntryId).cases.find((item)=>item.state==='active'),at=effectOccurredAt(execution,now()),n=execution.namedInputs,
        handles=n.supersededInventoryHandleList,scope=settlementScopeDigest(handles);
      const evidenceEntryCount=(handles.length?handles.length*3:1)+2;
      if(evidenceEntryCount>SETTLEMENT_EVIDENCE_MAX_ITEMS)throw Object.assign(new Error('Aftercare Settlement scope cannot be encoded by its bounded Evidence contract.'),{code:'ARCA_AFTERCARE_SETTLEMENT_EVIDENCE_BOUND',details:{handleCount:handles.length,evidenceEntryCount,maxItems:SETTLEMENT_EVIDENCE_MAX_ITEMS}});
      if(!care||n.aftercareSettlementApproval.exactEffectScopeDigest!==scope||
          !n.aftercareSettlementApproval.invalidatingFactDigests.includes(care.careBasisDigest))
        throw new Error('Aftercare Settlement Approval is stale or incomplete.');
      handles.forEach((handle)=>assertAftercareSettlementHandle(c,care,handle));
      const targets=handles.map((handle)=>resolveAftercareSettlementTarget(c,handle));
      const expectedApprovalId=aftercareSettlementApprovalId({aftercareCaseId:care.aftercareCaseId,
        settlementScopeDigest:scope,careBasisDigest:care.careBasisDigest,settlementEventId:execution.eventId}),
        durableApproval=store.getSettlementApproval(care.aftercareCaseId,scope),consumedReplay=durableApproval?.state==='consumed';
      if(!durableApproval||!['active','consumed'].includes(durableApproval.state)||durableApproval.serviceCatalogRevision!==aftercareServiceCatalogRevision(options.registry)||
          durableApproval.shelfStandardRevision!==care.careBasis.standardRevision||
          durableApproval.careBasisDigest!==care.careBasisDigest||durableApproval.approvalId!==expectedApprovalId||
          durableApproval.approvalId!==n.aftercareSettlementApproval.approvalId||
          (consumedReplay&&!execution.recoveryDecision))
        throw new Error('Aftercare Settlement Approval is not durably current.');
      settlementAuthority(c.shelfEntryId,care.aftercareCaseId,durableApproval.approvalId,scope,consumedReplay);
      const managedLocations=[...targets.map((item)=>path.resolve(item.readHandle.location)),
        ...c.raw.materials.map((item)=>path.resolve(item.location)),
        ...(c.raw.oldBindings||[]).map((item)=>path.resolve(item.location))],managed=new Set(managedLocations);
      for(const location of managedLocations){for(let ancestor=path.dirname(location);ancestor&&ancestor!==path.dirname(ancestor);ancestor=path.dirname(ancestor))managed.add(ancestor);}
      const settlementDirectories=[...new Set(targets.map((item)=>path.dirname(path.resolve(item.readHandle.location))))]
        .filter((item)=>path.resolve(item)!==path.resolve(c.raw.shelf.target_root_location)).sort();
      for(const directory of consumedReplay?[]:settlementDirectories){
        if(!fs.existsSync(directory)||path.resolve(directory)===path.resolve(c.raw.shelf.target_root_location))continue;
        const unknown=(await fs.promises.readdir(directory,{withFileTypes:true})).map((item)=>path.resolve(directory,item.name)).filter((item)=>!managed.has(item));
        if(unknown.length)throw Object.assign(new Error('Aftercare old Material directory contains an unknown member.'),{code:'ARCA_AFTERCARE_SETTLEMENT_UNKNOWN_MEMBER',details:{directory,unknownNames:unknown.map((item)=>path.basename(item)).sort()}});
      }
      for(const target of targets){
        settlementAuthority(c.shelfEntryId,care.aftercareCaseId,durableApproval.approvalId,scope,consumedReplay);
        assertSettlementTargetReality(c,target,fingerprint,consumedReplay);
      }
      if(!consumedReplay){
        for(const target of targets){const handle=target.readHandle;settlementAuthority(c.shelfEntryId,care.aftercareCaseId,durableApproval.approvalId,scope);assertSettlementTargetReality(c,target,fingerprint);if(fs.existsSync(handle.location))await fs.promises.unlink(handle.location);if(fs.existsSync(handle.location))throw new Error('Aftercare superseded Material deletion was not durable.');await new Promise((resolve)=>setImmediate(resolve));}
        for(const directory of settlementDirectories){settlementAuthority(c.shelfEntryId,care.aftercareCaseId,durableApproval.approvalId,scope);if(fs.existsSync(directory)&&(await fs.promises.readdir(directory)).length===0)await fs.promises.rmdir(directory);}
        settlementAuthority(c.shelfEntryId,care.aftercareCaseId,durableApproval.approvalId,scope);
      }
      const consumed=consumedReplay?durableApproval:store.consumeSettlementApproval({aftercareCaseId:care.aftercareCaseId,
        settlementScopeDigest:scope,careBasisDigest:care.careBasisDigest,approvalId:durableApproval.approvalId});
      const entries=targets.length?targets.flatMap(({readHandle:handle,finalReplacement})=>[{key:'exists:'+handle.identity.materialKey,value:false},{key:'location:'+handle.identity.materialKey,value:handle.location},{key:'final_verified:'+handle.identity.materialKey,value:finalReplacement?true:null}]):[{key:'settlement_count',value:0}],postBase={schemaRef:'helix://contracts/records/post-delete-reality/v1',schemaVersion:1,recordKind:'post-delete-reality',entries:Object.freeze([...entries,{key:'settlement_directory_set_digest',value:canonicalDigest(settlementDirectories)},{key:'approval_state',value:consumed.state}])},postDeleteReality=Object.freeze({...postBase,recordDigest:canonicalDigest(postBase)}),materialSetDigest=canonicalDigest(targets.map(({readHandle})=>({materialKey:readHandle.identity.materialKey,location:readHandle.location})).sort((a,b)=>(a.location+a.materialKey).localeCompare(b.location+b.materialKey))),base={schemaRef:'helix://contracts/types/SettlementDeletionEvidence/v1',schemaVersion:1,evidenceId:stable('arca-care-settlement-evidence-',{caseId:care.aftercareCaseId,key:materialSetDigest}),evidenceKind:'aftercare_settlement',producerRef:C.settlement,basisDigest:care.careBasisDigest,observedAtMs:at,authorizationOrApprovalRef:consumed.approvalId,materialKey:materialSetDigest,preDeleteIdentityDigest:canonicalDigest(targets.map(({readHandle})=>({identity:readHandle.identity,location:readHandle.location})).sort((a,b)=>(a.location+a.identity.materialKey).localeCompare(b.location+b.identity.materialKey))),postDeleteReality,effectReceiptId:stable('arca-care-effect-receipt-',{eventId:execution.eventId})};const result=Object.freeze({...base,payloadDigest:canonicalDigest(base)});return committed(execution,C.settlement,result,at,'destructive_commit');
    },
    validateResult(_c,o){if(!Array.isArray(o?.result?.postDeleteReality?.entries))throw new TypeError('Aftercare Settlement Evidence is invalid.');},
  });
  ports[C.caseCommit]=Object.freeze({
    validateInputs(c){requireNamed(c,['reassessedResult','domainFactCommitHandle']);},
    execute(execution){
      const c=context(execution),n=execution.namedInputs,reassessed=n.reassessedResult,
        handle=n.domainFactCommitHandle,care=store.getCase(reassessed.aftercareCaseId),at=effectOccurredAt(execution,now());
      if(!care||!['active','resolved'].includes(care.state)||reassessed.resultState!=='resolved'||
          reassessed.digest!==canonicalDigest(Object.fromEntries(Object.entries(reassessed).filter(([key])=>key!=='digest'))))
        throw new Error('Aftercare Case cannot close without a valid resolved Reassessment.');
      if(handle.ownerDomain!=='arca'||handle.aggregateType!=='aftercare_case'||handle.aggregateId!==care.aftercareCaseId||
          handle.factType!=='aftercare_case_result'||handle.payloadDigest!==reassessed.digest||
          handle.eventFenceDigest!==canonicalDigest({schema:'arca.aftercare-case-event@1',eventId:execution.eventId}))
        throw Object.assign(new Error('Aftercare Case commit Handle does not cover this Reassessment and Event.'),{code:'ARCA_AFTERCARE_CASE_COMMIT_HANDLE_STALE'});
      if(care.state==='active'){
        const history=store.history(c.shelfEntryId),inventoryCommit=history.commits.find((item)=>item.aftercareCaseId===care.aftercareCaseId);
        postInventoryCaseAuthority(c,care,inventoryCommit?.newInventoryRevision);
        const health=projectHealth(c,history,now()),freshHealthy=Object.values(health.dimensions)
          .every((item)=>item.state==='healthy'&&item.findings.length===0),
          reassessmentDigest=canonicalDigest(Object.values(health.dimensions).map((item)=>item.evidenceDigest).sort());
        if(!freshHealthy||reassessmentDigest!==reassessed.reassessmentDigest)
          throw Object.assign(new Error('Aftercare Reassessment is no longer current at Case commit.'),{code:'ARCA_AFTERCARE_REASSESSMENT_STALE'});
      }
      const terminal=store.terminateCase(care.aftercareCaseId,'resolved','reassessed_healthy',reassessed.reassessmentDigest),
        inventoryEffectRefs=store.history(c.shelfEntryId).commits.filter((item)=>item.aftercareCaseId===care.aftercareCaseId).map((item)=>item.inventoryCommitId),
        base={schemaRef:'helix://contracts/types/AftercareCaseResult/v1',schemaVersion:1,
          factId:stable('arca-care-case-result-',{caseId:care.aftercareCaseId}),ownerDomain:'arca',
          aggregateType:'aftercare_case',aggregateId:care.aftercareCaseId,revision:1,
          factSchemaRef:'helix://arca/facts/AftercareCaseResult/v1',commitMarker:stable('arca-care-case-marker-',{caseId:care.aftercareCaseId}),
          committedAtMs:terminal.terminalAtMs,aftercareCaseId:care.aftercareCaseId,resultState:'resolved',
          reassessmentDigest:reassessed.reassessmentDigest,inventoryEffectRefs:Object.freeze(inventoryEffectRefs)},
        result=Object.freeze({...base,factDigest:canonicalDigest(base)});
      return committed(execution,C.caseCommit,result,at,'domain_fact_commit');
    },
    validateResult(_c,o){if(o?.result?.resultState!=='resolved')throw new TypeError('Aftercare Case Result is invalid.');},
  });
  ports[C.workspaceReclaim]=Object.freeze({validateInputs(c){requireNamed(c,['aftercareWorkspaceHandleList','referenceEvidence']);},async execute(execution){context(execution);const caseId=execution.namedInputs.referenceEvidence.objectId.split(':')[0],registered=store.listAftercareWorkspaceHandles(caseId),supplied=execution.namedInputs.aftercareWorkspaceHandleList;if(canonicalDigest(registered)!==canonicalDigest(supplied))throw Object.assign(new Error('Aftercare Workspace reclaim input does not cover the exact registered Handle set.'),{code:'ARCA_AFTERCARE_WORKSPACE_HANDLE_SET_STALE'});const outcomeValue=await store.reconcileAftercareWorkspaceLifecycle(caseId,{currentWorkId:execution.workId,recoveryDecision:execution.recoveryDecision});if(outcomeValue.kind!=='reclaimed')throw Object.assign(new Error('Aftercare Workspace is not eligible for safe reclaim.'),{code:'ARCA_AFTERCARE_WORKSPACE_NOT_ELIGIBLE',details:{reasonCode:outcomeValue.reasonCode||outcomeValue.kind}});return committed(execution,C.workspaceReclaim,outcomeValue.receipt,Number.isSafeInteger(execution.effectOccurredAtMs)?execution.effectOccurredAtMs:now(),'workspace_write');},validateResult(_c,o){if(o?.result?.receiptKind!=='aftercare_workspace_reclaimed')throw new TypeError('Aftercare Reclamation Receipt is invalid.');}});
  return Object.freeze(ports);
}

module.exports=Object.freeze({AFTERCARE_LONG_MEDIA_TIMEOUT_MS,createAftercareCapabilityPorts,decodeFinding,validNfo,validImageBytes,progressSample,remainingDeadlineMs,aftercareMediaProbeEvidence,resolveAftercareFfmpegPath,materializeArtifactWithRollback,materializeMediaWithRollback,nfoCommitSource,custodyIdentityChangedFinding,permitsMissingArtifactReplacement,buildProductionVideoProfile,verifyPlaybackBounded,resolveAftercareSettlementTarget,assertAftercareSettlementHandle,assertSettlementTargetReality});
