'use strict';
const { bindingScopePredicate } = require('../model/material-binding-scope');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createMaterialBindingScopeReader(options) {
  const repository = createRepositoryDefinition({ repositoryId:'libra_binding_scope_read', owner:'libra', schemaManifest:options.schemaManifest,
    statements:{ bindings:{ kind:'select-all', tableId:'libra_material_bindings', columns:['material_key','location','binding_revision','health_state'], keyColumns:['endpoint_id','current'] } } });
  return Object.freeze({ read({ endpointId, directory }) {
    const matches = bindingScopePredicate({endpointId,directory});
    const rows = options.unitOfWork.execute([{ participantId:'libra_binding_scope_read', owner:'libra', repositories:[repository], execute(context) {
      return context.repository(repository.repositoryId).invoke('bindings', {endpoint_id:endpointId,current:1});
    } }]).libra_binding_scope_read.filter(matches);
    return Object.freeze({ ownerDomain:'libra', endpointId, directory, count:rows.length, digest:canonicalDigest(rows) });
  } });
}
module.exports = Object.freeze({ createMaterialBindingScopeReader });
