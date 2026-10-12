'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const root=process.argv[2],dataDir=path.join(root,'data');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
function handle({operationId}) { return {schemaRef:'helix://contracts/types/IntegrationHandle/v1',schemaVersion:1,handleId:'series-routing-handle',
  integrationId:'tmdb-main',integrationType:'tmdb',configRevision:1,secretRef:'fixture-secret',allowedOperation:operationId,
  expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:canonicalDigest({value:operationId})}; }

(async()=>{
  let runtimeError;let integrationCalls=0;
  const host=await createCleanServiceHost({dataDir,adminDistDir:path.join(root,'admin'),secretRoot:'disposable-series-routing-secret',
    routingIntegrationHandleResolver:handle,productIntegrationHandleResolver:handle,currentProductIntegrationHandleResolver:handle,
    integrationFetch:async()=>{integrationCalls++;throw new Error('Committed external acquisition must not repeat during restart');},
    onExecutionRuntimeError(error){runtimeError=error;}}),db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try {
    const until=Date.now()+120000;let entry;
    do {
      if(runtimeError)throw runtimeError;
      entry=db.prepare('SELECT * FROM arca_shelf_entries').get();
      if(entry?.status==='active')break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<until);
    if(!entry||entry.status!=='active')throw new Error(JSON.stringify({entry,
      failures:db.prepare('SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    const summary={entry,materials:db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? ORDER BY material_key').all(entry.shelf_entry_id,entry.current_inventory_revision),
      commits:db.prepare('SELECT * FROM arca_ondeck_commit_receipts ORDER BY rowid').all(),
      offload:db.prepare('SELECT * FROM libra_offload_context_materials').all(),
      produced:db.prepare("SELECT r.result_json FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id WHERE e.capability_ref='libra.media.transcode@1' ORDER BY e.event_id").all(),
      integrationCalls,foreignKeys:db.pragma('foreign_key_check'),integrity:db.pragma('integrity_check')[0].integrity_check};
    process.stdout.write('\nSERIES_EXTERNAL_RESTART_RESULT='+JSON.stringify(summary)+'\n');
  } finally {await host.close();db.close();}
})().catch(error=>{process.stderr.write(String(error.stack||error));process.exitCode=1;});
