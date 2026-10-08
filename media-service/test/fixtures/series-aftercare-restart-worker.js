'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const root=process.argv[2],dataDir=path.join(root,'data');
const boundary=JSON.parse(fs.readFileSync(path.join(root,'aftercare-crash-boundary.json'),'utf8'));
(async()=>{
  let runtimeError;
  const host=await createCleanServiceHost({dataDir,adminDistDir:path.join(root,'admin'),secretRoot:'disposable-series-routing-secret',
    onExecutionRuntimeError(error){runtimeError=error;}}),db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try {
    const until=Date.now()+120000;let care;
    do {
      if(runtimeError)throw runtimeError;
      care=db.prepare('SELECT * FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(boundary.care.aftercare_case_id);
      if(care?.state==='resolved')break;
      if(['unresolved','invalidated'].includes(care?.state))throw new Error(JSON.stringify(care));
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<until);
    if(care?.state!=='resolved')throw new Error(JSON.stringify({care,
      failures:db.prepare('SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    const entry=db.prepare('SELECT * FROM arca_shelf_entries WHERE shelf_entry_id=?').get(boundary.entry.shelf_entry_id);
    const summary={entryId:entry.shelf_entry_id,entryStatus:entry.status,inventoryRevision:entry.current_inventory_revision,
      caseId:care.aftercare_case_id,caseState:care.state,
      commits:db.prepare('SELECT * FROM arca_aftercare_inventory_commits ORDER BY rowid').all(),
      materials:db.prepare('SELECT * FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? ORDER BY material_key').all(entry.shelf_entry_id,entry.current_inventory_revision),
      receipts:db.prepare('SELECT result_json FROM fx_event_result_bindings').all().map(row=>JSON.parse(row.result_json))
        .filter(result=>result.receiptKind==='aftercare_output_materialized'&&result.materialEffectKind==='primary_replace').sort((a,b)=>a.receiptId.localeCompare(b.receiptId)),
      foreignKeys:db.pragma('foreign_key_check'),integrity:db.pragma('integrity_check')[0].integrity_check};
    process.stdout.write('\nSERIES_AFTERCARE_RESTART_RESULT='+JSON.stringify(summary)+'\n');
  } finally {await host.close();db.close();}
})().catch(error=>{process.stderr.write(String(error.stack||error));process.exitCode=1;});
