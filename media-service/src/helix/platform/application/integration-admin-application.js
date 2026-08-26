'use strict';

const { canonicalDigest, canonicalJson } =
  require('../../contracts/canonical-json');
const {
  requireIntegrationProfile,
  SHA256,
  validateSummary,
} = require('./integration-profile-catalog');
const { validateConfig } = require('./integration-runtime');
const {
  buildMoviePilotLandingBinding,
  reviseMoviePilotLandingBinding,
  settings: normalizeMoviePilotLandingSettings,
} = require('./moviepilot-landing-binding');

const RECEIPT_KIND_CONFIGURE = 'configure';
const RECEIPT_KIND_SETTINGS_UPDATE = 'settings_update';
const RECEIPT_KIND_DISCONNECT = 'disconnect';
const CONNECTION_PROOF_TTL_MS = 120_000;

class IntegrationAdminError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationAdminError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IntegrationAdminError(code, message, details);
}

function exact(value, required, optional, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, 'Integration command must be a JSON object.');
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => !allowed.has(key))) {
    fail(code, 'Integration command must match the exact closed shape.');
  }
}

function idempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 1 ||
      value.length > 256 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) {
    fail(
      'PLATFORM_INTEGRATION_COMMAND_INVALID',
      'Integration idempotency key is invalid.',
    );
  }
  return value;
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      'PLATFORM_INTEGRATION_COMMAND_INVALID',
      'Integration expected revision is invalid.',
    );
  }
  return value;
}

function kind(value) {
  if (typeof value !== 'string' || !value || value.length > 64) {
    fail(
      'PLATFORM_INTEGRATION_KIND_INVALID',
      'Integration kind is invalid.',
    );
  }
  return value;
}

function assertSupported(profile, value) {
  if (kind(value) !== profile.kind) {
    fail(
      'PLATFORM_INTEGRATION_KIND_UNSUPPORTED',
      'Integration kind is not handled by this Platform application.',
      { kind: value },
    );
  }
}

function publicSnapshot(profile, snapshot) {
  if (!snapshot?.integration) {
    const result = {
      kind: profile.kind,
      supported: true,
      configured: false,
      state: 'unconfigured',
      configRevision: 0,
      endpoint: null,
      configDigest: null,
      capabilityCodes: Object.freeze([...profile.capabilityCodes]),
      lastTestSummary: null,
    };
    if (typeof profile.normalizeSettings === 'function') {
      result.settings = profile.normalizeSettings(undefined);
    }
    if (profile.kind === 'moviepilot') result.landingBinding = null;
    return Object.freeze(result);
  }
  const validated = validateConfig(snapshot, profile);
  const value = validated.integration;
  const result = {
    kind: profile.kind,
    supported: true,
    configured: value.state === 'active',
    state: value.state,
    configRevision: value.configRevision,
    endpoint: value.endpoint,
    configDigest: value.configDigest,
    capabilityCodes: Object.freeze([
      ...value.config.capabilityCodes,
    ]),
    lastTestSummary: Object.freeze({
      ...value.config.lastTestSummary,
    }),
  };
  if (typeof profile.normalizeSettings === 'function') {
    result.settings = profile.normalizeSettings(value.config.settings);
  }
  if (profile.kind === 'moviepilot') {
    result.landingBinding = value.config.landingBinding
      ? Object.freeze({ ...value.config.landingBinding })
      : null;
  }
  return Object.freeze(result);
}

