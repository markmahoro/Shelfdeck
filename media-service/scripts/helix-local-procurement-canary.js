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

const EXPECTED_Z_FILM_FILE_COUNT = 18409;
const EXPECTED_LOGICAL_READ_BYTES = 1776871724;
const PERFORMANCE_LIMITS_MS = Object.freeze({ firstOffer:163100, allRunsSealed:385900, total:393200 });
let canaryLogPath = null;
function emit(kind,value={}){const line=JSON.stringify({kind,at:new Date().toISOString(),...value})+'\n';process.stdout.write(line);
  if(canaryLogPath)fs.appendFileSync(canaryLogPath,line);}
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
  const selectionScopes=database.prepare(`SELECT selection_scope_kind scopeKind,
    COUNT(DISTINCT procurement_run_id || ':' || selection_scope_ordinal) scopeCount,
    COUNT(*) physicalMemberCount FROM proc_run_materials GROUP BY selection_scope_kind ORDER BY selection_scope_kind`).all();
  return {
  observations:database.prepare('SELECT count(*) count FROM proc_field_observations').get().count,
  observationEntries:database.prepare('SELECT count(*) count FROM proc_field_observation_entries').get().count,
  materials:database.prepare('SELECT count(*) count FROM proc_field_materials').get().count,
  eligibilityStates:grouped(database,'proc_field_materials','eligibility_state'),
  eligibilityRevisionSum:database.prepare('SELECT COALESCE(sum(eligibility_revision),0) value FROM proc_field_materials').get().value,
  observationWorkState:database.prepare("SELECT state FROM fx_supporting_works WHERE work_kind='field_observation' ORDER BY created_at_ms DESC LIMIT 1").get()?.state||null,
  runs,runCount:runs.reduce((total,row)=>total+row.count,0),sealedRuns:runs.find((row)=>row.state==='sealed')?.count||0,
  runSelections:database.prepare(`SELECT procurement_run_id procurementRunId,state,selected_material_count physicalMemberCount,
    selection_scope_count selectionScopeCount FROM proc_procurement_runs ORDER BY procurement_run_id`).all(),
  selectionScopes,selectionScopeCount:selectionScopes.reduce((total,row)=>total+row.scopeCount,0),
  selectedPhysicalMembers:selectionScopes.reduce((total,row)=>total+row.physicalMemberCount,0),
  works,
  plans:count(database,'fx_workflow_plans'),events:grouped(database,'fx_workflow_events','state'),
  capabilityEvents:database.prepare(`SELECT capability_ref capabilityRef,state,count(*) count FROM fx_workflow_events
    GROUP BY capability_ref,state ORDER BY capability_ref,state`).all(),
  attempts:count(database,'fx_event_attempts'),results:count(database,'fx_event_result_bindings'),
  resourceTimings:count(database,'fx_event_resource_timings'),resourceDefers:count(database,'fx_resource_defer'),
  structurePages:database.prepare("SELECT count(*) count FROM fx_event_result_bindings WHERE outcome_kind='succeeded' AND result_schema_ref='helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result'").get().count,
  candidates:count(database,'proc_candidate_packages'),
  candidateSources:database.prepare(`SELECT p.material_input_form materialInputForm,rm.selection_scope_kind scopeKind,
    COUNT(DISTINCT p.candidate_package_id) count FROM proc_candidate_packages p
    JOIN proc_candidate_primary_materials pm ON pm.candidate_package_id=p.candidate_package_id
    JOIN proc_run_materials rm ON rm.procurement_run_id=p.procurement_run_id AND rm.material_key=pm.material_key
    GROUP BY p.material_input_form,rm.selection_scope_kind ORDER BY p.material_input_form,rm.selection_scope_kind`).all(),
  relatedReferences:count(database,'proc_candidate_related_references'),
  relatedRoles:database.prepare('SELECT role,count(*) count FROM proc_candidate_related_references GROUP BY role ORDER BY role').all(),
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

function finalProcurementVerification(databasePath){const database=new Database(databasePath,{readonly:true});try{
  const facts=snapshot(databasePath);const failures=[];
  const scopeByKind=new Map(facts.selectionScopes.map((row)=>[row.scopeKind,row]));
  const duplicateSelections=database.prepare(`SELECT count(*) count FROM (SELECT material_key FROM proc_run_materials
    GROUP BY material_key HAVING count(*)>1)`).get().count;
  const allPrimaryRows=database.prepare(`SELECT p.candidate_package_id candidatePackageId,p.display_identity displayIdentity,
    p.material_input_form materialInputForm,p.procurement_run_id procurementRunId,pm.material_key materialKey,
    rm.field_relative_location fieldRelativeLocation,rm.selection_scope_kind scopeKind
    FROM proc_candidate_packages p JOIN proc_candidate_primary_materials pm ON pm.candidate_package_id=p.candidate_package_id
    JOIN proc_run_materials rm ON rm.procurement_run_id=p.procurement_run_id AND rm.material_key=pm.material_key
    ORDER BY p.candidate_package_id,pm.ordinal`).all();
  const appleRows=allPrimaryRows.filter((row)=>String(row.fieldRelativeLocation).replace(/\\/g,'/').toLocaleLowerCase('en-US')==='苹果.mkv');
  const applePackageIds=[...new Set(appleRows.map((row)=>row.candidatePackageId))];
  const appleDetails=applePackageIds.map((candidatePackageId)=>{
    const packageRow=database.prepare(`SELECT p.candidate_package_id candidatePackageId,p.display_identity displayIdentity,
      p.material_input_form materialInputForm,d.state offerState FROM proc_candidate_packages p
      LEFT JOIN proc_candidate_deliveries d ON d.candidate_package_id=p.candidate_package_id
      WHERE p.candidate_package_id=?`).get(candidatePackageId);
    const relatedReferences=database.prepare('SELECT role,location FROM proc_candidate_related_references WHERE candidate_package_id=? ORDER BY role,location').all(candidatePackageId);
    return {...packageRow,primaryMemberCount:database.prepare('SELECT count(*) count FROM proc_candidate_primary_materials WHERE candidate_package_id=?').get(candidatePackageId).count,
      relatedReferenceCount:relatedReferences.length,relatedReferences};
  });
  const internalRelated=database.prepare('SELECT candidate_package_id candidatePackageId,location FROM proc_candidate_related_references').all()
    .filter((row)=>{const value=String(row.location).replace(/\\/g,'/').toUpperCase();return /\/(?:BDMV|CERTIFICATE)\//.test('/'+value)||
      /\.(?:M2TS|MPLS|CLPI)$/.test(value)||/(?:^|\/)(?:INDEX|MOVIEOBJECT)\.BDMV$/.test(value);});
  const streamTitles=database.prepare("SELECT count(*) count FROM proc_candidate_packages WHERE upper(display_identity)='STREAM'").get().count;
  const bdmvCandidates=database.prepare("SELECT count(DISTINCT p.candidate_package_id) count FROM proc_candidate_packages p JOIN proc_candidate_primary_materials pm ON pm.candidate_package_id=p.candidate_package_id JOIN proc_run_materials rm ON rm.procurement_run_id=p.procurement_run_id AND rm.material_key=pm.material_key WHERE rm.selection_scope_kind='bdmv_container'").get().count;
  if(facts.observations!==72)failures.push(`observation_pages:${facts.observations}!=72`);
  if(facts.observationEntries!==EXPECTED_Z_FILM_FILE_COUNT||facts.materials!==EXPECTED_Z_FILM_FILE_COUNT)failures.push(`observation_entries_or_materials:${facts.observationEntries}/${facts.materials}`);
  if(facts.selectionScopeCount!==922)failures.push(`selection_scopes:${facts.selectionScopeCount}!=922`);
  if(facts.selectedPhysicalMembers!==8627)failures.push(`selected_physical_members:${facts.selectedPhysicalMembers}!=8627`);
  if((scopeByKind.get('bdmv_container')?.scopeCount||0)!==59)failures.push(`bdmv_scopes:${scopeByKind.get('bdmv_container')?.scopeCount||0}!=59`);
  if(facts.runCount!==10||facts.sealedRuns!==facts.runCount)failures.push(`runs:${facts.runCount}/sealed:${facts.sealedRuns}`);
  if(facts.runSelections.some((run)=>run.physicalMemberCount<1||run.physicalMemberCount>1024))failures.push('run_physical_member_bound');
  if(duplicateSelections!==0)failures.push(`duplicate_run_selections:${duplicateSelections}`);
  if(facts.candidates!==943||facts.offers!==943)failures.push(`candidate_offer_count:${facts.candidates}/${facts.offers}!=943/943`);
  if(bdmvCandidates!==59)failures.push(`bdmv_candidates:${bdmvCandidates}!=59`);
  if(streamTitles!==0)failures.push(`stream_title_candidates:${streamTitles}`);
  if(internalRelated.length!==0)failures.push(`bdmv_internal_related:${internalRelated.length}`);
  if(appleDetails.length!==1)failures.push(`apple_candidate_count:${appleDetails.length}`);
  else {const apple=appleDetails[0],related=apple.relatedReferences||[];if(apple.displayIdentity!=='苹果'||apple.materialInputForm!=='stream_file'||
      apple.offerState!=='open'||apple.primaryMemberCount!==1||apple.relatedReferenceCount!==1||related[0]?.role!=='nfo'||
      !String(related[0]?.location||'').replace(/\\/g,'/').toLocaleLowerCase('en-US').endsWith('/苹果.nfo'))
    failures.push(`apple_candidate_shape:${JSON.stringify(apple)}`);}
  return Object.freeze({ok:failures.length===0,failures:Object.freeze(failures),facts,duplicateSelections,bdmvCandidates,
    streamTitles,internalRelated:Object.freeze(internalRelated),apple:Object.freeze(appleDetails)});
}finally{database.close();}}

async function main(){const root=path.resolve(process.argv[2]||'');if(!root||!fs.statSync(root).isDirectory())throw new Error('Usage: node scripts/helix-local-procurement-canary.js <movie-field-root>');
  const timing={canaryStartedAtMs:Date.now(),sourceBeforeCompletedAtMs:null,observationAdmittedAtMs:null,observationTerminalAtMs:null,
    firstStructureAtMs:null,firstCandidateAtMs:null,firstOfferAtMs:null,allRunsSealedAtMs:null,terminalReachedAtMs:null,completedAtMs:null};
  const sourceBefore=sourceReality(root);timing.sourceBeforeCompletedAtMs=Date.now();
  if(sourceBefore.regularFileCount!==EXPECTED_Z_FILM_FILE_COUNT)throw Object.assign(
    new Error(`Expected ${EXPECTED_Z_FILM_FILE_COUNT} regular files before Canary, found ${sourceBefore.regularFileCount}.`),
    {code:'CANARY_SOURCE_BASELINE_MISMATCH'});
  const fingerprintReads=new Map();let logicalReadBytes=0,readCalls=0;
  function onFingerprintRead(read){
    if(read.requestedBytes>FINGERPRINT_SAMPLE_BYTES||read.bytesRead>FINGERPRINT_SAMPLE_BYTES)throw Object.assign(new Error('Physical Material read exceeded 256 KiB.'),{code:'CANARY_FINGERPRINT_READ_LIMIT_EXCEEDED'});
    const next=(fingerprintReads.get(read.location)||0)+read.bytesRead;fingerprintReads.set(read.location,next);
    logicalReadBytes+=read.bytesRead;readCalls+=1;
    if(next>FINGERPRINT_SAMPLE_BYTES||logicalReadBytes>fingerprintReads.size*FINGERPRINT_SAMPLE_BYTES)throw Object.assign(new Error('Canary cumulative Physical Material read exceeded N x 256 KiB.'),{code:'CANARY_FINGERPRINT_TOTAL_LIMIT_EXCEEDED'});
  }
  const canaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'helix-full-movie-canary-')),dataDir=path.join(canaryRoot,'data'),adminDistDir=path.join(canaryRoot,'admin');
  canaryLogPath=path.join(canaryRoot,'canary.ndjson');
  fs.mkdirSync(adminDistDir,{recursive:true});fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const secretRoot='helix-local-canary-'+crypto.randomUUID();const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot});
  const databasePath=path.join(dataDir,'shelfdeck.db');let runtimeError=null,closing=false,restarted=false;
  const procurementMetrics={reconcileBatchCount:0,reconcileMaterialKeys:0,eligibilityDecisionWrites:0,eligibilityNoOpCount:0,eligibilityStaleCount:0};
  const hostOptions={dataDir,adminDistDir,secretRoot,procurementMetrics,onPhysicalMaterialFingerprintRead:onFingerprintRead,
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
      idempotencyKey:'full-movie-canary-observe',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:256}});
    if(observed.statusCode!==202)throw new Error('Observation admission failed: '+observed.body);
    timing.observationAdmittedAtMs=Date.now();
    emit('started',{root,canaryRoot,databasePath,canaryLogPath,sourceBefore,observation:observed.json().observation,timing:timingSummary(timing)});let previousCpu=process.cpuUsage(),previousAt=Date.now(),previousReadBytes=0;
    let maxRssBytes=0,lastDurableProgressAt=Date.now(),lastDurableProgressSignature=null;
    while(true){await new Promise((resolve)=>setTimeout(resolve,10000));const now=Date.now(),cpu=process.cpuUsage(previousCpu),elapsedMs=now-previousAt;
      previousCpu=process.cpuUsage();previousAt=now;const facts=snapshot(databasePath),memory=process.memoryUsage();maxRssBytes=Math.max(maxRssBytes,memory.rss);
      const durableProgressSignature=JSON.stringify({observations:facts.observations,observationEntries:facts.observationEntries,
        runs:facts.runs,works:facts.works,events:facts.events,attempts:facts.attempts,results:facts.results,candidates:facts.candidates,offers:facts.offers});
      if(durableProgressSignature!==lastDurableProgressSignature){lastDurableProgressSignature=durableProgressSignature;lastDurableProgressAt=now;}
      emit('progress',{...facts,
        logicalReadBytes,fingerprintedRegularFiles:fingerprintReads.size,readCalls,
        fingerprintBytesPerSecond:Math.round((logicalReadBytes-previousReadBytes)/(elapsedMs/1000)),
        maximumAllowedReadBytes:fingerprintReads.size*FINGERPRINT_SAMPLE_BYTES,
        eligibilityMetrics:{...procurementMetrics},
        rssBytes:memory.rss,maxRssBytes,heapUsedBytes:memory.heapUsed,cpuPercent:Number(((cpu.user+cpu.system)/1000/elapsedMs*100).toFixed(2))});previousReadBytes=logicalReadBytes;
      if(timing.observationTerminalAtMs===null&&facts.observationWorkState==='succeeded'){timing.observationTerminalAtMs=now;emit('milestone',{name:'observation_terminal',timing:timingSummary(timing)});}
      if(timing.firstStructureAtMs===null&&facts.structurePages>0){timing.firstStructureAtMs=now;emit('milestone',{name:'first_structure_page',timing:timingSummary(timing)});}
      if(timing.firstCandidateAtMs===null&&facts.candidates>0){timing.firstCandidateAtMs=now;emit('milestone',{name:'first_candidate_package',timing:timingSummary(timing)});}
      if(timing.firstOfferAtMs===null&&facts.offers>0){timing.firstOfferAtMs=now;emit('milestone',{name:'first_handoff_a_offer',timing:timingSummary(timing)});}
      if(timing.allRunsSealedAtMs===null&&facts.runCount>0&&facts.sealedRuns===facts.runCount){timing.allRunsSealedAtMs=now;emit('milestone',{name:'all_runs_sealed',timing:timingSummary(timing)});}
      if(!restarted&&facts.observations>=2&&!terminal(facts)){emit('restart_begin',{observations:facts.observations,logicalReadBytes});await host.close();host=await createCleanServiceHost(hostOptions);restarted=true;emit('restart_complete',{observations:facts.observations});}
      if(runtimeError)throw runtimeError;
      if(memory.rss>2*1024*1024*1024)throw Object.assign(new Error('Canary RSS exceeded 2 GiB.'),{code:'CANARY_RSS_LIMIT_EXCEEDED'});
      if(now-lastDurableProgressAt>10*60*1000&&facts.resourceDefers===0)throw Object.assign(new Error('Canary made no durable progress for 10 minutes without Resource defer.'),{code:'CANARY_UNEXPLAINED_STALL'});
      if(facts.failedWorks>0||facts.failedEvents>0)throw Object.assign(new Error('Foundation Work or Event failed during Canary.'),{code:'CANARY_FOUNDATION_FAILURE'});
      if(facts.consumedOffers>0||facts.libraFacts>0||facts.arcaFacts>0)throw Object.assign(new Error('Canary crossed the Handoff A Ready boundary.'),{code:'CANARY_SCOPE_BOUNDARY_VIOLATION'});
      if(terminal(facts)){timing.terminalReachedAtMs=Date.now();emit('complete',{...facts,eligibilityMetrics:{...procurementMetrics},canaryRoot,databasePath,canaryLogPath,maxRssBytes,timing:timingSummary(timing)});break;}}
    const sourceAfter=sourceReality(root);if(sourceAfter.digest!==sourceBefore.digest||sourceAfter.regularFileCount!==sourceBefore.regularFileCount)throw Object.assign(new Error('Movie Field reality changed during read-only Canary.'),{code:'CANARY_SOURCE_REALITY_CHANGED'});
    if(fingerprintReads.size!==EXPECTED_Z_FILM_FILE_COUNT||readCalls!==EXPECTED_Z_FILM_FILE_COUNT||logicalReadBytes!==EXPECTED_LOGICAL_READ_BYTES)
      throw Object.assign(new Error(`Observation read baseline differs: files=${fingerprintReads.size}, calls=${readCalls}, bytes=${logicalReadBytes}.`),
        {code:'CANARY_OBSERVATION_READ_BASELINE_MISMATCH'});
    const finalDatabase=new Database(databasePath,{readonly:true});const integrity=finalDatabase.pragma('integrity_check',{simple:true});finalDatabase.close();
    if(integrity!=='ok')throw Object.assign(new Error('Canary database integrity_check failed.'),{code:'CANARY_DATABASE_INTEGRITY_FAILED'});
    timing.completedAtMs=Date.now();
    const summary=timingSummary(timing);const verification=finalProcurementVerification(databasePath);
    const performance={limitsMs:PERFORMANCE_LIMITS_MS,actualMs:{firstOffer:summary.elapsedMs.firstOffer,
      allRunsSealed:summary.elapsedMs.allRunsSealed,total:summary.elapsedMs.total},failures:[]};
    for(const [metric,limit] of Object.entries(PERFORMANCE_LIMITS_MS))if(performance.actualMs[metric]===null||performance.actualMs[metric]>limit)
      performance.failures.push(`${metric}:${performance.actualMs[metric]}>${limit}`);
    emit('source_verified',{sourceAfter,logicalReadBytes,fingerprintedRegularFiles:fingerprintReads.size,readCalls,restarted,maxRssBytes,
      eligibilityMetrics:{...procurementMetrics},verification,performance,timing:summary});
    emit('timing_summary',{timing:summary,sourceBefore,sourceAfter,restarted,verification,performance,canaryRoot,databasePath,canaryLogPath});
    if(!verification.ok)throw Object.assign(new Error('Canary correctness verification failed: '+verification.failures.join(', ')),{code:'CANARY_CORRECTNESS_FAILED'});
    if(performance.failures.length)throw Object.assign(new Error('Canary exceeded the approved 15% performance line: '+performance.failures.join(', ')),{code:'CANARY_PERFORMANCE_REGRESSION'});
  }finally{await close();}}

main().catch((error)=>{emit('fatal',{code:error.code||error.name,message:error.message,stack:error.stack,canaryLogPath});process.exitCode=1;});
