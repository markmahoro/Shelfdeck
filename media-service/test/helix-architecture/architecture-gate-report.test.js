'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runCheck,fixtureReport}=require('../../scripts/helix-architecture/gate-report');

test('a contract extraction exception fails the check while retaining completed fixture output',()=>{
  const check=runCheck('contract-baseline',()=>{throw new Error('Table count drift: expected 222, got 224');}),
    report=fixtureReport({status:0,stdout:'previous completed fixtures passed\n',stderr:''},['fixture.test.js'],[check]);
  assert.equal(check.ok,false);assert.equal(check.findings[0].code,'ARCHITECTURE_CHECK_EXCEPTION');
  assert.equal(check.findings[0].message,'Table count drift: expected 222, got 224');
  assert.equal(report.ok,true);assert.equal(report.failureOutput,'previous completed fixtures passed\n');
  assert.equal([check].every(item=>item.ok),false);
});
test('ordinary negative findings survive the Gate wrapper unchanged',()=>{
  const result={ok:false,findings:[{code:'OWNER_BOUNDARY_VIOLATION'}]};
  assert.equal(runCheck('boundaries',()=>result),result);
  assert.equal(runCheck('invalid-output',()=>undefined).ok,false);
});
test('a failed or interrupted fixture run retains output independently of successful post checks',()=>{
  const report=fixtureReport({status:null,signal:'SIGTERM',stdout:'partial fixture output',stderr:'execution stopped'},['fixture.test.js'],[{ok:true}]);
  assert.equal(report.ok,false);assert.equal(report.signal,'SIGTERM');assert.equal(report.failureOutput,'partial fixture outputexecution stopped');
  assert.equal(fixtureReport({status:0,error:{code:'ENOBUFS',message:'Output capture exceeded its bound.'}},[],[{ok:true}]).ok,false);
});
test('a successful fixture and all successful checks keep the compact PASS report',()=>{
  const report=fixtureReport({status:0,stdout:'pass'},['fixture.test.js'],[{ok:true}]);
  assert.equal(report.ok,true);assert.equal(report.exitCode,0);assert.equal(report.failureOutput,undefined);
});
