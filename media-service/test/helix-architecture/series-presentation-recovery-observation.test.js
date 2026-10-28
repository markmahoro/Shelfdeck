'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createSeriesPresentationCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/series-presentation-capability-ports');
const {CAPS}=require('../../src/helix/domains/arca/model/series-presentation');

function fixture(formal,observeWrites){
  const digest='a'.repeat(64),ref=formal?CAPS.publish:CAPS.assets;
  const source={schemaRef:'source',scopeDigest:digest,recipe:[],artifacts:[]};
  const context={work:{work_id:'work',owner_domain:'arca',process_type:'arca_series_presentation',process_id:'build'},
    event:{work_id:'work',capability_ref:ref},effect:{effect_class:formal?'material_commit':'workspace_write'},
    node:{capability_ref:ref,input_bindings_json:JSON.stringify({bindings:[{
      portName:formal?'seriesPresentationAssetsPrepared':'seriesPresentationSourceObserved',
      bindingKind:'projected_event_result',eventId:'predecessor',
    }]})}};
  let observations=0;
  const ports=createSeriesPresentationCapabilityPorts({
    seriesStore:{build:()=>({objectId:'build',digest})},seriesWorkspaceStore:{inspect:()=>({})},
    contractValidator:{validate(){}},workResultReader:{read:()=>[{
      eventId:'predecessor',outcomeKind:'succeeded',capabilityRef:formal?CAPS.assets:CAPS.source,result:source,
    }]},seriesIo:{observeWrites(...args){observations+=1;return observeWrites(...args);}},
  });
  return {context,observe:()=>ports[ref].observeEffectReality(context),observations:()=>observations};
}

for(const formal of [false,true]){
  test(`Series ${formal?'publication':'preparation'} keeps unreadable reality distinct from a real conflict`,async()=>{
    for(const code of ['EIO','EINVAL','ESTALE','PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED']){
      const fx=fixture(formal,()=>{throw Object.assign(new Error('unreadable'),{code,details:{causeCode:'EINVAL'}});});
      const observed=await fx.observe();
      assert.equal(observed.status,'unobservable');
      assert.equal(formal?observed.rollbackDeclared:observed.cleanupDeclared,false);
      assert.match(observed.evidenceDigest,/^[a-f0-9]{64}$/);
      assert.equal(fx.observations(),1);
    }
    const conflict=fixture(formal,()=>({status:'conflict',evidenceDigest:'b'.repeat(64)}));
    assert.equal((await conflict.observe()).status,'conflict');
    const unsafe=fixture(formal,()=>{throw Object.assign(new Error('symlink escaped root'),{code:'ARCA_SERIES_PATH_INVALID'});});
    assert.equal((await unsafe.observe()).status,'conflict');
  });

  test(`Series ${formal?'publication':'preparation'} rejects foreign recovery before touching its files`,async()=>{
    const fx=fixture(formal,()=>{throw new Error('must not read foreign files');});
    fx.context.work.owner_domain='libra';
    assert.equal((await fx.observe()).status,'conflict');
    assert.equal(fx.observations(),0);
  });
}
