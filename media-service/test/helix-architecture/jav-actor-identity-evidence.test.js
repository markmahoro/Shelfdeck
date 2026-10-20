'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {document,parseJavSourcePage}=require('../../src/helix/integrations/jav-source-pages');
function parse(links,code='IPX-177') {
  const html='<link rel="canonical" href="https://javdb.com/v/Fixture01"><div class="video-detail"><h2 class="title">IPX-177 Film</h2>'+
    '<div class="movie-panel-info"><div class="panel-block"><strong>番號：</strong><span class="value">IPX-177</span></div>'+
    '<div class="panel-block"><strong>演員：</strong><span class="value">'+links+'</span></div></div></div>';
  return parseJavSourcePage('javdb',code,document(Buffer.from(html)),'https://javdb.com');
}
test('verified JavDB Actor links preserve distinct provider identities despite the same display name',()=>{
  const value=parse('<a href="/actors/first">Same Name</a><a href="https://javdb.com/actors/second">Same Name</a><a href="/actors/first">Same Name</a>');
  assert.equal(value.identityVerified,true);assert.equal(value.peopleHints.length,2);
  assert.deepEqual(value.peopleHints.map(item=>item.providerIdentities),['first','second'].map(providerKey=>[{provider:'javdb',namespace:'javdb_actor',providerKey}]));
});
test('foreign, query-bearing, malformed and unverified Actor links remain weak evidence',()=>{
  for(const href of ['https://example.com/actors/first','/actors/first?next=second','/actors/first#second','/actors/first/extra','https://user:pass@javdb.com/actors/first','/actors/%66irst']) {
    const value=parse('<a href="'+href+'">Name</a>');
    assert.equal(value.peopleHints[0].displayName,'Name');assert.deepEqual(value.peopleHints[0].providerIdentities,[]);
  }
  const wrong=parse('<a href="/actors/first">Name</a>','IPX-178');
  assert.equal(wrong.identityVerified,false);assert.deepEqual(wrong.peopleHints[0].providerIdentities,[]);
});
