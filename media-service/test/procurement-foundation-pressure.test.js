'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const secretRoot='procurement-foundation-pressure-secret-20260802';
const candidatesPerScope=Number(process.env.HELIX_PRESSURE_CANDIDATES_PER_SCOPE||250);
const expectedCandidateCount=candidatesPerScope*4;

function mediaProbe(){return Object.freeze({async probe(readHandle){const value={resultKind:'probed',
  sourceHandleDigest:canonicalDigest(readHandle),durationMs:1000,videoStreams:[{streamIndex:0,codec:'hevc',
    dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null,payloadDigest:''};
  value.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='payloadDigest')));
  return Object.freeze(value);}});}

async function authenticate(host,apiKey){const response=await host.inject({method:'POST',url:'/v1/admin/session',
  headers:{'x-api-key':apiKey}});assert.equal(response.statusCode,204,response.body);return response.headers['set-cookie'];}

test(`${expectedCandidateCount} Candidate demand stays below the hard cap while completion Work publishes before all Runs seal`,async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-procurement-pressure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),sourceRoot=path.join(root,'source');
  fs.mkdirSync(adminDistDir,{recursive:true});fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const bytes=Buffer.from('bounded-read-only-pressure-fixture');
  for(let group=0;group<4;group+=1){const directory=path.join(sourceRoot,'group-'+group);fs.mkdirSync(directory,{recursive:true});
    for(let ordinal=0;ordinal<candidatesPerScope;ordinal+=1)fs.writeFileSync(path.join(directory,
      `Movie.${group}.${String(ordinal).padStart(3,'0')}.mkv`),bytes);}
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot});
  const policyValue={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  const policyBasis={extractionPolicyId:'pressure-policy',revision:1,...policyValue};
  const accessBasis={fieldId:'pressure-field',revision:1,endpointId:'pressure-endpoint',rootLocation:sourceRoot,
    mountScopeId:'pressure-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/pressure-access/v1'};
  let runtimeError=null;
  const host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,mediaProbe:mediaProbe(),
    onExecutionRuntimeError(error){runtimeError=error;}});
  try{
    const cookie=await authenticate(host,initialized.adminApiKey);
    const created=await host.inject({method:'POST',url:'/v1/admin/material-fields',headers:{cookie},payload:{
      idempotencyKey:'pressure-register',fieldId:accessBasis.fieldId,name:'Pressure Field',contentProfileHint:'movie',
      policy:{extractionPolicyId:policyBasis.extractionPolicyId,revision:1,
        policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy:policyValue,policyDigest:canonicalDigest(policyBasis)},
      access:{...accessBasis,accessDigest:canonicalDigest(accessBasis)}}});
    assert.equal(created.statusCode,201,created.body);
    const observed=await host.inject({method:'POST',url:'/v1/admin/material-fields/pressure-field/actions/observe',headers:{cookie},payload:{
      idempotencyKey:'pressure-observe',fieldId:'pressure-field',expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:32}});
    assert.equal(observed.statusCode,202,observed.body);
    const startedAtMs=Date.now(),deadline=startedAtMs+300_000;let sawEarlyOffer=false,maxOpenWorks=0,last={};
    while(Date.now()<deadline){
      const db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
      const structureRows=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result'").all();
      last={runs:db.prepare('SELECT count(*) count FROM proc_procurement_runs').get().count,
        sealed:db.prepare("SELECT count(*) count FROM proc_procurement_runs WHERE state='sealed'").get().count,
        evidenceOpen:db.prepare("SELECT count(*) count FROM fx_supporting_works WHERE work_kind='evidence_assessment' AND state!='succeeded'").get().count,
        candidateWorks:db.prepare("SELECT count(*) count FROM fx_supporting_works WHERE work_kind='candidate_assembly'").get().count,
        candidates:db.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count,
        offers:db.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='open'").get().count,
        openWorks:db.prepare("SELECT count(*) count FROM fx_supporting_works WHERE state NOT IN ('succeeded','failed','cancelled')").get().count,
        failedWorks:db.prepare("SELECT count(*) count FROM fx_supporting_works WHERE state='failed'").get().count,
        failedEvents:db.prepare("SELECT count(*) count FROM fx_workflow_events WHERE state='failed'").get().count,
        resolvedUnits:structureRows.reduce((sum,row)=>sum+(JSON.parse(row.result_json).units?.length||0),0)};db.close();
      maxOpenWorks=Math.max(maxOpenWorks,last.openWorks);
      sawEarlyOffer ||= last.candidates>0&&last.sealed<last.runs;
      if(runtimeError||last.runs===1&&last.sealed===1&&last.candidates===expectedCandidateCount)break;
      await new Promise((resolve)=>setTimeout(resolve,25));
    }
    assert.ifError(runtimeError);assert.deepEqual(last,{...last,runs:1,sealed:1,candidates:expectedCandidateCount,offers:expectedCandidateCount,failedWorks:0,failedEvents:0});
    assert.ok(last.candidateWorks>256,`candidate demand did not exceed the hard cap: ${JSON.stringify(last)}`);
    assert.equal(sawEarlyOffer,true,JSON.stringify(last));
    assert.ok(maxOpenWorks<=256,`maxOpenWorks=${maxOpenWorks}`);
    t.diagnostic(`${expectedCandidateCount}-candidate elapsedMs=${Date.now()-startedAtMs} maxOpenWorks=${maxOpenWorks}`);
  }finally{await host.close();}
  for(const group of fs.readdirSync(sourceRoot))for(const name of fs.readdirSync(path.join(sourceRoot,group)))
    assert.deepEqual(fs.readFileSync(path.join(sourceRoot,group,name)),bytes);
});
