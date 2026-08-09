'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { computeBoundedMaterialFingerprintSync } = require('./helix/integrations/bounded-material-fingerprint');
const {
  canonicalDigest,
  canonicalJson,
} = require('./helix/contracts/canonical-json');

class CleanProductProductionPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanProductProductionPortError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanProductProductionPortError(code, message, details);
}

function bytesDigest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedLocation(value) {
  if (typeof value !== 'string' || !value) {
    fail('CLEAN_PRODUCT_LOCATION_INVALID', 'A frozen material location is required.');
  }
  return path.resolve(value.replace(/\//g, path.sep));
}

function createCleanProductProductionPort(options = {}) {
  if (!options.mediaProbe || typeof options.mediaProbe.probe !== 'function') {
    fail('CLEAN_PRODUCT_PROBE_REQUIRED', 'Product production requires the typed media probe port.');
  }
  if (!options.workspaceProductPort ||
      typeof options.workspaceProductPort.materializeArtifact !== 'function' ||
      typeof options.workspaceProductPort.acquireArtifact !== 'function') {
    fail('CLEAN_PRODUCT_WORKSPACE_REQUIRED',
      'Product Artifact capabilities require the clean Workspace port.');
  }
  const now = typeof options.now === 'function' ? options.now : Date.now;

  function exactProviderIdentity(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        canonicalJson(Object.keys(value).sort()) !== canonicalJson([
          'identityAnchorDigest', 'namespace', 'provider', 'providerKey',
          'seasonNumber',
        ].sort()) ||
        canonicalJson(value) !== canonicalJson(expected)) {
      fail('CLEAN_PRODUCT_PROVIDER_IDENTITY_MISMATCH',
        'Provider operation did not conserve the exact resolved identity tuple.');
    }
    return Object.freeze({ ...value });
  }

  function containsInlineBytes(value) {
    if (Buffer.isBuffer(value)) return true;
    if (Array.isArray(value)) return value.some(containsInlineBytes);
    return !!value && typeof value === 'object' &&
      Object.values(value).some(containsInlineBytes);
  }

  function resolveIntegrationHandle(value) {
    const intent = value?.intent;
    const operationId = value?.operationId;
    if (!intent || intent.sourceKind !== 'provider' ||
        !['libra.product_metadata.fetch@1',
          'libra.product_artifact.acquire@1'].includes(operationId)) {
      fail('CLEAN_PRODUCT_INTEGRATION_HANDLE_INPUT',
        'Integration Handle requires one exact Provider operation.');
    }
    const basis = {
      schemaRef: 'helix://contracts/types/IntegrationHandle/v1',
      schemaVersion: 1,
      handleId: canonicalDigest({
        schema: 'platform.integration-handle-id@1',
        integrationId: intent.integrationId,
        configRevision: intent.configRevision,
        allowedOperation: operationId,
        artifactKind: value.artifactKind || null,
      }),
      integrationId: intent.integrationId,
      integrationType: intent.providerKind,
      configRevision: intent.configRevision,
      secretRef: 'integration-secret:' + intent.integrationId,
      allowedOperation: operationId,
      expiresAtMs: 4_102_444_800_000,
    };
    return Object.freeze({
      ...basis,
      fenceDigest: canonicalDigest({
        schema: 'platform.integration-handle-fence@1',
        ...basis,
      }),
    });
  }

  function exactPhysicalReality(value) {
    const location = normalizedLocation(value.location);
    const bounded = computeBoundedMaterialFingerprintSync(location);
    const bytes = fs.readFileSync(location);
    const stat = bounded.stat;
    const digestHex = bytesDigest(bytes);
    if (bounded.contentFingerprint !== value.physicalIdentity.contentFingerprint ||
        bounded.fingerprintAlgorithm !== value.physicalIdentity.fingerprintAlgorithm ||
        bounded.fingerprintVersion !== value.physicalIdentity.fingerprintVersion ||
        Number(stat.size) !== value.physicalIdentity.sizeBytes ||
        bytes.length !== value.sizeBytes ||
        String(stat.ino) !== value.physicalIdentity.inode) {
      fail('CLEAN_PRODUCT_REALITY_MISMATCH',
        'Physical material no longer matches the immutable Libra Run input.', {
          materialKey: value.physicalIdentity.materialKey,
        });
    }
    return Object.freeze({ location, bytes, stat, digestHex });
  }

  function issuePhysicalReadHandle(value) {
    const reality = exactPhysicalReality(value);
    const identity = Object.freeze({
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
      schemaVersion: 2,
      ...value.physicalIdentity,
    });
    const basis = {
      schemaRef: 'helix://contracts/types/PhysicalMaterialReadHandle/v1',
      schemaVersion: 1,
      handleId: '',
      identity,
      ownerDomain: 'libra',
      ownerScope: Object.freeze({ scopeType: 'libra_run', scopeId: value.libraRunId }),
      bindingRevision: value.bindingRevision,
      endpointId: value.endpointId,
      location: reality.location.replace(/\\/g, '/'),
      mountScopeRevision: value.mountScopeRevision,
      expectedSizeBytes: value.sizeBytes,
      expectedMtimeNs: Number(reality.stat.mtimeNs / 1_000_000n),
      expectedCtimeNs: Number(reality.stat.ctimeNs / 1_000_000n),
      fingerprintVerifiedAtMs: value.runCreatedAtMs,
      readScope: 'material_read',
      expiresAtMs: 4_102_444_800_000,
      fenceDigest: '',
    };
    basis.handleId = canonicalDigest({
      schema: 'libra.run-input-read-handle-id@1',
      libraRunId: value.libraRunId,
      materialKey: identity.materialKey,
      bindingRevision: value.bindingRevision,
      runExecutionBasisDigest: value.runExecutionBasisDigest,
    });
    basis.fenceDigest = canonicalDigest({
      schema: 'libra.run-input-read-handle-fence@1',
      ...Object.fromEntries(Object.entries(basis).filter(([key]) => key !== 'fenceDigest')),
      runExecutionBasisDigest: value.runExecutionBasisDigest,
    });
    return Object.freeze(basis);
  }

  function readRelatedNfo(value) {
    if (!value?.reference || value.reference.role !== 'nfo' ||
        value.reference.primaryMaterialKey !== value.primaryMaterialKey) {
      fail('CLEAN_PRODUCT_NFO_REFERENCE_INVALID',
        'Related NFO must bind the exact primary Run input.');
    }
    const location = normalizedLocation(value.reference.location);
    const bytes = fs.readFileSync(location);
    if (bytesDigest(bytes) !== value.reference.checksumHex ||
        value.reference.checksumAlgorithm !== 'sha256') {
      fail('CLEAN_PRODUCT_NFO_REALITY_MISMATCH',
        'Related NFO bytes do not match the immutable Handoff A reference.');
    }
    const xml = bytes.toString('utf8');
    const entries = [];
    const fields = [
      ['title', 'title'],
      ['year_or_release_date', 'year'],
      ['release_date', 'releasedate'],
      ['plot', 'plot'],
      ['episode_plot', 'plot'],
      ['season_number', 'season'],
      ['episode_number', 'episode'],
      ['genre', 'genre'],
      ['director', 'director'],
      ['actor', 'name'],
    ];
    for (const [key, tag] of fields) {
      const match = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]+)</' + tag + '>', 'i'));
      if (match && match[1].trim()) entries.push({ key, value: match[1].trim() });
    }
    const tagValue = (tag) => xml.match(
      new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]+)</' + tag + '>', 'i'),
    )?.[1]?.trim();
    if (/<movie(?:\s|>)/i.test(xml) && tagValue('tmdbid')) {
      entries.push({ key: 'tmdb_movie_id', value: tagValue('tmdbid') });
    }
    if (/<tvshow(?:\s|>)/i.test(xml)) {
      if (tagValue('title')) {
        entries.push({ key: 'series_title', value: tagValue('title') });
      }
      if (tagValue('tmdbid')) {
        entries.push({ key: 'tmdb_series_id', value: tagValue('tmdbid') });
      }
    }
    if (/<episodedetails(?:\s|>)/i.test(xml) && tagValue('title')) {
      entries.push({ key: 'episode_title', value: tagValue('title') });
    }
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
    return Object.freeze({ bytes, entries: Object.freeze(entries) });
  }

  async function fetchProvider(intent, integrationHandle) {
    if (typeof options.fetchProviderMetadata !== 'function') {
      fail('CLEAN_PRODUCT_PROVIDER_UNAVAILABLE',
        'The required typed Product Metadata provider is unavailable.');
    }
    const expectedHandle = resolveIntegrationHandle({
      intent,
      operationId: 'libra.product_metadata.fetch@1',
    });
    if (!integrationHandle ||
        canonicalJson(integrationHandle) !== canonicalJson(expectedHandle) ||
        integrationHandle.allowedOperation !==
          'libra.product_metadata.fetch@1' ||
        integrationHandle.integrationId !== intent.integrationId ||
        integrationHandle.integrationType !== intent.providerKind ||
        integrationHandle.configRevision !== intent.configRevision ||
        integrationHandle.expiresAtMs < now()) {
      fail('CLEAN_PRODUCT_PROVIDER_HANDLE_INVALID',
        'Metadata Provider handle does not authorize the exact Intent.');
    }
    const response = await options.fetchProviderMetadata(Object.freeze({
      metadataFetchIntent: Object.freeze({ ...intent }),
      integrationHandle,
    }));
    const isJav = intent.contentProfile === 'jav' &&
      intent.providerKind === 'jav';
    const expectedProviderKind = isJav ? 'jav' : 'tmdb';
    if (!response || response.providerKind !== expectedProviderKind ||
        response.integrationId !== intent.integrationId ||
        response.configRevision !== intent.configRevision ||
        !Array.isArray(response.descriptiveEntries) ||
        !Array.isArray(response.providerIdentities) ||
        !Array.isArray(response.peopleHints) ||
        containsInlineBytes(response) ||
        Object.hasOwn(response, 'posterBytes') ||
        Object.hasOwn(response, 'fanartBytes') ||
        !response.providerIdentities.some((item) =>
          canonicalJson(item) ===
            canonicalJson(intent.resolvedProviderIdentity))) {
      fail('CLEAN_PRODUCT_PROVIDER_RESULT_INVALID',
        'Typed Product Metadata provider result is incomplete.');
    }
    response.providerIdentities.forEach((item) => {
      if (item.provider === intent.resolvedProviderIdentity.provider &&
          item.namespace === intent.resolvedProviderIdentity.namespace &&
          item.providerKey === intent.resolvedProviderIdentity.providerKey) {
        exactProviderIdentity(item, intent.resolvedProviderIdentity);
      }
    });
    return Object.freeze({
      ...response,
      descriptiveEntries: Object.freeze([...response.descriptiveEntries]),
      providerIdentities: Object.freeze([...response.providerIdentities]),
      peopleHints: Object.freeze([...response.peopleHints]),
    });
  }

  function evidenceEnvelope(kind, producerRef, basisDigest, payload,
    observedAtMs) {
    const body = {
      evidenceId: canonicalDigest({
        schema: 'libra.product-artifact-evidence-id@1',
        kind,
        producerRef,
        basisDigest,
      }),
      evidenceKind: kind,
      producerRef,
      basisDigest,
      payloadDigest: canonicalDigest(payload),
      observedAtMs,
    };
    return Object.freeze(body);
  }

  async function acquireProviderArtifact(request) {
    if (typeof options.fetchProviderArtifact !== 'function') {
      fail('CLEAN_PRODUCT_ARTIFACT_PROVIDER_UNAVAILABLE',
        'The required typed Product Artifact provider is unavailable.');
    }
    const draft = request?.productMetadataDraft;
    const kind = request?.artifactKind;
    const integrationHandle = request?.integrationHandle;
    const identity = draft?.providerIdentities?.find((item) =>
      item.provider === integrationHandle?.integrationType);
    const requirement = draft?.artifactRequirements?.find((item) =>
      item.artifactKind === kind);
    const expectedHandle = integrationHandle && resolveIntegrationHandle({
      intent: {
        sourceKind: 'provider',
        providerKind: integrationHandle.integrationType,
        integrationId: request.integrationId,
        configRevision: request.configRevision,
      },
      operationId: 'libra.product_artifact.acquire@1',
      artifactKind: kind,
    });
    if (!draft || !['poster', 'fanart'].includes(kind) || !requirement ||
        !identity || !integrationHandle ||
        canonicalJson(integrationHandle) !== canonicalJson(expectedHandle) ||
        integrationHandle.allowedOperation !==
          'libra.product_artifact.acquire@1' ||
        integrationHandle.integrationId !== request.integrationId ||
        integrationHandle.configRevision !== request.configRevision ||
        integrationHandle.expiresAtMs < now()) {
      fail('CLEAN_PRODUCT_ARTIFACT_INPUT_INVALID',
        'Product Artifact acquisition input is incomplete or unfenced.');
    }
    const input = Object.freeze({
      productMetadataDraft: draft,
      artifactKind: kind,
      resolvedProviderIdentity: identity,
      integrationHandle,
    });
    const basisDigest = canonicalDigest(input);
    const outcome = await options.workspaceProductPort.acquireArtifact({
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      relativePath: request.relativePath,
      artifactKind: kind,
      mediaType: 'image/jpeg',
      acquisitionBasis: {
        inputDigest: basisDigest,
        integrationHandleId: integrationHandle.handleId,
        integrationFenceDigest: integrationHandle.fenceDigest,
        resolvedProviderIdentity: identity,
      },
      provenanceRef: {
        objectType: 'metadata_observation',
        objectId: request.metadataObservationId,
        revision: 1,
        digest: request.metadataObservationDigest,
      },
      async acquireBytes() {
        const response = await options.fetchProviderArtifact(input);
        if (!response ||
            !['acquired', 'not_available'].includes(response.resultKind)) {
          fail('CLEAN_PRODUCT_ARTIFACT_RESULT_INVALID',
            'Product Artifact provider returned an invalid typed outcome.');
        }
        if (response.resultKind === 'not_available') {
          if (typeof response.reasonCode !== 'string' ||
              !response.reasonCode) {
            fail('CLEAN_PRODUCT_ARTIFACT_RESULT_INVALID',
              'Unavailable Product Artifact requires a reason code.');
          }
          return Object.freeze({
            resultKind: 'not_available',
            reasonCode: response.reasonCode,
          });
        }
        if (!Buffer.isBuffer(response.bytes) ||
            !response.bytes.length ||
            response.artifactKind !== kind ||
            response.integrationId !== integrationHandle.integrationId ||
            response.configRevision !== integrationHandle.configRevision ||
            response.mediaType !== 'image/jpeg') {
          fail('CLEAN_PRODUCT_ARTIFACT_RESULT_INVALID',
            'Acquired Product Artifact bytes do not match the exact request fence.');
        }
        exactProviderIdentity(response.resolvedProviderIdentity, identity);
        return Object.freeze({
          resultKind: 'acquired',
          bytes: response.bytes,
        });
      },
    });
    if (outcome.resultKind === 'not_available') {
      return Object.freeze({
        schemaRef:
          'helix://contracts/types/ArtifactAcquisitionResult/v1',
        schemaVersion: 1,
        resultKind: 'not_available',
        artifactHandle: null,
        reasonCode: outcome.reasonCode,
        evidence: evidenceEnvelope(
          'product_artifact_not_available',
          'libra.product_artifact.acquire@1',
          basisDigest,
          { artifactKind:kind, reasonCode:outcome.reasonCode },
          now(),
        ),
      });
    }
    const materialized = outcome.materialized;
    const payload = {
      artifactKind: kind,
      artifactHandleId: materialized.artifactHandle.artifactHandleId,
      artifactDigest: materialized.artifactHandle.digestHex,
      requirementDigest: requirement.requirementDigest,
    };
    return Object.freeze({
      schemaRef: 'helix://contracts/types/ArtifactAcquisitionResult/v1',
      schemaVersion: 1,
      resultKind: 'acquired',
      artifactHandle: materialized.artifactHandle,
      reasonCode: null,
      evidence: evidenceEnvelope(
        'product_artifact_acquired',
        'libra.product_artifact.acquire@1',
        basisDigest,
        payload,
        now(),
      ),
    });
  }

  function renderProductSidecar(request) {
    const draft = request?.productMetadataDraft;
    const profile = request?.sidecarProfile;
    if (!draft || !profile ||
        profile.schemaRef !==
          'helix://contracts/domain-types/SidecarProfile/v1' ||
        profile.schemaVersion !== 1 ||
        profile.format !== 'nfo_xml' ||
        profile.digest !== canonicalDigest(Object.fromEntries(
          Object.entries(profile).filter(([key]) => key !== 'digest')))) {
      fail('CLEAN_PRODUCT_SIDECAR_INPUT_INVALID',
        'Product Sidecar render requires the exact frozen profile.');
    }
    const values = new Map(
      draft.descriptiveFacts.entries.map((item) => [item.key, item.value]),
    );
    const series = request.contentProfile === 'series';
    const tags = [
      [series ? 'series_title' : 'title', 'title'],
      [series ? 'tmdb_series_id' : 'tmdb_movie_id', 'tmdbid'],
      ['jav_code', 'id'],
      ['season_number', 'season'],
      ['episode_number', 'episode'],
      ['episode_title', 'episodetitle'],
      ['episode_plot', 'episodeplot'],
      ['year_or_release_date', 'year'],
      ['release_date', 'releasedate'],
      ['studio', 'studio'],
      ['plot', 'plot'],
      ['genre', 'genre'],
      ['director', 'director'],
    ];
    const escape = (value) => String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
    const lines = ['<' + (series ? 'tvshow' : 'movie') + '>'];
    for (const [key, tag] of tags) {
      if (values.has(key)) {
        lines.push('  <' + tag + '>' + escape(values.get(key)) +
          '</' + tag + '>');
      }
    }
    lines.push('</' + (series ? 'tvshow' : 'movie') + '>');
    const materialized = options.workspaceProductPort.materializeArtifact({
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      relativePath: request.relativePath,
      artifactKind: 'nfo',
      mediaType: 'application/xml',
      bytes: Buffer.from(lines.join('\n') + '\n', 'utf8'),
      provenanceRef: {
        objectType: 'product_metadata_draft',
        objectId: draft.draftId,
        revision: 1,
        digest: draft.draftDigest,
      },
    });
    return materialized.artifactHandle;
  }

  async function searchProviderIdentity(request) {
    if (typeof options.searchProviderIdentity !== 'function') {
      fail('CLEAN_PRODUCT_IDENTITY_PROVIDER_UNAVAILABLE',
        'The required typed Provider identity search is unavailable.');
    }
    const response = await options.searchProviderIdentity(Object.freeze({ ...request }));
    const profile = request.contentProfile;
    const namespace = profile === 'series'
      ? 'tmdb_series'
      : profile === 'jav'
        ? 'jav_code'
        : 'tmdb_movie';
    const provider = profile === 'jav' ? 'jav' : 'tmdb';
    if (!response || response.provider !== provider ||
        response.namespace !== namespace ||
        (namespace === 'tmdb_series' &&
          (!Number.isSafeInteger(response.seasonNumber) ||
            response.seasonNumber < 1)) ||
        (namespace === 'jav_code' &&
          (typeof request.javCode !== 'string' ||
            !request.javCode ||
            response.providerKey !== request.javCode)) ||
        typeof response.providerKey !== 'string' || !response.providerKey) {
      fail('CLEAN_PRODUCT_IDENTITY_PROVIDER_RESULT_INVALID',
        'Typed identity search did not return the required stable Product identity.');
    }
    return Object.freeze({
      ...response,
      seasonNumber: namespace === 'tmdb_series' ? response.seasonNumber : null,
    });
  }

  async function probe(readHandle) {
    return options.mediaProbe.probe(readHandle);
  }

  return Object.freeze({
    acquireProviderArtifact,
    fetchProvider,
    issuePhysicalReadHandle,
    probe,
    readRelatedNfo,
    renderProductSidecar,
    resolveIntegrationHandle,
    searchProviderIdentity,
  });
}

module.exports = Object.freeze({
  CleanProductProductionPortError,
  createCleanProductProductionPort,
});
