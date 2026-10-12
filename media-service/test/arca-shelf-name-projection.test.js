'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const schemaManifest=require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const {createArcaShelfAdminApplication}=require('../src/helix/domains/arca/application/shelf-admin-facade');

test('Formation shelf names remain Arca-owned and do not hydrate inventory or deregistration summaries',()=>{
  const calls=[];
  const app=createArcaShelfAdminApplication({schemaManifest,
    targetFolderProbe:{inspect(){throw new Error('No physical inspection expected');},inspectRoot(){throw new Error('No physical inspection expected');}},
    shelfDeregistrationStore:{summary(){throw new Error('No deregistration summary expected');}},
    unitOfWork:{execute(participants){return Object.fromEntries(participants.map(participant=>[participant.participantId,
      participant.execute({repository(repositoryId){return {invoke(statement){calls.push([repositoryId,statement]);
        assert.equal(statement,'list_shelves');return [{shelf_id:'active',name:'Current name',status:'active'},
          {shelf_id:'retired',name:'Historical name',status:'deregistered'}];}};}})]));}},
  });
  assert.deepEqual(app.listShelfNames(),{items:[{shelfId:'active',name:'Current name'},{shelfId:'retired',name:'Historical name'}]});
  assert.deepEqual(calls,[['arca_shelf_repository','list_shelves']]);
});
