'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const root=process.argv[2],dataDir=path.join(root,'data');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
function handle({operationId}) { return {schemaRef:'helix://contracts/types/IntegrationHandle/v1',schemaVersion:1,handleId:'series-routing-handle',
  integrationId:'tmdb-main',integrationType:'tmdb',configRevision:1,secretRef:'fixture-secret',allowedOperation:operationId,
  expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:canonicalDigest({value:operationId})}; }

(async()=>{
  const shared=process.argv[3]==='shared',sharp=require('sharp'),poster=await sharp({create:{width:4,height:6,channels:3,background:'#224466'}}).jpeg().toBuffer(),
    fanart=await sharp({create:{width:120,height:80,channels:3,background:'#334455'}}).jpeg().toBuffer();
  // Recreate the same controlled presentation provider as the initial Host.
  // Early graceful shutdown can occur before Arca observes shared metadata.
  const adapter=require('../../src/helix/integrations/tmdb-provider-adapter').createTmdbProviderAdapter({
    integrationQueryPort:{query:()=>({state:'active',integrationType:'tmdb',integrationId:'tmdb-main',configRevision:1,endpoint:'https://api.themoviedb.org/3',secretKind:'tmdb_access_token',secretRef:'fixture-secret',settings:{language:'zh-CN'}})},
    integrationHandleResolverPort:{resolve:request=>handle({operationId:request.allowedOperation})},
    secretLeaseResolverPort:{resolve:()=>({leaseId:'fixture-lease'})},secretLeaseConsumer:{consumeAsync:async(_lease,consume)=>consume(Buffer.from('disposable-secret'))},
    fetchImpl:async()=>new Response(JSON.stringify({id:1399,name:'Demo Show',original_name:'Demo Show',first_air_date:'2020-01-01',origin_country:['US'],genres:[{id:18,name:'Drama'}],overview:'Series plot',credits:{cast:[{id:1001,name:'Fixture Actor'}],crew:[]}}),{status:200}),
  });
  let runtimeError;let integrationCalls=0;
  const host=await createCleanServiceHost({dataDir,adminDistDir:path.join(root,'admin'),secretRoot:'disposable-series-routing-secret',
    routingIntegrationHandleResolver:handle,productIntegrationHandleResolver:handle,currentProductIntegrationHandleResolver:handle,
    fetchSeriesPresentationMetadata:basis=>adapter.observationPort.execute({operationId:'arca.series_presentation.source.observe@1',integrationHandle:handle({operationId:'arca.series_presentation.source.observe@1'}),timeoutMs:1000,input:{metadataRequest:basis}}),
    fetchSeriesPresentationArtifact:async request=>({resultKind:'acquired',imagePath:'/'+request.artifactKind+'.jpg',bytes:request.artifactKind==='poster'?poster:fanart}),
    ...(shared?{mediaProbe:{async probe(readHandle){const body={resultKind:'probed',sourceHandleDigest:canonicalDigest(readHandle),durationMs:1000,videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null};return {...body,payloadDigest:canonicalDigest(body)};}}}:{}),
    integrationFetch:async()=>{integrationCalls++;throw new Error('Committed external acquisition must not repeat during restart');},
    onExecutionRuntimeError(error){runtimeError=error;}}),db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try {
    const until=Date.now()+90000;let entry;
    do {
      if(runtimeError)throw runtimeError;
      entry=db.prepare('SELECT * FROM arca_shelf_entries').get();
      if(entry?.status==='active'&&(!shared||db.prepare("SELECT count(*) n FROM fx_workspace_registry WHERE process_type='series_presentation' AND state<>'reclaimed'").get().n===0&&db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref LIKE 'arca.series_presentation.%' AND state NOT IN ('succeeded','failed','cancelled','skipped')").get().n===0))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<until);
    if(!entry||entry.status!=='active')throw new Error(JSON.stringify({entry,
      readiness:host.readiness(),runs:db.prepare('SELECT libra_run_id,state FROM libra_runs').all(),works:db.prepare("SELECT work_kind,state FROM fx_supporting_works WHERE state<>'succeeded'").all(),events:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE state NOT IN ('succeeded','skipped')").all(),failures:db.prepare('SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    const sharedPendingEvents=shared?db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref LIKE 'arca.series_presentation.%' AND state NOT IN ('succeeded','failed','cancelled','skipped')").get().n:0,sharedFailedEvents=shared?db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref LIKE 'arca.series_presentation.%' AND state='failed'").get().n:0;
    const summary={sharedPendingEvents,sharedFailedEvents,sharedVersions:shared?db.prepare('SELECT scope_id,revision,manifest_digest FROM arca_series_presentation_versions').all():[],sharedReferences:shared?db.prepare('SELECT * FROM arca_series_presentation_references').all():[],entry,materials:db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? ORDER BY material_key').all(entry.shelf_entry_id,entry.current_inventory_revision),
      commits:db.prepare('SELECT * FROM arca_ondeck_commit_receipts ORDER BY rowid').all(),
      offload:db.prepare('SELECT * FROM libra_offload_context_materials').all(),
      produced:db.prepare("SELECT r.result_json FROM fx_event_result_bindings r JOIN fx_workflow_events e ON e.event_id=r.event_id WHERE e.capability_ref='libra.media.transcode@1' ORDER BY e.event_id").all(),
      integrationCalls,foreignKeys:db.pragma('foreign_key_check'),integrity:db.pragma('integrity_check')[0].integrity_check};
    process.stdout.write('\nSERIES_EXTERNAL_RESTART_RESULT='+JSON.stringify(summary)+'\n');
  } finally {await host.close();db.close();}
})().catch(error=>{process.stderr.write(String(error.stack||error)+'\n'+JSON.stringify(error.details||{}));process.exitCode=1;});
