'use strict';

const { createRepositoryDefinition } = require('../../foundation/persistence/owner-repository');
const { createSecretReference } = require('../model/secret-reference');

function createSecretReferenceRepository(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    throw new TypeError('Schema manifest and Platform unit of work are required.');
  }
  const definition = createRepositoryDefinition({
    repositoryId: 'platform_secret_reference',
    owner: 'platform-settings',
    schemaManifest: options.schemaManifest,
    statements: {
      insert_reference: {
        kind: 'insert', tableId: 'platform_secret_refs',
        columns: ['secret_ref', 'owner_scope_type', 'owner_scope_id', 'secret_kind', 'encrypted_ref', 'revision', 'state', 'updated_at_ms']
      },
      find_reference: {
        kind: 'select-one', tableId: 'platform_secret_refs',
        columns: ['secret_ref', 'owner_scope_type', 'owner_scope_id', 'secret_kind', 'encrypted_ref', 'revision', 'state', 'updated_at_ms'],
        keyColumns: ['secret_ref']
      }
    }
  });

  function participant(execute) {
    return options.unitOfWork.execute([{
      participantId: 'platform_secret_reference', owner: 'platform-settings', repositories: [definition], execute
    }]).platform_secret_reference;
  }

  return Object.freeze({
    save(value) {
      const reference = createSecretReference(value);
      participant((context) => context.repository(definition.repositoryId).invoke('insert_reference', {
        secret_ref: reference.secretRef,
        owner_scope_type: reference.ownerScopeType,
        owner_scope_id: reference.ownerScopeId,
        secret_kind: reference.secretKind,
        encrypted_ref: reference.secretLocator,
        revision: reference.revision,
        state: reference.state,
        updated_at_ms: reference.updatedAtMs
      }));
      return reference;
    },
    find(secretRef) {
      const row = participant((context) => context.repository(definition.repositoryId).invoke('find_reference', { secret_ref: secretRef }));
      if (!row) return undefined;
      return createSecretReference({
        secretRef: row.secret_ref,
        ownerScopeType: row.owner_scope_type,
        ownerScopeId: row.owner_scope_id,
        secretKind: row.secret_kind,
        secretLocator: row.encrypted_ref,
        revision: row.revision,
        state: row.state,
        updatedAtMs: row.updated_at_ms
      });
    }
  });
}

module.exports = Object.freeze({ createSecretReferenceRepository });
