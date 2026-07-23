'use strict';

const { createRepositoryDefinition } = require('../../foundation/persistence/owner-repository');

function createAdminCredentialRepository(options) {
  if (
    !options ||
    !options.schemaManifest ||
    !options.unitOfWork ||
    typeof options.unitOfWork.execute !== 'function' ||
    !options.expected
  ) {
    throw new TypeError('Schema manifest, Unit of Work, and expected schema identity are required.');
  }
  const definition = createRepositoryDefinition({
    repositoryId: 'platform_admin_credential_runtime',
    owner: 'platform-settings',
    schemaManifest: options.schemaManifest,
    statements: {
      read_schema_marker: {
        kind: 'select-one',
        tableId: 'platform_schema_marker',
        columns: ['schema_name', 'generation', 'schema_digest', 'catalog_digest', 'applied_at_ms'],
        keyColumns: ['schema_name'],
      },
      list_active_credentials: {
        kind: 'select-all',
        tableId: 'platform_admin_credentials',
        columns: [
          'credential_id',
          'revision',
          'secret_ref',
          'state',
          'created_at_ms',
          'last_used_at_ms',
          'terminal_at_ms',
        ],
        keyColumns: ['state'],
      },
      read_secret_reference: {
        kind: 'select-one',
        tableId: 'platform_secret_refs',
        columns: [
          'secret_ref',
          'owner_scope_type',
          'owner_scope_id',
          'secret_kind',
          'encrypted_ref',
          'revision',
          'state',
          'updated_at_ms',
        ],
        keyColumns: ['secret_ref'],
      },
    },
  });

  return Object.freeze({
    readActiveSnapshot() {
      return options.unitOfWork.execute([{
        participantId: 'platform_admin_credential_runtime',
        owner: 'platform-settings',
        repositories: [definition],
        execute(context) {
          const repository = context.repository(definition.repositoryId);
          const marker = repository.invoke('read_schema_marker', {
            schema_name: options.expected.schemaName,
          });
          const credentials = repository.invoke('list_active_credentials', { state: 'active' });
          const reference = credentials.length === 1
            ? repository.invoke('read_secret_reference', { secret_ref: credentials[0].secret_ref })
            : undefined;
          return Object.freeze({
            expected: options.expected,
            marker,
            credentials: Object.freeze(credentials),
            reference,
          });
        },
      }]).platform_admin_credential_runtime;
    },
  });
}

module.exports = Object.freeze({ createAdminCredentialRepository });
