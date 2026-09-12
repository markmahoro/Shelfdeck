'use strict';
const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createMaterialBindingScopeReader(options) {
  const repository = createRepositoryDefinition({ repositoryId:'arca_binding_scope_read', owner:'arca', schemaManifest:options.schemaManifest,
    statements:{ bindings:{ kind:'select-all', tableId:'arca_material_bindings', columns:['owner_object_id','material_key','location','binding_revision','health_state'], keyColumns:['endpoint_id','current'] } } });
  return Object.freeze({ read({ endpointId, directory }) {
    if (typeof endpointId !== 'string' || !endpointId || typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('Exact binding scope required.');
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    const root = normalize(directory);
    const rows = options.unitOfWork.execute([{ participantId:'arca_binding_scope_read', owner:'arca', repositories:[repository], execute(context) {
      return context.repository(repository.repositoryId).invoke('bindings', {endpoint_id:endpointId,current:1});
    } }]).arca_binding_scope_read.filter(row => row.health_state !== 'released' &&
      (normalize(row.location) === root || normalize(row.location).startsWith(root + path.sep)));
    return Object.freeze({ ownerDomain:'arca', endpointId, directory, count:rows.length, digest:canonicalDigest(rows) });
  } });
}
module.exports = Object.freeze({ createMaterialBindingScopeReader });
