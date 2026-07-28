'use strict';

const {
  createRepositoryDefinition,
} = require('../../foundation/persistence/owner-repository');
const {
  createSecretReference,
} = require('../model/secret-reference');

const INTEGRATION_COLUMNS = Object.freeze([
  'integration_id',
  'integration_type',
  'endpoint',
  'config_revision',
  'config_schema_ref',
  'config_json',
  'config_digest',
  'state',
  'updated_at_ms',
]);
const SECRET_COLUMNS = Object.freeze([
  'secret_ref',
  'owner_scope_type',
  'owner_scope_id',
  'secret_kind',
  'encrypted_ref',
  'revision',
  'state',
  'updated_at_ms',
]);

class IntegrationRepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IntegrationRepositoryError(code, message, details);
}

function configValue(row) {
  if (!row) return undefined;
  let config;
  try {
    config = JSON.parse(row.config_json);
  } catch (_error) {
    fail(
      'PLATFORM_INTEGRATION_CONFIG_CORRUPT',
      'Integration configuration JSON is invalid.',
    );
  }
  return Object.freeze({
    integrationId: row.integration_id,
    integrationType: row.integration_type,
    endpoint: row.endpoint,
    configRevision: row.config_revision,
    configSchemaRef: row.config_schema_ref,
    config,
    configDigest: row.config_digest,
    state: row.state,
    updatedAtMs: row.updated_at_ms,
  });
}

function secretValue(row) {
  if (!row) return undefined;
  return createSecretReference({
    secretRef: row.secret_ref,
    ownerScopeType: row.owner_scope_type,
    ownerScopeId: row.owner_scope_id,
    secretKind: row.secret_kind,
    secretLocator: row.encrypted_ref,
    revision: row.revision,
    state: row.state,
    updatedAtMs: row.updated_at_ms,
  });
}

function createIntegrationRepository(options) {
  if (!options?.schemaManifest || !options?.unitOfWork ||
      typeof options.unitOfWork.execute !== 'function') {
    throw new TypeError(
      'Schema manifest and Platform Unit of Work are required.',
    );
  }
  const definition = createRepositoryDefinition({
    repositoryId: 'platform_integration_runtime',
    owner: 'platform-settings',
    schemaManifest: options.schemaManifest,
    statements: {
      find_integration: {
        kind: 'select-one',
        tableId: 'platform_integrations',
        columns: INTEGRATION_COLUMNS,
        keyColumns: ['integration_id'],
      },
      insert_integration: {
        kind: 'insert',
        tableId: 'platform_integrations',
        columns: INTEGRATION_COLUMNS,
      },
      update_integration: {
        kind: 'update',
        tableId: 'platform_integrations',
        setColumns: [
          'endpoint',
          'config_revision',
          'config_schema_ref',
          'config_json',
          'config_digest',
          'state',
          'updated_at_ms',
        ],
        keyColumns: ['integration_id'],
        compareColumns: [{
          column: 'config_revision',
          parameter: 'expected_config_revision',
        }],
      },
      find_secret: {
        kind: 'select-one',
        tableId: 'platform_secret_refs',
        columns: SECRET_COLUMNS,
        keyColumns: ['secret_ref'],
      },
      insert_secret: {
        kind: 'insert',
        tableId: 'platform_secret_refs',
        columns: SECRET_COLUMNS,
      },
      update_secret: {
        kind: 'update',
        tableId: 'platform_secret_refs',
        setColumns: [
          'secret_kind',
          'encrypted_ref',
          'revision',
          'state',
          'updated_at_ms',
        ],
        keyColumns: ['secret_ref'],
        compareColumns: [{
          column: 'revision',
          parameter: 'expected_secret_revision',
        }],
      },
    },
  });

  function execute(callback) {
    return options.unitOfWork.execute([{
      participantId: 'platform_integration_runtime',
      owner: 'platform-settings',
      repositories: [definition],
      execute(context) {
        return callback(context.repository(definition.repositoryId));
      },
    }]).platform_integration_runtime;
  }

  function read(integrationId, secretRef) {
    return execute((repository) => Object.freeze({
      integration: configValue(repository.invoke('find_integration', {
        integration_id: integrationId,
      })),
      secret: secretValue(repository.invoke('find_secret', {
        secret_ref: secretRef,
      })),
    }));
  }

  function commit(value) {
    return execute((repository) => {
      const currentIntegration = repository.invoke('find_integration', {
        integration_id: value.integration.integration_id,
      });
      const currentSecret = repository.invoke('find_secret', {
        secret_ref: value.secret.secret_ref,
      });
      if (value.expectedRevision === 0) {
        if (currentIntegration || currentSecret) {
          fail(
            'PLATFORM_INTEGRATION_CAS_CONFLICT',
            'Integration initial revision already exists.',
          );
        }
        repository.invoke('insert_integration', value.integration);
        repository.invoke('insert_secret', value.secret);
      } else {
        if (!currentIntegration ||
            currentIntegration.config_revision !== value.expectedRevision ||
            !currentSecret ||
            currentSecret.revision !== value.expectedRevision) {
          fail(
            'PLATFORM_INTEGRATION_CAS_CONFLICT',
            'Integration or Secret Reference revision changed.',
          );
        }
        const integrationResult = repository.invoke(
          'update_integration',
          {
            ...value.integration,
            expected_config_revision: value.expectedRevision,
          },
        );
        const secretResult = repository.invoke('update_secret', {
          ...value.secret,
          expected_secret_revision: value.expectedRevision,
        });
        if (integrationResult.changes !== 1 || secretResult.changes !== 1) {
          fail(
            'PLATFORM_INTEGRATION_CAS_CONFLICT',
            'Integration commit lost its exact revision fence.',
          );
        }
      }
      return Object.freeze({
        integration: configValue(value.integration),
        secret: secretValue(value.secret),
      });
    });
  }

  return Object.freeze({
    commit,
    find(integrationId, secretRef) {
      return read(integrationId, secretRef);
    },
    findSecret(secretRef) {
      return execute((repository) => secretValue(
        repository.invoke('find_secret', { secret_ref: secretRef }),
      ));
    },
  });
}

module.exports = Object.freeze({
  IntegrationRepositoryError,
  createIntegrationRepository,
});
