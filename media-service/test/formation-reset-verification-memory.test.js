'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {canonicalDigest}=require('../src/helix/contracts/canonical-json');
const {digestRows}=require('../scripts/formation-reset-verify');

test('streamed collection protection keeps the existing canonical digest including exact SQLite integers',()=>{
  for(const rows of [[],[{z:3,a:'資料',nested:{z:2,a:[1,null,true]}}],
    [{id:9007199254740993n,bytes:Buffer.from('bytes')},{id:-1n,text:'quoted " value'}]]){
    const normalized=JSON.parse(JSON.stringify(rows,(_key,value)=>typeof value==='bigint'?{sqliteInteger:value.toString()}:value));
    assert.deepEqual(digestRows(rows.values()),{count:rows.length,digest:canonicalDigest(normalized)});
  }
  assert.notEqual(digestRows([{id:1},{id:2}]).digest,digestRows([{id:2},{id:1}]).digest);
});

test('large collection history verification stays bounded under a 48 MiB JavaScript heap',()=>{
  const script=`const {digestRows}=require(${JSON.stringify(path.resolve(__dirname,'../scripts/formation-reset-verify'))});
    function* rows(){for(let id=0;id<30000;id++)yield {id,metadata:'資料'.repeat(2048)};}
    const value=digestRows(rows());if(value.count!==30000)throw Error('Incomplete history');console.log(JSON.stringify(value));`;
  const child=spawnSync(process.execPath,['--max-old-space-size=48','-e',script],{encoding:'utf8',timeout:45000,windowsHide:true});
  assert.equal(child.status,0,child.stderr);assert.match(JSON.parse(child.stdout).digest,/^[a-f0-9]{64}$/);
});
