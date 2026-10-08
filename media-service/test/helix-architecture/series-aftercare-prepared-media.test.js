'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {evaluatePreparedSeriesSpace}=require('../../src/helix/domains/arca/model/aftercare-verified-media');
function member(materialKey,sizeBytes,keys) {
  return {materialKey,sizeBytes,role:'primary_payload',episodeClaims:keys.map(episodeKey=>({episodeKey}))};
}
function output(source,sizeBytes,name=source) {
  const physicalIdentity={mountScopeId:'workspace',inode:name,sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',
    fingerprintVersion:1,contentFingerprint:canonicalDigest(name)};
  return {target:{materialKey:source},output:{workspaceMaterialHandle:{physicalIdentity,sizeBytes,
    materialKey:canonicalDigest({schema:'physical-material-identity@2',...physicalIdentity})}}};
}
const space=()=>({members:[member('shared',14,['E01','E02']),member('part',4,['E01']),member('untouched',9,['E03'])],
  episodeKeys:['E01','E02','E03'],maxSizeBytes:10});

test('Series prepared space includes retained parts and equal shares of replacement files',()=>{
  const result=evaluatePreparedSeriesSpace(space(),[output('shared',12)]);
  assert.deepEqual(result.map(item=>item.allocatedBytes),[
    {numerator:'10',denominator:'1'},{numerator:'6',denominator:'1'},{numerator:'9',denominator:'1'}]);
  assert.ok(result.every(item=>item.withinLimit));
  assert.deepEqual(evaluatePreparedSeriesSpace({...space(),members:space().members.reverse()},[output('shared',12)]),result);
});
test('Series prepared space refuses a half-byte overrun instead of rounding down',()=>{
  assert.throws(()=>evaluatePreparedSeriesSpace(space(),[output('shared',13)]),
    error=>error.code==='ARCA_AFTERCARE_SERIES_FINAL_SPACE_UNMET');
  assert.throws(()=>evaluatePreparedSeriesSpace({...space(),members:[...space().members.slice(0,2),member('untouched',11,['E03'])]},
    [output('shared',12)]),error=>error.code==='ARCA_AFTERCARE_SERIES_FINAL_SPACE_UNMET');
});
test('Series prepared space refuses duplicate source, physical output, foreign source and inconsistent measured size',()=>{
  for(const outputs of [[output('shared',12),output('shared',10)],
    [output('shared',6,'same'),output('part',6,'same')],[output('foreign',0)]])
    assert.throws(()=>evaluatePreparedSeriesSpace(space(),outputs));
  const changed=output('shared',12);changed.output.workspaceMaterialHandle.sizeBytes=10;
  assert.throws(()=>evaluatePreparedSeriesSpace(space(),[changed]),/physical identity/);
  assert.ok(evaluatePreparedSeriesSpace({...space(),maxSizeBytes:null},[output('shared',100)]).every(item=>item.withinLimit));
});