function validateStoredPublicResult(profile, value) {
  const resultFields = [
    'kind', 'supported', 'configured', 'state', 'configRevision',
    'endpoint', 'configDigest', 'capabilityCodes', 'lastTestSummary',
  ];
  if (profile.kind === 'moviepilot') resultFields.push('landingBinding');
  const optionalFields = [];
  if (typeof profile.normalizeSettings === 'function') {
    optionalFields.push('settings');
  }
  exact(
    value,
    resultFields,
    optionalFields,
    'PLATFORM_INTEGRATION_COMMAND_RECEIPT_CORRUPT',
  );
  let endpoint = null;
  if (value.configRevision > 0) {
    try {
      endpoint = profile.normalizeEndpoint(value.endpoint);
    } catch (_error) {
      fail(
        'PLATFORM_INTEGRATION_COMMAND_RECEIPT_CORRUPT',
        'Stored Integration endpoint is invalid.',
      );
    }
  }
  if (value.kind !== profile.kind ||
      value.supported !== true ||
      typeof value.configured !== 'boolean' ||
      !['unconfigured', 'active', 'disabled'].includes(value.state) ||
      !Number.isSafeInteger(value.configRevision) ||
      value.configRevision < 0 ||
      (value.configRevision === 0
        ? value.endpoint !== null || value.configDigest !== null
        : value.endpoint !== endpoint ||
          !SHA256.test(value.configDigest || '')) ||
      value.configured !== (value.state === 'active') ||
      (value.configRevision === 0
        ? value.lastTestSummary !== null
        : !value.lastTestSummary) ||
      (profile.kind === 'moviepilot' &&
        value.configRevision > 0 && !value.landingBinding) ||
      JSON.stringify(value.capabilityCodes) !==
        JSON.stringify(profile.capabilityCodes)) {
    fail(
      'PLATFORM_INTEGRATION_COMMAND_RECEIPT_CORRUPT',
      'Stored Integration command result is invalid.',
    );
  }
  if (value.lastTestSummary) {
    try {
      validateSummary(profile, value.lastTestSummary);
    } catch (_error) {
      fail(
        'PLATFORM_INTEGRATION_COMMAND_RECEIPT_CORRUPT',
        'Stored Integration test summary is invalid.',
      );
    }
    if (value.lastTestSummary.endpointDigest !==
        canonicalDigest({ endpoint })) {
      fail(
        'PLATFORM_INTEGRATION_COMMAND_RECEIPT_CORRUPT',
        'Stored Integration test endpoint fence is invalid.',
      );
    }
  }
  const result = {
    ...value,
    capabilityCodes: Object.freeze([...value.capabilityCodes]),
    lastTestSummary: value.lastTestSummary
      ? Object.freeze({ ...value.lastTestSummary })
      : null,
  };
  if (typeof profile.normalizeSettings === 'function') {
    result.settings = profile.normalizeSettings(value.settings);
  }
  if (profile.kind === 'moviepilot') {
    result.landingBinding = value.landingBinding
      ? Object.freeze({ ...value.landingBinding })
      : null;
  }
  return Object.freeze(result);
}

