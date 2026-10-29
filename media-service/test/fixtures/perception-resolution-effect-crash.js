'use strict';

// Child process for the Resolution Effect crash test. The only abrupt exit is
// inside a disposable test Host after the real Effect intent has been written.
const fs=require('node:fs');
const path=require('node:path');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');

const root=process.argv[2],phase=process.argv[3],dataDir=path.join(root,'data'),admin=path.join(root,'admin');
const secret='perception-resolution-crash-fixture',targetId='crash-shelf-entry';
fs.mkdirSync(admin,{recursive:true});fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');
const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:secret});
function targetProjection(type,id){if(type!=='shelf_entry'||id!==targetId)return null;
  const body={targetType:type,targetId:id,targetRevision:1,title:'Crash Race',year:2024,providerIdentity:'tmdb_movie:991124',shelfEntrySnapshotDigest:canonicalDigest({targetId,revision:1})};
  return Object.freeze({...body,targetDigest:canonicalDigest(body)});}

(async()=>{
  const host=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:secret,perceptionTargetProjectionReader:targetProjection,
    unitOfWorkDecorator(value){return Object.freeze({...value,execute(participants,...args){
      if(participants.some(item=>item.participantId==='perception_resolution_commit')){
        if(phase==='after_commit')value.execute(participants,...args);
        fs.writeFileSync(path.join(root,'revision.json'),JSON.stringify({revision:2}));
        process.exit(78);
      }
      return value.execute(participants,...args);
    }});},onExecutionRuntimeError(error){console.error(error.code,error.message);}});
  const session=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});
  if(session.statusCode!==204)throw new Error('Fixture session failed.');
  const response=await host.inject({method:'POST',url:'/v1/admin/perception/records',headers:{cookie:session.headers['set-cookie']},
    payload:{targetType:'shelf_entry',targetId,expectedRevision:0,rating:4,idempotencyKey:'crash-rating'}});
  if(response.statusCode!==202)throw new Error('Fixture rating command failed: '+response.body);
  setTimeout(()=>{console.error('Fixture did not reach the commit boundary.');process.exit(79);},30_000);
})().catch(error=>{console.error(error);process.exit(80);});
