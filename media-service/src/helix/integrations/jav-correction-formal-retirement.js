'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {computeBoundedMaterialFingerprint}=require('./bounded-material-fingerprint');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const key=location=>process.platform==='win32'?path.resolve(location).toLowerCase():path.resolve(location);
function createJavCorrectionFormalRetirement({validatePlan}){
  if(typeof validatePlan!=='function')throw new TypeError('Formal retirement requires its closed nominal plan validator.');
  function assertParents(location){
    if(!path.isAbsolute(location))fail('ARCA_JAV_CORRECTION_RETIREMENT_ESCAPE','Retirement path is not absolute.');
    let current=path.parse(location).root;
    for(const part of path.relative(current,location).split(path.sep)){
      current=path.join(current,part);let stat;
      try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')return;throw error;}
      if(stat.isSymbolicLink()||current!==location&&!stat.isDirectory())fail('ARCA_JAV_CORRECTION_RETIREMENT_ESCAPE','Retirement traverses a linked or non-directory parent.');
    }
  }
  async function fullDigest(location,check){
    const before=fs.statSync(location,{bigint:true}),hash=createHash('sha256');let chunks=0;
    for await(const chunk of fs.createReadStream(location,{highWaterMark:256*1024})){hash.update(chunk);if(++chunks%64===0)check();}
    const after=fs.statSync(location,{bigint:true});
    if(['dev','ino','size','mtimeNs','ctimeNs'].some(field=>before[field]!==after[field]))fail('ARCA_JAV_CORRECTION_RETIREMENT_DRIFT','File changed during full retirement verification.');
    check();return {digest:hash.digest('hex'),stat:after};
  }
  async function observed(item,check){
    assertParents(item.location);let stat;try{stat=fs.lstatSync(item.location);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink())fail('ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT','Retirement member is not a regular exact file.');
    const snapshot=await computeBoundedMaterialFingerprint(item.location,{requireStableSnapshot:true}),expected=item.physicalIdentity;
    if(String(snapshot.stat.ino)!==expected.inode||Number(snapshot.stat.size)!==expected.sizeBytes||snapshot.contentFingerprint!==expected.contentFingerprint||
        snapshot.fingerprintAlgorithm!==expected.fingerprintAlgorithm||snapshot.fingerprintVersion!==expected.fingerprintVersion)
      fail('ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT','Retirement member differs from its frozen physical identity.');
    check();
    if(item.fullByteDigest){const full=await fullDigest(item.location,check);if(full.digest!==item.fullByteDigest)
      fail('ARCA_JAV_CORRECTION_RETIREMENT_DRIFT','Retirement member differs from its full byte proof.');return full.stat;}
    return fs.statSync(item.location,{bigint:true});
  }
  function scope(plan,{shouldContinue,readCurrentGuardDigest}){
    validatePlan(plan);const {planDigest,...body}=plan;
    const setDigest=canonicalDigest({targetRoot:plan.targetRoot,stageDirectory:plan.stageDirectory,finals:plan.finals,retirements:plan.retirements,
      filePlanDigest:plan.filePlanDigest,stagedManifestDigest:plan.stagedManifestDigest});
    if(planDigest!==canonicalDigest(body)||plan.guardDigest!==canonicalDigest(plan.guard)||plan.guard.retirementSetDigest!==setDigest||
        plan.guard.correctionId!==plan.correctionId||plan.guard.shelfEntryId!==plan.shelfEntryId||plan.guard.admissionDigest!==plan.admissionDigest||
        plan.guard.commitReceiptDigest!==plan.commitReceiptDigest||!/^arca-jav-correction-[a-f0-9]{40}$/.test(plan.correctionId)||
        plan.stageDirectory!==path.join(path.resolve(plan.targetRoot),'.shelfdeck-'+plan.correctionId+'-stage')||
        new Set(plan.finals.map(item=>key(item.location))).size!==plan.finals.length||
        new Set(plan.retirements.map(item=>key(item.location))).size!==plan.retirements.length||
        plan.retirements.some(item=>plan.finals.some(final=>key(final.location)===key(item.location))))
      fail('ARCA_JAV_CORRECTION_RETIREMENT_PLAN_INVALID','Retirement Plan is not an exact exclusive alias set.');
    return ()=>{
      if(typeof shouldContinue!=='function'||shouldContinue()!==true||typeof readCurrentGuardDigest!=='function'||readCurrentGuardDigest()!==plan.guardDigest)
        fail('ARCA_JAV_CORRECTION_RETIREMENT_FENCED','Retirement lost its exact committed Entry and Control guard.');
    };
  }
  async function preflight(plan,options){
    const check=scope(plan,options);check();const finalSnapshots=[];
    for(const final of plan.finals){const stat=await observed(final,check);if(!stat)fail('ARCA_JAV_CORRECTION_RETIREMENT_DRIFT','Current final material is missing.');finalSnapshots.push({final,stat});}
    assertParents(plan.stageDirectory);
    let stage;try{stage=fs.lstatSync(plan.stageDirectory);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(stage&&(!stage.isDirectory()||stage.isSymbolicLink()||fs.readdirSync(plan.stageDirectory).some(name=>!plan.retirements.some(item=>
        item.kind==='stage_alias'&&key(item.location)===key(path.join(plan.stageDirectory,name))))))
      fail('ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT','Stage directory contains an unknown member.');
    const members=[];
    for(const item of plan.retirements){check();const stat=await observed(item,check);
      if(!stat&&options.recoveryDecision!=='continue_forward')fail('ARCA_JAV_CORRECTION_RETIREMENT_INCOMPLETE','Missing alias requires recovery under its original retirement Effect.');
      members.push({item,stat});}
    return {check,finalSnapshots,members};
  }
  function assertFinalSnapshots(finalSnapshots){
    for(const {final,stat:previous} of finalSnapshots){
      assertParents(final.location);const actual=fs.lstatSync(final.location,{bigint:true});
      // Unlinking this operation's hard-link aliases changes ctime, but does not
      // change the final video's inode, bytes, size or content modification time.
      if(!actual.isFile()||actual.isSymbolicLink()||['dev','ino','size','mtimeNs'].some(field=>actual[field]!==previous[field]))
        fail('ARCA_JAV_CORRECTION_RETIREMENT_DRIFT','Current final material changed after retirement preflight.');
    }
  }
  async function retire(plan,options){
    const {check,finalSnapshots,members}=await preflight(plan,options);
    for(const {item,stat:previous} of members){
      check();assertFinalSnapshots(finalSnapshots);if(!previous)continue;assertParents(item.location);
      const actual=fs.lstatSync(item.location,{bigint:true});
      if(!actual.isFile()||actual.isSymbolicLink()||['dev','ino','size','mtimeNs'].some(field=>actual[field]!==previous[field]))
        fail('ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT','Alias changed after retirement preflight.');
      check();fs.unlinkSync(item.location);
    }
    check();assertFinalSnapshots(finalSnapshots);assertParents(plan.stageDirectory);
    if(fs.existsSync(plan.stageDirectory)){
      if(fs.readdirSync(plan.stageDirectory).length)fail('ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT','Stage directory gained an unknown member.');
      check();fs.rmdirSync(plan.stageDirectory);
    }
    for(const final of plan.finals){if(!await observed(final,check))fail('ARCA_JAV_CORRECTION_RETIREMENT_DRIFT','Final material disappeared after alias retirement.');}
    for(const item of plan.retirements){assertParents(item.location);try{fs.lstatSync(item.location);fail('ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT','Retired alias appeared again.');}
      catch(error){if(error.code!=='ENOENT')throw error;}}
    check();const body={schema:'arca.jav-correction-formal-retirement-reality@1',correctionId:plan.correctionId,planDigest:plan.planDigest,
      commitReceiptDigest:plan.commitReceiptDigest,finalMaterialSetDigest:canonicalDigest(plan.finals),
      retiredAliasSetDigest:canonicalDigest(plan.retirements),retiredAliasCount:plan.retirements.length,stageDisposition:'absent'};
    return Object.freeze({...body,realityDigest:canonicalDigest(body)});
  }
  async function verifyRetired(plan,options){
    const checked=await preflight(plan,{...options,recoveryDecision:'continue_forward'});checked.check();
    if(checked.members.some(row=>row.stat!==null)||fs.existsSync(plan.stageDirectory))fail('ARCA_JAV_CORRECTION_RETIREMENT_INCOMPLETE','Retirement has not removed its complete declared alias set.');
    const body={schema:'arca.jav-correction-formal-retirement-reality@1',correctionId:plan.correctionId,planDigest:plan.planDigest,
      commitReceiptDigest:plan.commitReceiptDigest,finalMaterialSetDigest:canonicalDigest(plan.finals),retiredAliasSetDigest:canonicalDigest(plan.retirements),
      retiredAliasCount:plan.retirements.length,stageDisposition:'absent'};return Object.freeze({...body,realityDigest:canonicalDigest(body)});
  }
  return Object.freeze({preflight,retire,verifyRetired});
}
module.exports=Object.freeze({createJavCorrectionFormalRetirement});
