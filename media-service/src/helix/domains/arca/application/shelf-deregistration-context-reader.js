'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createShelfDeregistrationStore } = require('../persistence/shelf-deregistration-store');

function createShelfDeregistrationContextReader(options) {
  const store=options.shelfDeregistrationStore||createShelfDeregistrationStore(options);
  function read(id){const process=store.read(id);if(!process)return null;const manifestRevision=process.manifest_revision===null?null:Number(process.manifest_revision);return Object.freeze({process,basisDigest:canonicalDigest({schema:'arca.shelf-deregistration-basis@1',deregistrationId:id,shelfId:process.shelf_id,manifestRevision,manifestDigest:process.release_manifest_digest??null,controlRevisionSetDigest:process.control_revision_set_digest??null})});}
  function page(id,revision,pageOrdinal){return store.page(id,revision,pageOrdinal);}
  function members(id,revision){return store.members(id,revision);}
  return Object.freeze({store,read,page,members,listActivePage:store.listActivePage});
}

module.exports=Object.freeze({createShelfDeregistrationContextReader});
