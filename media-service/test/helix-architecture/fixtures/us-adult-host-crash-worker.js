'use strict';
const {createCleanServiceHost}=require('../../../src/clean-service-host');
// Production runtime timers are deliberately unref'ed; keep this isolated
// child alive until the selected abrupt-exit boundary is actually reached.
setInterval(()=>{},1000);
process.once('message',async input=>{
  try{
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
    process.send({admitted:response.json()});
  }catch(error){process.stderr.write(error.stack+'\n');process.exit(1);}
});
const started=Date.now();
