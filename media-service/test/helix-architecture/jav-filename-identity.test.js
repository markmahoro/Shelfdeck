'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {identifyJavFilename}=require('../../src/helix/domains/procurement/model/jav-filename-identity');
test('user filename corpus preserves the canonical code while recording explicitly named A/B parts',()=>{
  const cases=[['bokd-062-C.mp4','BOKD-062',null],['BXDR-015.wmv','BXDR-015',null],['CAWD-940ch.mp4','CAWD-940',null],
    ['DDT-548A.mp4','DDT-548','A'],['DDT-548B.mp4','DDT-548','B'],['JUR-510_CH-nyap2p.com.mp4','JUR-510',null],
    ['489155.com@JUR-749-C.mp4','JUR-749',null],['KUSE-043.mp4','KUSE-043',null],['NITR455.mp4','NITR-455',null],['RMER-056.H265.mp4','RMER-056',null]];
  for(const [name,javCode,multipartPart] of cases)assert.deepEqual(identifyJavFilename(name),{javCode,multipartPart},name);
});
test('filename variants cannot trim a reserved suffix, splice a malformed scope or choose one of conflicting codes',()=>{
  const cases=[['IBW-398Z.mp4','IBW-398Z'],['HEYDOUGA-4030-3073.mp4','HEYDOUGA-4030-3073'],['FC2-718323.mp4','FC2-718323'],
    ['FC2-718323-999.mp4',null],['HEYDOUGA-4030.mp4',null],['IPX-177 IPX-178.mp4',null],['IPX-17700Z.mp4',null],['Sample movie.mp4',null]];
  for(const [name,javCode] of cases)assert.deepEqual(identifyJavFilename(name),{javCode,multipartPart:null},name);
});
test('explicit CID locators never become a guessed JAV code while an independent real code remains a Claim',()=>{
  for(const name of ['CID=ipx00177.mkv','CID ipx00177.mkv','[CID]ipx00177.mkv','CID:ssis00698.mp4','h_086sdde00704.mkv'])
    assert.deepEqual(identifyJavFilename(name),{javCode:null,multipartPart:null},name);
  assert.deepEqual(identifyJavFilename('IPX-177 [CID=ipx00177].mkv'),{javCode:'IPX-177',multipartPart:null});
  assert.deepEqual(identifyJavFilename('NITR455 [CID]nitr00455.mkv'),{javCode:'NITR-455',multipartPart:null});
});
