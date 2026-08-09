'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('./helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { FINGERPRINT_SAMPLE_BYTES } = require('../src/helix/integrations/bounded-material-fingerprint');

function emit(kind,value={}){process.stdout.write(JSON.stringify({kind,at:new Date().toISOString(),...value})+'\n');}
function grouped(database,table,column){return database.prepare(`SELECT ${column} state,count(*) count FROM ${table} GROUP BY ${column} ORDER BY ${column}`).all();}
function size(location){try{return fs.statSync(location).size;}catch{return 0;}}
function count(database, table){return database.prepare(`SELECT count(*) count FROM ${table}`).get().count;}
function sourceReality(root){
  const pending=[root],facts=[];
  while(pending.length){const directory=pending.pop(),entries=fs.readdirSync(directory,{withFileTypes:true});
    entries.sort((left,right)=>Buffer.compare(Buffer.from(left.name,'utf8'),Buffer.from(right.name,'utf8')));
    for(const entry of entries){const location=path.join(directory,entry.name);if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()){pending.push(location);continue;}if(!entry.isFile())continue;
      const stat=fs.statSync(location,{bigint:true});facts.push([path.relative(root,location).replace(/\\/g,'/'),String(stat.ino),String(stat.size),String(stat.mtimeNs),String(stat.ctimeNs)]);}}
  facts.sort((left,right)=>Buffer.compare(Buffer.from(left[0],'utf8'),Buffer.from(right[0],'utf8')));
  return Object.freeze({regularFileCount:facts.length,digest:canonicalDigest({schema:'helix.canary.source-reality@1',facts})});
}
function snapshot(databasePath){const database=new Database(databasePath,{readonly:true});try{
  const runs=grouped(database,'proc_procurement_runs','state');
  const works=grouped(database,'fx_supporting_works','state');
  return {
  observations:database.prepare('SELECT count(*) count FROM proc_field_observations').get().count,
  materials:database.prepare('SELECT count(*) count FROM proc_field_materials').get().count,
  observationWorkState:database.prepare("SELECT state FROM fx_supporting_works WHERE work_kind='field_observation' ORDER BY created_at_ms DESC LIMIT 1").get()?.state||null,
  runs,runCount:runs.reduce((total,row)=>total+row.count,0),sealedRuns:runs.find((row)=>row.state==='sealed')?.count||0,
  works,
  plans:count(database,'fx_workflow_plans'),events:grouped(database,'fx_workflow_events','state'),
  attempts:count(database,'fx_event_attempts'),results:count(database,'fx_event_result_bindings'),
  resourceTimings:count(database,'fx_event_resource_timings'),resourceDefers:count(database,'fx_resource_defer'),
  structurePages:database.prepare("SELECT count(*) count FROM fx_event_result_bindings WHERE outcome_kind='succeeded' AND result_schema_ref='helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result'").get().count,
  candidates:count(database,'proc_candidate_packages'),
  offers:database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='open'").get().count,
  consumedOffers:database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state!='open'").get().count,
  libraFacts:count(database,'libra_subjects')+count(database,'libra_runs')+count(database,'libra_material_bindings'),
  arcaFacts:count(database,'arca_shelf_entries')+count(database,'arca_ondeck_runs')+count(database,'arca_material_bindings')+
    count(database,'arca_deck_fact_revisions'),
  failedWorks:database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE state='failed'").get().count,
  failedEvents:database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE state='failed'").get().count,
  dbBytes:size(databasePath),walBytes:size(databasePath+'-wal')};}finally{database.close();}}
function timingSummary(timing){
  const elapsed=(timestamp)=>timestamp===null?null:timestamp-timing.canaryStartedAtMs;
  const fromAdmission=(timestamp)=>timestamp===null||timing.observationAdmittedAtMs===null?null:timestamp-timing.observationAdmittedAtMs;
  return Object.freeze({
    canaryStartedAt:new Date(timing.canaryStartedAtMs).toISOString(),
    sourceBeforeCompletedAt:timing.sourceBeforeCompletedAtMs===null?null:new Date(timing.sourceBeforeCompletedAtMs).toISOString(),
    observationAdmittedAt:timing.observationAdmittedAtMs===null?null:new Date(timing.observationAdmittedAtMs).toISOString(),
    observationTerminalAt:timing.observationTerminalAtMs===null?null:new Date(timing.observationTerminalAtMs).toISOString(),
    firstStructureAt:timing.firstStructureAtMs===null?null:new Date(timing.firstStructureAtMs).toISOString(),
    firstCandidateAt:timing.firstCandidateAtMs===null?null:new Date(timing.firstCandidateAtMs).toISOString(),
    firstOfferAt:timing.firstOfferAtMs===null?null:new Date(timing.firstOfferAtMs).toISOString(),
    allRunsSealedAt:timing.allRunsSealedAtMs===null?null:new Date(timing.allRunsSealedAtMs).toISOString(),
    terminalReachedAt:timing.terminalReachedAtMs===null?null:new Date(timing.terminalReachedAtMs).toISOString(),
    completedAt:timing.completedAtMs===null?null:new Date(timing.completedAtMs).toISOString(),
    elapsedMs:Object.freeze({
      sourceBefore:timing.sourceBeforeCompletedAtMs===null?null:elapsed(timing.sourceBeforeCompletedAtMs),
      observationFromAdmission:fromAdmission(timing.observationTerminalAtMs),
      firstStructure:elapsed(timing.firstStructureAtMs),
      firstCandidate:elapsed(timing.firstCandidateAtMs),
      firstOffer:elapsed(timing.firstOfferAtMs),
      allRunsSealed:elapsed(timing.allRunsSealedAtMs),
      terminal:elapsed(timing.terminalReachedAtMs),
      total:elapsed(timing.completedAtMs),
    }),
  });
}
function terminal(value){const open=new Set(['admitted','ready','running','blocked']);return value.observations>0&&value.runs.length>0&&
  value.runs.every((row)=>row.state==='sealed')&&value.works.every((row)=>!open.has(row.state));}
