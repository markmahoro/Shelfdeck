'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Module,createRequire}=require('node:module');

function isolated(file,extra){const instance=new Module(file);instance.require=createRequire(file);
  instance._compile(fs.readFileSync(file,'utf8')+'\n'+extra,file);return instance.exports;}

test('bounded normalization memo preserves Unicode, profiles, coercion, invalid inputs and eviction',()=>{
  const store=isolated(require.resolve('../src/helix/domains/perception/persistence/perception-store'),
    'module.exports={...module.exports,normalizeAnchor,cache:anchorNormalizationCache};');
  const aliases=isolated(require.resolve('../src/helix/domains/perception/model/perception-aliases'),
    'module.exports={...module.exports,cache:aliasNormalizationCache};');
  const input='  İ ΣΟΣ ﬃ Ａ\u00a0';
  assert.equal(store.normalizeAnchor(input,'unicode_nfkc_casefold'),'i\u0307 σος ffi a');
  assert.equal(store.normalizeAnchor(input,'alphanumeric_casefold'),'iσοςffia');
  assert.equal(store.normalizeAnchor(input,'unicode_nfkc_casefold'),'i\u0307 σος ffi a');
  assert.equal(store.cache.size,2);
  assert.throws(()=>store.normalizeAnchor({toJSON:()=>input},'unicode_nfkc_casefold'),TypeError);
  assert.throws(()=>store.normalizeAnchor(input,'unknown'),error=>error.code==='P6_PERCEPTION_NORMALIZATION_PROFILE_UNKNOWN');
  assert.equal(aliases.normalizeAlias(input),'i\u0307 σος ffi a');
  const mutable={value:'Ａ',toString(){return this.value;}};
  assert.equal(aliases.normalizeAlias(mutable),'a');mutable.value='Ｂ';assert.equal(aliases.normalizeAlias(mutable),'b');
  for(let i=0;i<8300;i++){
    assert.equal(store.normalizeAnchor('TEXT '+i,'unicode_nfkc_casefold'),'text '+i);
    assert.equal(aliases.normalizeAlias('ＴＥＸＴ '+i),'text '+i);
  }
  assert.equal(store.cache.size,8192);assert.equal(aliases.cache.size,8192);
  assert.equal(store.normalizeAnchor(input,'unicode_nfkc_casefold'),'i\u0307 σος ffi a');
  assert.equal(aliases.normalizeAlias(input),'i\u0307 σος ffi a');
  assert.equal(store.cache.size,8192);assert.equal(aliases.cache.size,8192);
});
