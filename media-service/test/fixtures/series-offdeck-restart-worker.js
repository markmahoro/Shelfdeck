'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const root=process.argv[2],dataDir=path.join(root,'data');
(async()=>{
  let runtimeError;
  const host=await createCleanServiceHost({dataDir,adminDistDir:path.join(root,'admin'),secretRoot:'disposable-series-routing-secret',
    onExecutionRuntimeError(error){runtimeError=error;}}),db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try {
    const until=Date.now()+90000;let entry,care;
    do {
      if(runtimeError)throw runtimeError;
      entry=db.prepare('SELECT * FROM arca_shelf_entries').get();care=db.prepare('SELECT * FROM arca_offdeck_cases').get();
      if(entry?.status==='offdecked'&&care?.state==='completed')break;
      if(['blocked','awaiting_reauthorization'].includes(care?.state))throw new Error(JSON.stringify(care));
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<until);
    if(entry?.status!=='offdecked'||care?.state!=='completed')throw new Error(JSON.stringify({entry,care,
      failures:db.prepare('SELECT event_id,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    const summary={entryStatus:entry.status,caseState:care.state,deckRevision:entry.current_deck_fact_revision,
      terminalReceipts:db.prepare('SELECT count(*) n FROM arca_offdeck_terminal_receipts').get().n,
      controlled:db.prepare("SELECT count(*) n FROM fx_material_controls WHERE owner_scope_id=? AND state='controlled'").get(entry.shelf_entry_id).n,
      deletionEvidence:db.prepare('SELECT * FROM arca_offdeck_deletion_evidence ORDER BY material_key').all(),
      foreignKeys:db.pragma('foreign_key_check'),integrity:db.pragma('integrity_check')[0].integrity_check};
    process.stdout.write(JSON.stringify(summary));
  } finally {await host.close();db.close();}
})().catch(error=>{process.stderr.write(String(error.stack||error));process.exitCode=1;});