async function session(host,key){const response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':key}});
  if(response.statusCode!==204)throw new Error('Admin session failed: '+response.body);return response.headers['set-cookie'];}

async function main(){const root=path.resolve(process.argv[2]||'');if(!root||!fs.statSync(root).isDirectory())throw new Error('Usage: node scripts/helix-local-procurement-canary.js <movie-field-root>');
  const timing={canaryStartedAtMs:Date.now(),sourceBeforeCompletedAtMs:null,observationAdmittedAtMs:null,observationTerminalAtMs:null,
    firstStructureAtMs:null,firstCandidateAtMs:null,firstOfferAtMs:null,allRunsSealedAtMs:null,terminalReachedAtMs:null,completedAtMs:null};
  const sourceBefore=sourceReality(root);timing.sourceBeforeCompletedAtMs=Date.now();
  const fingerprintReads=new Map();let logicalReadBytes=0,readCalls=0;
  function onFingerprintRead(read){
    if(read.requestedBytes>FINGERPRINT_SAMPLE_BYTES||read.bytesRead>FINGERPRINT_SAMPLE_BYTES)throw Object.assign(new Error('Physical Material read exceeded 256 KiB.'),{code:'CANARY_FINGERPRINT_READ_LIMIT_EXCEEDED'});
    const next=(fingerprintReads.get(read.location)||0)+read.bytesRead;fingerprintReads.set(read.location,next);
    logicalReadBytes+=read.bytesRead;readCalls+=1;
    if(next>FINGERPRINT_SAMPLE_BYTES||logicalReadBytes>fingerprintReads.size*FINGERPRINT_SAMPLE_BYTES)throw Object.assign(new Error('Canary cumulative Physical Material read exceeded N x 256 KiB.'),{code:'CANARY_FINGERPRINT_TOTAL_LIMIT_EXCEEDED'});
  }
  const canaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'helix-full-movie-canary-')),dataDir=path.join(canaryRoot,'data'),adminDistDir=path.join(canaryRoot,'admin');
  fs.mkdirSync(adminDistDir,{recursive:true});fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const secretRoot='helix-local-canary-'+crypto.randomUUID();const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot});
  const databasePath=path.join(dataDir,'shelfdeck.db');let runtimeError=null,closing=false,restarted=false;
  const hostOptions={dataDir,adminDistDir,secretRoot,onPhysicalMaterialFingerprintRead:onFingerprintRead,
    onExecutionRuntimeError(error){runtimeError=error;emit('runtime_error',{code:error.code||error.name,message:error.message});}};
  let host=await createCleanServiceHost(hostOptions);
  async function close(){if(closing)return;closing=true;await host.close();}
  process.once('SIGINT',()=>close().finally(()=>process.exit(130)));process.once('SIGTERM',()=>close().finally(()=>process.exit(143)));
  try{const cookie=await session(host,initialized.adminApiKey),fieldId='full-movie-canary',policyValue={includedDirectories:[],excludedDirectories:[],
      // A BDMV Candidate needs its bounded topology members in the same
      // Admission: Playlist, ClipInfo, index/MovieObject and Stream payload.
      // The canary policy therefore admits those structural extensions and
      // does not apply the movie-sized minimum to metadata members.
      allowedExtensions:['.avi','.bdmv','.clpi','.m2ts','.mkv','.mov','.mp4','.mpls','.ts'],minimumSizeBytes:0,excludedMaterialKeys:[]};
    const policyBasis={extractionPolicyId:'full-movie-canary-policy',revision:1,...policyValue};const accessBasis={fieldId,revision:1,
      endpointId:'local-readonly-'+canonicalDigest(root).slice(0,16),rootLocation:root,mountScopeId:'local-canary-mount-'+canonicalDigest(root).slice(0,16),
      mountScopeRevision:1,accessSchemaRef:'helix://canary/local-readonly-field/v1'};
    const created=await host.inject({method:'POST',url:'/v1/admin/material-fields',headers:{cookie},payload:{idempotencyKey:'full-movie-canary-register',fieldId,
      name:'Full Movie Read-only Canary',contentProfileHint:'movie',policy:{extractionPolicyId:policyBasis.extractionPolicyId,revision:1,
        policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy:policyValue,policyDigest:canonicalDigest(policyBasis)},
      access:{...accessBasis,accessDigest:canonicalDigest(accessBasis)}}});if(created.statusCode!==201)throw new Error('Field registration failed: '+created.body);
    const observed=await host.inject({method:'POST',url:`/v1/admin/material-fields/${fieldId}/actions/observe`,headers:{cookie},payload:{
      idempotencyKey:'full-movie-canary-observe',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:100}});
    if(observed.statusCode!==202)throw new Error('Observation admission failed: '+observed.body);
    timing.observationAdmittedAtMs=Date.now();
    emit('started',{root,canaryRoot,databasePath,sourceBefore,observation:observed.json().observation,timing:timingSummary(timing)});let previousCpu=process.cpuUsage(),previousAt=Date.now(),previousReadBytes=0;
    while(true){await new Promise((resolve)=>setTimeout(resolve,10000));const now=Date.now(),cpu=process.cpuUsage(previousCpu),elapsedMs=now-previousAt;
      previousCpu=process.cpuUsage();previousAt=now;const facts=snapshot(databasePath),memory=process.memoryUsage();emit('progress',{...facts,
        logicalReadBytes,fingerprintedRegularFiles:fingerprintReads.size,readCalls,
        fingerprintBytesPerSecond:Math.round((logicalReadBytes-previousReadBytes)/(elapsedMs/1000)),
        maximumAllowedReadBytes:fingerprintReads.size*FINGERPRINT_SAMPLE_BYTES,
        rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,cpuPercent:Number(((cpu.user+cpu.system)/1000/elapsedMs*100).toFixed(2))});previousReadBytes=logicalReadBytes;
      if(timing.observationTerminalAtMs===null&&facts.observationWorkState==='succeeded'){timing.observationTerminalAtMs=now;emit('milestone',{name:'observation_terminal',timing:timingSummary(timing)});}
      if(timing.firstStructureAtMs===null&&facts.structurePages>0){timing.firstStructureAtMs=now;emit('milestone',{name:'first_structure_page',timing:timingSummary(timing)});}
      if(timing.firstCandidateAtMs===null&&facts.candidates>0){timing.firstCandidateAtMs=now;emit('milestone',{name:'first_candidate_package',timing:timingSummary(timing)});}
      if(timing.firstOfferAtMs===null&&facts.offers>0){timing.firstOfferAtMs=now;emit('milestone',{name:'first_handoff_a_offer',timing:timingSummary(timing)});}
      if(timing.allRunsSealedAtMs===null&&facts.runCount>0&&facts.sealedRuns===facts.runCount){timing.allRunsSealedAtMs=now;emit('milestone',{name:'all_runs_sealed',timing:timingSummary(timing)});}
      if(!restarted&&facts.observations>=2&&!terminal(facts)){emit('restart_begin',{observations:facts.observations,logicalReadBytes});await host.close();host=await createCleanServiceHost(hostOptions);restarted=true;emit('restart_complete',{observations:facts.observations});}
      if(runtimeError)throw runtimeError;
      if(facts.failedWorks>0||facts.failedEvents>0)throw Object.assign(new Error('Foundation Work or Event failed during Canary.'),{code:'CANARY_FOUNDATION_FAILURE'});
      if(facts.consumedOffers>0||facts.libraFacts>0||facts.arcaFacts>0)throw Object.assign(new Error('Canary crossed the Handoff A Ready boundary.'),{code:'CANARY_SCOPE_BOUNDARY_VIOLATION'});
      if(terminal(facts)){timing.terminalReachedAtMs=Date.now();emit('complete',{...facts,canaryRoot,databasePath,timing:timingSummary(timing)});break;}}
    const sourceAfter=sourceReality(root);if(sourceAfter.digest!==sourceBefore.digest||sourceAfter.regularFileCount!==sourceBefore.regularFileCount)throw Object.assign(new Error('Movie Field reality changed during read-only Canary.'),{code:'CANARY_SOURCE_REALITY_CHANGED'});
    const finalDatabase=new Database(databasePath,{readonly:true});const integrity=finalDatabase.pragma('integrity_check',{simple:true});finalDatabase.close();
    if(integrity!=='ok')throw Object.assign(new Error('Canary database integrity_check failed.'),{code:'CANARY_DATABASE_INTEGRITY_FAILED'});
    timing.completedAtMs=Date.now();
    emit('source_verified',{sourceAfter,logicalReadBytes,fingerprintedRegularFiles:fingerprintReads.size,restarted,timing:timingSummary(timing)});
    emit('timing_summary',{timing:timingSummary(timing),sourceBefore,sourceAfter,restarted});
  }finally{await close();}}

main().catch((error)=>{emit('fatal',{code:error.code||error.name,message:error.message,stack:error.stack});process.exitCode=1;});
