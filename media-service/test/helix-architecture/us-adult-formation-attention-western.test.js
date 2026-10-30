'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('western_adult Formation does not invent unresolved Attention from catalogue Basis alone',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/libra/application/formation-query.js'),'utf8');
  assert.doesNotMatch(source,/catalogueBasis&&!completion\)issue/);
  assert.match(source,/completion&&!completion\.winner/);
  assert.match(source,/us_adult_catalogue_registration_required/);
});
