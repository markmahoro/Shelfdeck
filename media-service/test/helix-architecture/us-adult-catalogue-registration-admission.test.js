'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultCatalogueRegistrationAdmission,pending}=
  require('../../src/helix/domains/people/application/us-adult-catalogue-registration-admission');

test('settlement short-circuits not_found without registerCataloguePerson',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/libra/application/us-adult-catalogue-settlement-coordinator.js'),'utf8');
  assert.match(source,/typeof options\.registerCataloguePerson!=='function'/);
  assert.match(source,/us_adult_catalogue_registration_required/);
});

test('People admission returns waiting_registration while evidence is pending',()=>{
  const waiting=createUsAdultCatalogueRegistrationAdmission({
    peopleStore:{readUsAdultPersonSnapshot(){return null;}},
    assembleEvidence:()=>pending('PEOPLE_CATALOGUE_EVIDENCE_PENDING','not ready'),
    register(){throw new Error('should not register');},
  }).registerCataloguePerson({
    input:{winner:{name:'Example Performer'}},inputDigest:D('input'),
    resolution:{kind:'not_found'},candidate:{},
  });
  assert.equal(waiting.kind,'waiting_registration');
  assert.equal(waiting.reasonCode,'us_adult_catalogue_registration_required');
});

test('People admission is a function Host can inject into settlement',()=>{
  const admission=createUsAdultCatalogueRegistrationAdmission({
    peopleStore:{readUsAdultPersonSnapshot(){return null;}},
    assembleEvidence:()=>({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_EVIDENCE_PENDING'}),
    register(){},
  });
  assert.equal(typeof admission.registerCataloguePerson,'function');
  const result=admission.registerCataloguePerson({
    input:{winner:{name:'A'}},inputDigest:D('i'),resolution:{kind:'not_found'},candidate:{},
  });
  assert.equal(result.kind,'waiting_registration');
});
