'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3'),sharp=require('sharp');
const {createCleanServiceHost}=require('../../src/clean-service-host');
(async()=>{
  const root=process.argv[2],dataDir=path.join(root,'data'),boundary=JSON.parse(fs.readFileSync(path.join(root,'ttl-crash-boundary.json'),'utf8')),
    start=Date.now(),clock=()=>boundary.clock+70000+Date.now()-start,picture=await sharp({create:{width:100,height:60,channels:3,background:'#376892'}}).jpeg().toBuffer(),requests=[],
    fetchImpl=require('../helix-architecture/fixtures/jav-host-transport').createJavHostTransport(picture,requests),errors=[];
  const host=await createCleanServiceHost({dataDir,adminDistDir:path.join(root,'admin'),secretRoot:'jav-host-fixture-root-0123456789abcdef0123456789',
    now:clock,integrationFetch:fetchImpl,onExecutionRuntimeError:error=>errors.push({code:error.code,message:error.message})}),
    db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try{
    const until=Date.now()+120000;
    while(Date.now()<until){
      if(errors.length)throw new Error(JSON.stringify(errors));
      if(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const result={commits:db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,
      failures:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),
      recoveredEvents:boundary.events.map(row=>db.prepare('SELECT event_id,state FROM fx_workflow_events WHERE event_id=?').get(row.event_id)),
      foreignKeys:db.pragma('foreign_key_check'),works:db.prepare("SELECT work_kind,state,process_id FROM fx_supporting_works WHERE state<>'succeeded'").all(),events:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE state NOT IN ('succeeded','skipped')").all(),integrity:db.pragma('integrity_check')[0].integrity_check,requests:requests.length};
    if(result.commits!==1||result.recoveredEvents.some(row=>row.state!=='succeeded'))throw new Error(JSON.stringify(result));
    process.stdout.write('JAV_TTL_RECOVERY='+JSON.stringify(result)+'\n');
  }finally{await host.close();db.close();}
})().catch(error=>{process.stderr.write(error.stack||String(error));process.exitCode=1;});
