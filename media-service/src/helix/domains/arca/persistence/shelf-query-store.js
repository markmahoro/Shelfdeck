'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createShelfQueryStore(options) {
  if (!options?.schemaManifest || !options?.unitOfWork) throw new TypeError('Arca Shelf query store requires clean persistence dependencies.');
  const repository = createRepositoryDefinition({ repositoryId: 'arca_shelf_query_repository', owner: 'arca', schemaManifest: options.schemaManifest, statements: {
    list_shelves: { kind: 'select-all', tableId: 'arca_shelves', columns: ['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','routing_projection_revision','routing_projection_digest','created_at_ms','updated_at_ms'], keyColumns: [] },
    find_shelf: { kind: 'select-one', tableId: 'arca_shelves', columns: ['shelf_id','name','target_endpoint_id','target_root_location','target_mount_scope_id','target_mount_scope_revision','status','current_standard_revision','current_placement_revision','routing_projection_revision','routing_projection_digest','created_at_ms','updated_at_ms'], keyColumns: ['shelf_id'] },
  } });
  const execute = (body) => options.unitOfWork.execute([{ participantId: 'arca_shelf_query', owner: 'arca', repositories: [repository], execute: body }]).arca_shelf_query;
  const map = (row) => row && Object.freeze({ shelfId: row.shelf_id, name: row.name, target: Object.freeze({ endpointId: row.target_endpoint_id, rootLocation: row.target_root_location, mountScopeId: row.target_mount_scope_id, mountScopeRevision: row.target_mount_scope_revision }), status: row.status, currentStandardRevision: row.current_standard_revision, currentPlacementRevision: row.current_placement_revision, routingProjection: Object.freeze({ revision: row.routing_projection_revision, digest: row.routing_projection_digest }), createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms });
  return Object.freeze({ repositoryManifest: Object.freeze({ component: 'ArcaShelfQueryRepository', repositoryId: repository.repositoryId, tableIds: repository.tableIds }), listShelves: () => execute((context) => context.repository(repository.repositoryId).invoke('list_shelves').map(map)), getShelf: (shelfId) => execute((context) => map(context.repository(repository.repositoryId).invoke('find_shelf', { shelf_id: shelfId }))) });
}

module.exports = Object.freeze({ createShelfQueryStore });
