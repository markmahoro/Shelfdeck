'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {planTestJobs,executeTestJobs,summaryOf}=require('../../scripts/helix-architecture/test-execution');
const serviceRoot=path.resolve(__dirname,'../..');
function fixture(t,source){const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-test-job-plan-')),dir=path.join(root,'test/helix-architecture');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'jav-host-journey.test.js'),source);
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-test-job-plan-'));fs.rmSync(root,{recursive:true,force:true});});return root;}
test('all actual JAV cases are selected exactly once with original order in each shard and no extra parallel files',()=>{
  const file='test/helix-architecture/jav-host-journey.test.js',jobs=planTestJobs({serviceRoot,files:[file,'test/helix-architecture/clean-skeleton.test.js']}),shards=jobs.filter(job=>job.selectedNames),
    declared=[...fs.readFileSync(path.join(serviceRoot,file),'utf8').matchAll(/^test\('([^'\\\r\n]+)'\s*,/gm)].map(match=>match[1]),all=shards.flatMap(job=>job.selectedNames);
  assert.equal(shards.length,4);assert.equal(new Set(all).size,declared.length);assert.deepEqual([...all].sort(),[...declared].sort());assert.equal(jobs.length,5);
  for(const name of declared)assert.equal(shards.filter(job=>new RegExp(job.pattern).test(name)).length,1);
  for(const job of shards)assert.deepEqual(job.selectedNames,[...job.selectedNames].sort((a,b)=>declared.indexOf(a)-declared.indexOf(b)));
});
test('unsupported or duplicate declarations fail closed and regex characters do not expand selection',t=>{
  for(const source of ["test('same',()=>{});\ntest('same',()=>{});","test('literal',()=>{});\ntest(dynamicName,()=>{});","test.skip('skipped',()=>{});"]){const root=fixture(t,source);assert.throws(()=>planTestJobs({serviceRoot:root,files:['test/helix-architecture/jav-host-journey.test.js']}),/unsupported declarations cannot be omitted/);}
  const root=fixture(t,"test('literal (a+b). [x]',()=>{});\ntest('other',()=>{});"),job=planTestJobs({serviceRoot:root,files:['test/helix-architecture/jav-host-journey.test.js']})[0];
  assert.equal(new RegExp(job.pattern).test('literal (a+b). [x]'),true);assert.equal(new RegExp(job.pattern).test('literal aaabZ x'),false);
  assert.throws(()=>planTestJobs({serviceRoot:root,files:['../outside.test.js']}),/escapes/);
});
test('bounded execution preserves a failing child and runs every planned file without exceeding four active processes',async()=>{
  let active=0,peak=0;const seen=[];
  const jobs=Array.from({length:9},(_,index)=>({file:'test/helix-architecture/f'+index+'.test.js',pattern:null,selectedNames:null}));
  const result=await executeTestJobs({serviceRoot,jobs,spawnProcess(_binary,args,options){
    assert.equal(options.env.NODE_TEST_CONTEXT,undefined);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    const file=args.at(-1);seen.push(file);peak=Math.max(peak,++active);setTimeout(()=>{const failed=file.endsWith('f3.test.js');
      child.stdout.write('# tests 1\n# pass '+(failed?0:1)+'\n# fail '+(failed?1:0)+'\n# skipped 0\n');active--;child.emit('close',failed?1:0,null);},5);return child;
  }});
  assert.equal(result.ok,false);assert.equal(peak,4);assert.equal(seen.length,jobs.length);assert.equal(result.counts.tests,9);assert.equal(result.counts.fail,1);assert.equal(result.jobs[3].status,1);
});
test('TAP accounting subtracts only explicit name filtering and rejects incomplete shard execution',async()=>{
  assert.deepEqual(summaryOf('# tests 3\n# pass 1\n# fail 0\n# skipped 2\nok 2 # SKIP test name does not match pattern\nok 3 # SKIP missing optional fixture\n'),{tests:3,pass:1,fail:0,skipped:2,filtered:1});
  assert.throws(()=>summaryOf('partial test output'),/complete TAP/);
  const result=await executeTestJobs({serviceRoot,jobs:[{file:'fake.test.js',selectedNames:['first','missing'],pattern:'any'}],spawnProcess(){
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();queueMicrotask(()=>{child.stdout.write('# tests 1\n# pass 1\n# fail 0\n# skipped 0\n');child.emit('close',0,null);});return child;
  }});assert.equal(result.ok,false);assert.match(result.jobs[0].error,/every selected test/);
});
