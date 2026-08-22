'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {candidateWorkPrefixLengthByProbe}=require('../../src/helix/domains/procurement/application/procurement-run-coordinator');

const root=path.resolve(__dirname,'../..');
function source(relative){return fs.readFileSync(path.join(root,relative),'utf8');}

test('product Procurement path uses the typed construction port and never mounts the synchronous coordinator',()=>{
  const host=source('src/clean-service-host.js');
  const composition=source('src/helix/composition/create-procurement-execution-runtime.js');
  assert.doesNotMatch(host,/createMovieRunCoordinator|movieRunCoordinator/);
  const publicEntry=source('src/helix/domains/procurement/public/index.js');
  assert.match(composition,/ProcurementExecutionRegistration/);
  assert.match(publicEntry,/createProcurementRunCoordinator/);
  assert.match(publicEntry,/createFieldObservationAutomation/);
  assert.match(composition,/['"]evidence_assessment['"]/);
  assert.match(composition,/['"]candidate_assembly['"]/);
  assert.match(composition,/active-material-fields/);
  assert.match(composition,/due-aftercare-shelf-entries/);
});

test('Procurement Run Coordinator only reads terminal facts and issues Work',()=>{
  const coordinator=source('src/helix/domains/procurement/application/procurement-run-coordinator.js');
  for(const forbidden of ['executor-dispatcher','event-runtime','resource-governor','movie-run-coordinator',
    'require\\([^)]*capabilities','createRepositoryDefinition','beginEvent','completeEvent','\\.execute\\(']){
    assert.doesNotMatch(coordinator,new RegExp(forbidden),forbidden);
  }
  assert.match(coordinator,/createWorkAdmission/);
  assert.match(coordinator,/evidenceIndex\.read/);
  assert.match(coordinator,/workResultReader\.listWorks/);
  assert.match(coordinator,/globalOpenWorks:256/);
  assert.match(coordinator,/candidate_work_deferred/);
  assert.doesNotMatch(coordinator,/globalOpenWorks:\s*1_?000/);
});

test('Candidate Work admission frontier uses logarithmic durable probes instead of replaying an entire large Run',()=>{
  let probes=0;
  const prefix=candidateWorkPrefixLengthByProbe(943,(ordinal)=>{probes+=1;return ordinal<517;});
  assert.equal(prefix,517);
  assert.ok(probes<=10,`probes=${probes}`);
  assert.equal(candidateWorkPrefixLengthByProbe(0,()=>{throw new Error('empty prefix must not probe');}),0);
});
