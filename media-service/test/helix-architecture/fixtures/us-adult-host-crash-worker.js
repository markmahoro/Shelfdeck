'use strict';
const {createCleanServiceHost}=require('../../../src/clean-service-host');
// Production runtime timers are deliberately unref'ed; keep this isolated
// child alive until the selected abrupt-exit boundary is actually reached.
setInterval(()=>{},1000);
process.once('message',async input=>{
  try{
    let discardLocation=null;
    if(input.boundary==='discard'){
      const fs=require('node:fs'),path=require('node:path'),unlink=fs.unlinkSync;
      fs.unlinkSync=function(location,...rest){const result=unlink.call(fs,location,...rest);
        if(discardLocation&&path.resolve(location)===discardLocation)process.exit(75);return result;};
    }
    const host=await createCleanServiceHost({dataDir:input.dataDir,adminDistDir:input.adminDistDir,secretRoot:input.secretRoot,
      faceModelRoot:process.env.SHELFDECK_FACE_MODEL_ROOT,now:()=>input.now+Date.now()-started,
      unitOfWorkDecorator:unit=>({...unit,execute(participants){
        const inventory=participants.some(item=>item.participantId==='arca_aftercare_inventory_foundation');
        if(inventory&&input.boundary==='before_commit')return unit.execute([...participants,{
          ...participants.at(-1),participantId:'isolated_actual_host_exit',execute(){process.exit(73);}
        }]);
        const result=unit.execute(participants);
        if(inventory&&input.boundary==='after_commit')process.exit(74);
        return result;
      }})});
    const response=await host.inject({method:'POST',url:'/v1/admin/collection/'+input.entryId+'/actions/refresh-us-adult-actor',
      payload:input.command,headers:{'x-api-key':input.apiKey}});
    if(response.statusCode!==202)throw new Error('Actor refresh admission failed: '+response.statusCode+' '+response.body);
    const admitted=response.json();
    if(input.boundary==='discard')discardLocation=require('node:path').resolve(input.targetRoot,'.shelfdeck-us-'+
      require('../../../src/helix/contracts/canonical-json').canonicalDigest(admitted.aftercareCaseId).slice(0,32)+'-stage','0000.stage');
    process.send({admitted});
  }catch(error){process.stderr.write(error.stack+'\n');process.exit(1);}
});
const started=Date.now();