function createIntegrationAdminApplication(options) {
  const profile = options?.profile || requireIntegrationProfile('tmdb');
  const adapter = options?.adapter || options?.tmdbAdapter;
  if (!options?.repository ||
      typeof options.repository.find !== 'function' ||
      typeof options.repository.commit !== 'function' ||
      !options?.secretStore ||
      typeof options.secretStore.write !== 'function' ||
      typeof options.secretStore.read !== 'function' ||
      typeof options.secretStore.requestDigest !== 'function' ||
      !adapter ||
      typeof adapter.testCandidate !== 'function' ||
      typeof adapter.normalizedEndpoint !== 'function' ||
      !options?.receiptRepository ||
      typeof options.receiptRepository.read !== 'function' ||
      typeof options.receiptRepository.commit !== 'function' ||
      typeof options.createId !== 'function') {
    throw new TypeError(
      'Integration Admin requires Platform Repository, Secret Store, ' +
      'provider adapter, receipt repository, and ID source.',
    );
  }
  const now = options.now || Date.now;
  const landingAccessAdapter = options.landingAccessAdapter;
  if (profile.kind === 'moviepilot' &&
      (!landingAccessAdapter ||
       typeof landingAccessAdapter.probe !== 'function')) {
    throw new TypeError(
      'MoviePilot Integration Admin requires an External Landing access adapter.',
    );
  }
  const reservedRoots = () => typeof options.reservedRoots === 'function'
    ? options.reservedRoots()
    : options.reservedRoots || [];
  const tests = new Map();
  const proofs = new Map();

  function current() {
    const snapshot = options.repository.find(
      profile.integrationId,
      profile.secretRef,
    );
    return snapshot.integration
      ? validateConfig(snapshot, profile)
      : snapshot;
  }

  function requestDigest(value) {
    return options.secretStore.requestDigest(canonicalJson(value));
  }

  function recordValidation(testKey, endpoint, status, error = null) {
    const snapshot = current();
    const result = Object.freeze({
      schemaRef:'helix://implementation-contracts/platform-integrations/validation-observation/v1',
      schemaVersion:1,
      kind:profile.kind,
      status,
      checkedAtMs:now(),
      endpointDigest:canonicalDigest({ endpoint }),
      configRevision:snapshot.integration?.configRevision || 0,
      errorCode:status === 'failed' ? String(error?.details?.causeCode || error?.code || 'PLATFORM_INTEGRATION_VALIDATION_FAILED') : null,
    });
    options.receiptRepository.commit({
      commandKind:'validation_observation',
      commandContract:commandContract('validation_observation'),
      idempotencyKey:'validation:' + testKey,
      integrationId:profile.integrationId,
      requestDigest:requestDigest({ command:'validation_observation', testKey, result }),
      result,
    });
    return result;
  }

  function withValidation(snapshot) {
    const value = publicSnapshot(profile, snapshot);
    const observation = options.receiptRepository.latestForTarget?.(
      profile.integrationId,
      (result) => result?.schemaRef === 'helix://implementation-contracts/platform-integrations/validation-observation/v1' &&
        result.kind === profile.kind,
    )?.result || null;
    return observation ? Object.freeze({ ...value, validation:Object.freeze({ ...observation }) }) : value;
  }

  function removeProof(proof) {
    proofs.delete(proof.connectionProofId);
    if (tests.get(proof.testIdempotencyKey)?.connectionProofId ===
        proof.connectionProofId) {
      tests.delete(proof.testIdempotencyKey);
    }
    try {
      options.secretStore.remove(proof.secretLocator);
    } catch (_ignored) {
      // A transient proof locator is not referenced by any runtime row.
    }
  }

  function proofAt(connectionProofId) {
    if (typeof connectionProofId !== 'string' ||
        connectionProofId.length < 1 ||
        connectionProofId.length > 256) {
      fail(
        'PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID',
        'Connection proof identity is invalid.',
      );
    }
    const proof = proofs.get(connectionProofId);
    if (!proof) {
      fail(
        'PLATFORM_INTEGRATION_CONNECTION_PROOF_UNKNOWN',
        'Connection proof is unknown or was already consumed.',
      );
    }
    const readAtMs = now();
    if (!Number.isSafeInteger(readAtMs) ||
        readAtMs < 0 ||
        readAtMs > proof.expiresAtMs) {
      removeProof(proof);
      fail(
        'PLATFORM_INTEGRATION_CONNECTION_PROOF_EXPIRED',
        'Connection proof has expired.',
      );
    }
    if (proof.kind !== profile.kind ||
        proof.endpoint !== profile.normalizeEndpoint(proof.endpoint) ||
        !profile.acceptedSecretKinds.includes(proof.secretKind) ||
        !SHA256.test(proof.secretEnvelopeDigest) ||
        !SHA256.test(proof.testRequestDigest) ||
        proof.secretRef !==
          'connection-proof:' + connectionProofId) {
      fail(
        'PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID',
        'Connection proof continuity is invalid.',
      );
    }
    return proof;
  }

  async function test(inputKind, body) {
    assertSupported(profile, inputKind);
    exact(
      body,
      ['kind', 'idempotencyKey', 'endpoint', 'credential'],
      ['settings', 'timeoutMs'],
      'PLATFORM_INTEGRATION_TEST_SHAPE',
    );
    if (body.kind !== inputKind) {
      fail(
        'PLATFORM_INTEGRATION_TARGET_MISMATCH',
        'URL and body Integration kinds differ.',
      );
    }
    const testKey = idempotencyKey(body.idempotencyKey);
    const prepared = profile.prepareCredential(
      body.credential,
      body.settings,
    );
    const landingProbe = profile.kind === 'moviepilot'
      ? landingAccessAdapter.probe({
          settings: prepared.settings,
          reservedRoots: reservedRoots(),
          now,
        })
      : null;
    const preparedSettings = landingProbe
      ? landingProbe.settings
      : prepared.settings;
    const endpoint = adapter.normalizedEndpoint(body.endpoint);
    const timeoutMs = body.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 60_000) {
      prepared.secretBytes.fill(0);
      fail(
        'PLATFORM_INTEGRATION_TEST_TIMEOUT_INVALID',
        'Integration test timeout is invalid.',
      );
    }
    const digest = requestDigest({
      command: 'test',
      kind: body.kind,
      idempotencyKey: testKey,
      endpoint,
      credentialKind: prepared.credentialKind,
      credentialBytesDigest: requestDigest(
        prepared.secretBytes.toString('base64'),
      ),
      settings: preparedSettings,
      timeoutMs,
    });
    const prior = tests.get(testKey);
    if (prior) {
      prepared.secretBytes.fill(0);
      if (prior.requestDigest !== digest) {
        fail(
          'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT',
          'Integration test idempotency key was reused.',
        );
      }
      const proof = proofs.get(prior.connectionProofId);
      if (proof && now() <= proof.expiresAtMs) {
        return prior.result;
      }
      if (proof) removeProof(proof);
      tests.delete(testKey);
    }

    let secretLocator;
    let persistedSecretBytes;
    let returnedPersistedSecretBytes;
    try {
      const candidateInput = {
        endpoint,
        secretKind: prepared.secretKind,
        secretBytes: prepared.secretBytes,
        timeoutMs,
      };
      if (Object.keys(preparedSettings).length > 0) {
        candidateInput.settings = preparedSettings;
      }
      const tested = await adapter.testCandidate(candidateInput);
      const summary = tested.summary || tested;
      validateSummary(profile, {
        result: 'passed',
        checkedAtMs: summary.checkedAtMs,
        endpointDigest: summary.endpointDigest,
        observationDigest: summary.observationDigest,
        identityNamespace: summary.identityNamespace,
        identityProviderKey: summary.identityProviderKey,
      });
      if (summary.endpointDigest !== canonicalDigest({ endpoint }) ||
          JSON.stringify(summary.capabilityCodes) !==
            JSON.stringify(profile.capabilityCodes)) {
        fail(
          'PLATFORM_INTEGRATION_TEST_RESULT_INVALID',
          'Integration test result does not match its profile.',
        );
      }
      returnedPersistedSecretBytes =
        Buffer.isBuffer(tested.persistedSecretBytes)
          ? tested.persistedSecretBytes
          : null;
      persistedSecretBytes = returnedPersistedSecretBytes
        ? Buffer.from(returnedPersistedSecretBytes)
        : Buffer.from(prepared.secretBytes);
      const secretKind = tested.persistedSecretKind ||
        prepared.secretKind;
      if (!profile.acceptedSecretKinds.includes(secretKind)) {
        fail(
          'PLATFORM_INTEGRATION_TEST_RESULT_INVALID',
          'Integration test returned an invalid persisted credential.',
        );
      }
      const connectionProofId = options.createId();
      const issuedAtMs = now();
      const expiresAtMs = issuedAtMs + CONNECTION_PROOF_TTL_MS;
      if (typeof connectionProofId !== 'string' ||
          connectionProofId.length < 1 ||
          connectionProofId.length > 256 ||
          !Number.isSafeInteger(issuedAtMs) ||
          issuedAtMs < 0 ||
          !Number.isSafeInteger(expiresAtMs)) {
        fail(
          'PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID',
          'Connection proof identity or clock is invalid.',
        );
      }
      const secretRef = 'connection-proof:' + connectionProofId;
      const stored = options.secretStore.write({
        integrationId: profile.integrationId,
        secretRef,
        secretKind,
        revision: 1,
        secretBytes: persistedSecretBytes,
        createdAtMs: issuedAtMs,
      });
      secretLocator = stored.locator;
      const result = Object.freeze({
        kind: profile.kind,
        result: 'passed',
        persisted: false,
        connectionProofId,
        expiresAtMs,
        capabilityCodes: Object.freeze([...summary.capabilityCodes]),
        endpointDigest: summary.endpointDigest,
        identityNamespace: summary.identityNamespace,
        identityProviderKey: summary.identityProviderKey,
        observationDigest: summary.observationDigest,
        checkedAtMs: summary.checkedAtMs,
      });
      const proof = Object.freeze({
        connectionProofId,
        kind: profile.kind,
        endpoint,
        secretKind,
        credentialKind: tested.persistedCredentialKind ||
          prepared.credentialKind,
        secretRef,
        secretLocator: stored.locator,
        secretEnvelopeDigest: stored.envelopeDigest,
        testIdempotencyKey: testKey,
        testRequestDigest: digest,
        summary: Object.freeze({
          result: 'passed',
          checkedAtMs: summary.checkedAtMs,
          endpointDigest: summary.endpointDigest,
          observationDigest: summary.observationDigest,
          identityNamespace: summary.identityNamespace,
          identityProviderKey: summary.identityProviderKey,
        }),
        issuedAtMs,
        expiresAtMs,
        settings: Object.freeze({ ...preparedSettings }),
        landingProbe: landingProbe
          ? Object.freeze({
              settings: Object.freeze({ ...landingProbe.settings }),
              deviceId: landingProbe.deviceId,
              checkedAtMs: landingProbe.checkedAtMs,
            })
          : null,
      });
      proofs.set(connectionProofId, proof);
      tests.set(testKey, Object.freeze({
        requestDigest: digest,
        connectionProofId,
        result,
      }));
      recordValidation(testKey, endpoint, 'passed');
      return result;
    } catch (error) {
      if (secretLocator) {
        try {
          options.secretStore.remove(secretLocator);
        } catch (_ignored) {
          // The authoritative test error remains unchanged.
        }
      }
      recordValidation(testKey, endpoint, 'failed', error);
      throw error;
    } finally {
      prepared.secretBytes.fill(0);
      if (persistedSecretBytes) persistedSecretBytes.fill(0);
      if (returnedPersistedSecretBytes) {
        returnedPersistedSecretBytes.fill(0);
      }
    }
  }

  function commandContract(commandKind) {
    return 'platform.integration.' + profile.kind + '.' +
      commandKind + '@1';
  }

  function ensureHeadReceipt(snapshot) {
    if (!snapshot?.integration) return;
    const command = snapshot.integration.config.lastCommand;
    options.receiptRepository.commit({
      commandKind: command.commandKind,
      commandContract: commandContract(command.commandKind),
      idempotencyKey: command.idempotencyKey,
      integrationId: profile.integrationId,
      requestDigest: command.requestDigest,
      result: publicSnapshot(profile, snapshot),
    });
  }

  function executeDurableCommand(value) {
    const receiptKey = {
      commandContract: commandContract(value.commandKind),
      idempotencyKey: value.idempotencyKey,
    };
    const existing = options.receiptRepository.read(receiptKey);
    if (existing) {
      if (existing.requestDigest !== value.requestDigest) {
        fail(
          'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT',
          'Integration idempotency key was used for another request.',
        );
      }
      return Object.freeze({
        replayed: true,
        publicResult: validateStoredPublicResult(
          profile,
          existing.result,
        ),
      });
    }
    const head = current();
    ensureHeadReceipt(head);
    const repaired = options.receiptRepository.read(receiptKey);
    if (repaired) {
      if (repaired.requestDigest !== value.requestDigest) {
        fail(
          'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT',
          'Integration idempotency key was used for another request.',
        );
      }
      return Object.freeze({
        replayed: true,
        publicResult: validateStoredPublicResult(
          profile,
          repaired.result,
        ),
      });
    }
    const domainResult = value.execute();
    if (typeof options.afterPlatformCommit === 'function') {
      options.afterPlatformCommit({
        commandKind: value.commandKind,
        integrationId: profile.integrationId,
        idempotencyKey: value.idempotencyKey,
      });
    }
    const publicResult = validateStoredPublicResult(
      profile,
      domainResult.publicResult,
    );
    options.receiptRepository.commit({
      commandKind: value.commandKind,
      commandContract: receiptKey.commandContract,
      idempotencyKey: value.idempotencyKey,
      integrationId: profile.integrationId,
      requestDigest: value.requestDigest,
      result: publicResult,
    });
    return Object.freeze({
      replayed: false,
      publicResult,
      domainResult,
    });
  }

  function updateSettings(inputKind, body) {
    assertSupported(profile, inputKind);
    exact(body, ['kind', 'idempotencyKey', 'expectedConfigRevision', 'settings'], [],
      'PLATFORM_INTEGRATION_SETTINGS_UPDATE_SHAPE');
    if (body.kind !== inputKind || typeof profile.normalizeSettings !== 'function') {
      fail('PLATFORM_INTEGRATION_TARGET_MISMATCH', 'Integration settings target is invalid.');
    }
    const key=idempotencyKey(body.idempotencyKey),expected=expectedRevision(body.expectedConfigRevision);
    const moviePilotLandingUpdate = profile.kind === 'moviepilot' &&
      body.settings && typeof body.settings === 'object' &&
      !Array.isArray(body.settings) && [
        'providerRequestSaveRoot',
        'providerOrganizedRoot',
        'shelfDeckVisibleRoot',
      ].some((field) => Object.hasOwn(body.settings, field));
    if (profile.kind === 'moviepilot' && !moviePilotLandingUpdate) {
      exact(body.settings, ['maxDownloadAttempts'], [],
        'PLATFORM_INTEGRATION_SETTINGS_UPDATE_SHAPE');
    }
    const requestedLandingSettings = moviePilotLandingUpdate
      ? normalizeMoviePilotLandingSettings(body.settings)
      : null;
    const normalizedSettings=profile.normalizeSettings(requestedLandingSettings
      ? { maxDownloadAttempts:requestedLandingSettings.maxDownloadAttempts }
      : body.settings),digest=requestDigest({command:RECEIPT_KIND_SETTINGS_UPDATE,
      kind:body.kind,idempotencyKey:key,expectedConfigRevision:expected,settings:normalizedSettings,
      ...(requestedLandingSettings ? { landingSettings:requestedLandingSettings } : {})});
    let createdEnvelope,platformCommitted=false;
    const execute=()=>{
      const before=current();
      if(!before.integration||before.integration.state!=='active'||before.integration.configRevision!==expected){
        fail('PLATFORM_INTEGRATION_CAS_CONFLICT','Integration configuration revision changed.',
          {expectedRevision:expected,actualRevision:before.integration?.configRevision||0});
      }
      const secretBytes=options.secretStore.read(before.secret.secretLocator,{integrationId:profile.integrationId,
        secretRef:profile.secretRef,secretKind:before.secret.secretKind,revision:expected,
        envelopeDigest:before.integration.config.secretEnvelopeDigest});
      try{
        const revision=expected+1,committedAtMs=now();
        const currentLandingProbe = requestedLandingSettings
          ? landingAccessAdapter.probe({
              settings: requestedLandingSettings,
              reservedRoots: reservedRoots(),
              now,
            })
          : null;
        createdEnvelope=options.secretStore.write({integrationId:profile.integrationId,secretRef:profile.secretRef,
          secretKind:before.secret.secretKind,revision,secretBytes,createdAtMs:committedAtMs});
        const config={...before.integration.config,configRevision:revision,secretEnvelopeDigest:createdEnvelope.envelopeDigest,
          settings:normalizedSettings,landingBinding:profile.kind==='moviepilot'
            ?currentLandingProbe
              ?buildMoviePilotLandingBinding({integrationId:profile.integrationId,configRevision:revision,
                probe:currentLandingProbe})
              :reviseMoviePilotLandingBinding(before.integration.config.landingBinding,revision)
            :before.integration.config.landingBinding,lastCommand:{commandKind:RECEIPT_KIND_SETTINGS_UPDATE,
              idempotencyKey:key,requestDigest:digest,committedRevision:revision}};
        const configJson=canonicalJson(config);
        if(Buffer.byteLength(configJson,'utf8')>16*1024)fail('PLATFORM_INTEGRATION_CONFIG_TOO_LARGE',
          'Integration configuration exceeds its table contract.');
        if(typeof options.beforePlatformCommit==='function')options.beforePlatformCommit({
          commandKind:RECEIPT_KIND_SETTINGS_UPDATE,integrationId:profile.integrationId,configRevision:revision});
        const committed=options.repository.commit({expectedRevision:expected,integration:{integration_id:profile.integrationId,
          integration_type:profile.integrationType,endpoint:before.integration.endpoint,config_revision:revision,
          config_schema_ref:profile.configSchemaRef,config_json:configJson,config_digest:canonicalDigest(config),state:'active',
          updated_at_ms:committedAtMs},secret:{secret_ref:profile.secretRef,owner_scope_type:'integration',
          owner_scope_id:profile.integrationId,secret_kind:before.secret.secretKind,encrypted_ref:createdEnvelope.locator,
          revision,state:'active',updated_at_ms:committedAtMs}});
        platformCommitted=true;
        return Object.freeze({publicResult:publicSnapshot(profile,committed),previousSecretLocator:before.secret.secretLocator});
      }finally{secretBytes.fill(0);}
    };
    let committed;
    try{committed=executeDurableCommand({commandKind:RECEIPT_KIND_SETTINGS_UPDATE,idempotencyKey:key,requestDigest:digest,execute});}
    catch(error){if(createdEnvelope&&!platformCommitted){try{options.secretStore.remove(createdEnvelope.locator);}catch(_ignored){}}throw error;}
    if(!committed.replayed){const previous=committed.domainResult.previousSecretLocator;if(previous&&previous!==createdEnvelope?.locator){
      try{options.secretStore.remove(previous);}catch(_ignored){}}}
    return committed.publicResult;
  }

  function configure(inputKind, body) {
    if (body && Object.hasOwn(body, 'settings') && !Object.hasOwn(body, 'connectionProofId')) {
      return updateSettings(inputKind, body);
    }
    assertSupported(profile, inputKind);
    exact(
      body,
      [
        'kind',
        'idempotencyKey',
        'expectedConfigRevision',
        'connectionProofId',
      ],
      [],
      'PLATFORM_INTEGRATION_CONFIGURE_SHAPE',
    );
    if (body.kind !== inputKind) {
      fail(
        'PLATFORM_INTEGRATION_TARGET_MISMATCH',
        'URL and body Integration kinds differ.',
      );
    }
    const key = idempotencyKey(body.idempotencyKey);
    const expected = expectedRevision(body.expectedConfigRevision);
    if (typeof body.connectionProofId !== 'string' ||
        body.connectionProofId.length < 1 ||
        body.connectionProofId.length > 256) {
      fail(
        'PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID',
        'Connection proof identity is invalid.',
      );
    }
    const digest = requestDigest({
      command: RECEIPT_KIND_CONFIGURE,
      kind: body.kind,
      idempotencyKey: key,
      expectedConfigRevision: expected,
      connectionProofId: body.connectionProofId,
    });
    let createdEnvelope;
    let platformCommitted = false;
    const execute = () => {
      const proof = proofAt(body.connectionProofId);
      const before = current();
      const actualRevision = before.integration?.configRevision || 0;
      if (actualRevision !== expected) {
        fail(
          'PLATFORM_INTEGRATION_CAS_CONFLICT',
          'Integration configuration revision changed.',
          { expectedRevision: expected, actualRevision },
        );
      }
      const secretBytes = options.secretStore.read(
        proof.secretLocator,
        {
          integrationId: profile.integrationId,
          secretRef: proof.secretRef,
          secretKind: proof.secretKind,
          revision: 1,
          envelopeDigest: proof.secretEnvelopeDigest,
        },
      );
      try {
        const revision = expected + 1;
        const committedAtMs = now();
        const currentLandingProbe = profile.kind === 'moviepilot'
          ? landingAccessAdapter.probe({
              settings: proof.settings,
              reservedRoots: reservedRoots(),
              now,
            })
          : null;
        if (currentLandingProbe &&
            (currentLandingProbe.deviceId !== proof.landingProbe.deviceId ||
             JSON.stringify(currentLandingProbe.settings) !==
               JSON.stringify(proof.landingProbe.settings))) {
          fail(
            'PLATFORM_INTEGRATION_CONNECTION_PROOF_STALE',
            'MoviePilot Landing reality changed after connection test.',
          );
        }
        createdEnvelope = options.secretStore.write({
          integrationId: profile.integrationId,
          secretRef: profile.secretRef,
          secretKind: proof.secretKind,
          revision,
          secretBytes,
          createdAtMs: committedAtMs,
        });
        const config = {
          schemaRef: profile.configSchemaRef,
          schemaVersion: 1,
          kind: profile.kind,
          endpoint: proof.endpoint,
          configRevision: revision,
          secretRef: profile.secretRef,
          secretEnvelopeDigest: createdEnvelope.envelopeDigest,
          credentialKind: proof.credentialKind,
          capabilityCodes: [...profile.capabilityCodes],
          lastTestSummary: { ...proof.summary },
          landingBinding: profile.kind === 'moviepilot'
            ? buildMoviePilotLandingBinding({
                integrationId: profile.integrationId,
                configRevision: revision,
                probe: currentLandingProbe,
              })
            : null,
          ...(typeof profile.normalizeSettings === 'function'
            ? { settings: profile.normalizeSettings(proof.settings) }
            : {}),
          lastCommand: {
            commandKind: RECEIPT_KIND_CONFIGURE,
            idempotencyKey: key,
            requestDigest: digest,
            committedRevision: revision,
          },
        };
        const configJson = canonicalJson(config);
        if (Buffer.byteLength(configJson, 'utf8') > 16 * 1024) {
          fail(
            'PLATFORM_INTEGRATION_CONFIG_TOO_LARGE',
            'Integration configuration exceeds its table contract.',
          );
        }
        if (typeof options.beforePlatformCommit === 'function') {
          options.beforePlatformCommit({
            commandKind: RECEIPT_KIND_CONFIGURE,
            integrationId: profile.integrationId,
            configRevision: revision,
          });
        }
        const committed = options.repository.commit({
          expectedRevision: expected,
          integration: {
            integration_id: profile.integrationId,
            integration_type: profile.integrationType,
            endpoint: proof.endpoint,
            config_revision: revision,
            config_schema_ref: profile.configSchemaRef,
            config_json: configJson,
            config_digest: canonicalDigest(config),
            state: 'active',
            updated_at_ms: committedAtMs,
          },
          secret: {
            secret_ref: profile.secretRef,
            owner_scope_type: 'integration',
            owner_scope_id: profile.integrationId,
            secret_kind: proof.secretKind,
            encrypted_ref: createdEnvelope.locator,
            revision,
            state: 'active',
            updated_at_ms: committedAtMs,
          },
        });
        platformCommitted = true;
        return Object.freeze({
          publicResult: publicSnapshot(profile, committed),
          previousSecretLocator:
            before.secret?.secretLocator || null,
        });
      } finally {
        secretBytes.fill(0);
      }
    };
    let committed;
    try {
      committed = executeDurableCommand({
        commandKind: RECEIPT_KIND_CONFIGURE,
        idempotencyKey: key,
        requestDigest: digest,
        execute,
      });
    } catch (error) {
      if (createdEnvelope && !platformCommitted) {
        try {
          options.secretStore.remove(createdEnvelope.locator);
        } catch (_ignored) {
          // Failed UoW leaves the candidate envelope unreachable.
        }
      }
      throw error;
    }
    const completedProof = proofs.get(body.connectionProofId);
    if (completedProof) removeProof(completedProof);
    if (!committed.replayed) {
      const previous = committed.domainResult.previousSecretLocator;
      if (previous && previous !== createdEnvelope?.locator) {
        try {
          options.secretStore.remove(previous);
        } catch (_ignored) {
          // The old locator is unreachable after the committed CAS.
        }
      }
    }
    return committed.publicResult;
  }

  function disconnect(inputKind, body) {
    assertSupported(profile, inputKind);
    exact(
      body,
      ['kind', 'idempotencyKey', 'expectedConfigRevision'],
      [],
      'PLATFORM_INTEGRATION_DISCONNECT_SHAPE',
    );
    if (body.kind !== inputKind) {
      fail(
        'PLATFORM_INTEGRATION_TARGET_MISMATCH',
        'URL and body Integration kinds differ.',
      );
    }
    const key = idempotencyKey(body.idempotencyKey);
    const expected = expectedRevision(body.expectedConfigRevision);
    const digest = requestDigest({
      command: RECEIPT_KIND_DISCONNECT,
      kind: body.kind,
      idempotencyKey: key,
      expectedConfigRevision: expected,
    });
    const execute = () => {
      const before = current();
      if (!before.integration) {
        if (expected !== 0) {
          fail(
            'PLATFORM_INTEGRATION_CAS_CONFLICT',
            'Integration configuration revision changed.',
            { expectedRevision: expected, actualRevision: 0 },
          );
        }
        return Object.freeze({
          publicResult: publicSnapshot(profile, before),
          previousSecretLocator: null,
        });
      }
      if (before.integration.configRevision !== expected) {
        fail(
          'PLATFORM_INTEGRATION_CAS_CONFLICT',
          'Integration configuration revision changed.',
          {
            expectedRevision: expected,
            actualRevision: before.integration.configRevision,
          },
        );
      }
      if (before.integration.state === 'disabled') {
        return Object.freeze({
          publicResult: publicSnapshot(profile, before),
          previousSecretLocator: null,
        });
      }
      const revision = expected + 1;
      const committedAtMs = now();
      const config = {
        ...before.integration.config,
        configRevision: revision,
        lastCommand: {
          commandKind: RECEIPT_KIND_DISCONNECT,
          idempotencyKey: key,
          requestDigest: digest,
          committedRevision: revision,
        },
      };
      const committed = options.repository.commit({
        expectedRevision: expected,
        integration: {
          integration_id: profile.integrationId,
          integration_type: profile.integrationType,
          endpoint: before.integration.endpoint,
          config_revision: revision,
          config_schema_ref: profile.configSchemaRef,
          config_json: canonicalJson(config),
          config_digest: canonicalDigest(config),
          state: 'disabled',
          updated_at_ms: committedAtMs,
        },
        secret: {
          secret_ref: profile.secretRef,
          owner_scope_type: 'integration',
          owner_scope_id: profile.integrationId,
          secret_kind: before.secret.secretKind,
          encrypted_ref: before.secret.secretLocator,
          revision,
          state: 'revoked',
          updated_at_ms: committedAtMs,
        },
      });
      return Object.freeze({
        publicResult: publicSnapshot(profile, committed),
        previousSecretLocator: before.secret.secretLocator,
      });
    };
    const committed = executeDurableCommand({
      commandKind: RECEIPT_KIND_DISCONNECT,
      idempotencyKey: key,
      requestDigest: digest,
      execute,
    });
    if (!committed.replayed) {
      const locator = committed.domainResult.previousSecretLocator;
      if (locator) {
        try {
          options.secretStore.remove(locator);
        } catch (_ignored) {
          // Revocation is authoritative in the atomic Owner command.
        }
      }
    }
    return committed.publicResult;
  }

  return Object.freeze({
    configure,
    disconnect,
    get(inputKind) {
      assertSupported(profile, inputKind);
      return withValidation(current());
    },
    profile,
    test,
    updateSettings,
  });
}

module.exports = Object.freeze({
  CONNECTION_PROOF_TTL_MS,
  IntegrationAdminError,
  createIntegrationAdminApplication,
});
