'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'../..');
function source(relative){return fs.readFileSync(path.join(root,relative),'utf8');}

test('product Procurement path uses the typed construction port and never mounts the synchronous coordinator',()=>{
  const host=source('src/clean-service-host.js');
  const composition=source('src/helix/composition/create-procurement-execution-runtime.js');
  assert.doesNotMatch(host,/createMovieRunCoordinator|movieRunCoordinator/);
  const publicEntry=source('src/helix/domains/procurement/public/index.js');
  assert.match(composition,/ProcurementExecutionRegistration/);
  assert.match(publicEntry,/createProcurementRunCoordinator/);
  assert.match(composition,/['"]evidence_assessment['"]/);
  assert.match(composition,/['"]candidate_assembly['"]/);
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
