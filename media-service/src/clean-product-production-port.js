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

function normalizedLocation(value) {
  if (typeof value !== 'string' || !value) {
    fail('CLEAN_PRODUCT_LOCATION_INVALID', 'A frozen material location is required.');
  }
  return path.resolve(value.replace(/\//g, path.sep));
}

function parseRelatedNfoPeopleHints(xml) {
  const peopleHints = [];
  for (const actorMatch of String(xml || '').matchAll(
    /<actor(?:\s[^>]*)?>([\s\S]*?)<\/actor>/gi,
  )) {
    const actorXml = actorMatch[1];
    const displayName = actorXml.match(
      /<name(?:\s[^>]*)?>([^<]+)<\/name>/i,
    )?.[1]?.trim();
    if (!displayName) continue;
    const tmdbPersonId = actorXml.match(
      /<tmdbid(?:\s[^>]*)?>([^<]+)<\/tmdbid>/i,
    )?.[1]?.trim();
    const providerIdentities = /^[1-9]\d*$/.test(tmdbPersonId || '')
      ? [Object.freeze({
        provider: 'tmdb',
        namespace: 'tmdb_person',
        providerKey: tmdbPersonId,
      })]
      : [];
    peopleHints.push(Object.freeze({
      displayName,
      role: 'actor',
      providerIdentities: Object.freeze(providerIdentities),
    }));
  }
  return Object.freeze(peopleHints);
}

function directNfoChildren(xml, expectedRoot) {
  const value = String(xml || '').replace(/^\uFEFF/, '');
  const open = new RegExp('<' + expectedRoot + '(?:\\s[^<>]*?)?>', 'i').exec(value);
  const closeIndex = value.toLowerCase().lastIndexOf('</' + expectedRoot.toLowerCase() + '>');
  if (!open || closeIndex < open.index + open[0].length) return Object.freeze([]);
  const body = value.slice(open.index + open[0].length, closeIndex);
  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[^>]*\?>|<\/?[a-z][^>]*>/gi;
  const children = [];
  let depth = 0;
  let active = null;
  for (const token of body.matchAll(tokenPattern)) {
    const markup = token[0];
    if (/^<!--|^<!\[CDATA|^<\?/.test(markup)) continue;
    const closing = /^<\//.test(markup);
    const selfClosing = /\/\s*>$/.test(markup);
    const name = markup.match(/^<\/?\s*([a-z][\w:.-]*)/i)?.[1]?.toLowerCase();
    if (!name) continue;
    if (closing) {
      depth -= 1;
      if (active && depth === 0 && name === active.name) {
        const raw = body.slice(active.start, token.index).trim();
        children.push(Object.freeze({ name, attributes:active.attributes, raw }));
        active = null;
      }
      continue;
    }
    if (depth === 0) {
      const attributes = markup.slice(1 + name.length, markup.length - 1).replace(/\/\s*$/, '').trim();
      if (selfClosing) children.push(Object.freeze({ name, attributes, raw:'' }));
      else active = { name, attributes, start:token.index + markup.length };
    }
    if (!selfClosing) depth += 1;
  }
  return Object.freeze(children);
}

function directNfoText(children, tag, predicate = () => true) {
  const node = children.find((item) => item.name === tag && predicate(item));
  if (!node || /<(?!\!\[CDATA\[)/.test(node.raw)) return undefined;
  return node.raw.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim() || undefined;
}

function parseRelatedNfoMovieIdentity(xml) {
  const children = directNfoChildren(xml, 'movie');
  const tmdbMovieId = directNfoText(children, 'tmdbid') || directNfoText(children, 'uniqueid', (item) =>
    /\btype\s*=\s*["']tmdb["']/i.test(item.attributes));
  return Object.freeze({
    title:directNfoText(children, 'title') || null,
    releaseYear:directNfoText(children, 'year') || null,
    tmdbMovieId:tmdbMovieId || null,
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function usableNfoDocument(xml, expectedRoot) {
  const value = String(xml || '').replace(/^\uFEFF/, '').trim();
  if (!value || /<!DOCTYPE|<!ENTITY/i.test(value)) return false;
  const withoutPreamble = value
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, '');
  const root = withoutPreamble.match(/^<([a-z][\w:.-]*)(?:\s[^<>]*?)?>/i)?.[1]?.toLowerCase();
  if (root !== expectedRoot) return false;
  if (!new RegExp('</' + expectedRoot + '>\\s*$', 'i').test(withoutPreamble)) return false;
  const stack = [];
  const tokens = withoutPreamble.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[^>]*\?>|<\/?[a-z][^>]*>/gi);
  if (!tokens) return false;
  for (const token of tokens) {
    if (/^<!--|^<!\[CDATA|^<\?/.test(token)) continue;
    const closing = /^<\//.test(token);
    const selfClosing = /\/\s*>$/.test(token);
    const name = token.match(/^<\/?\s*([a-z][\w:.-]*)/i)?.[1]?.toLowerCase();
    if (!name) return false;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

function normalizedPersonName(value) {
  return String(value || '').trim().normalize('NFKC').toLowerCase();
}

function tmdbPersonId(relation) {
  return relation.providerIdentities?.find((item) =>
    item.provider === 'tmdb' && item.namespace === 'tmdb_person')?.providerKey || null;
}

function actorRelations(mediaCastDraft) {
  return (mediaCastDraft.relations || []).filter((item) =>
    item.role === 'actor' && typeof item.displayName === 'string' &&
    item.displayName.trim());
}

function actorBlock(relation) {
  const lines = [
    '  <actor>',
    '    <name>' + escapeXml(relation.displayName.trim()) + '</name>',
  ];
  const personId = tmdbPersonId(relation);
  if (personId) lines.push('    <tmdbid>' + escapeXml(personId) + '</tmdbid>');
  lines.push('  </actor>');
  return lines.join('\n');
}

function mergeNfoActors(xml, rootName, relations) {
  let output = xml;
  const records = [...output.matchAll(/<actor(?:\s[^>]*)?>[\s\S]*?<\/actor>/gi)]
    .map((match) => {
      const raw = match[0];
      const name = raw.match(/<name(?:\s[^>]*)?>([\s\S]*?)<\/name>/i)?.[1]
        ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim() || '';
      const personId = raw.match(/<tmdbid(?:\s[^>]*)?>([\s\S]*?)<\/tmdbid>/i)?.[1]?.trim() ||
        raw.match(/<uniqueid\b[^>]*\btype=["']tmdb["'][^>]*>([\s\S]*?)<\/uniqueid>/i)?.[1]?.trim() || '';
      return { raw, name, normalizedName:normalizedPersonName(name), personId };
    });
  for (const relation of relations) {
    const personId = tmdbPersonId(relation);
    if (personId && records.some((item) => item.personId === personId)) continue;
    const normalizedName = normalizedPersonName(relation.displayName);
    const sameName = records.find((item) => item.normalizedName === normalizedName);
    if (sameName) {
      if (personId && !sameName.personId) {
        const updated = sameName.raw.replace(/\s*<\/actor>\s*$/i,
          '\n    <tmdbid>' + escapeXml(personId) + '</tmdbid>\n  </actor>');
        output = output.replace(sameName.raw, updated);
        sameName.raw = updated;
        sameName.personId = personId;
      }
      continue;
    }
    const block = actorBlock(relation);
    output = output.replace(new RegExp('(\\s*</'+rootName+'>\\s*)$', 'i'),
      '\n' + block + '$1');
    records.push({ raw:block, name:relation.displayName,
      normalizedName, personId:personId || '' });
  }
  return output;
}

function updateNfoDocument(xml, rootName, entries, relations) {
  let output = String(xml).replace(/^\uFEFF/, '');
  const managed = [
    [rootName === 'tvshow' ? 'series_title' : 'title', 'title'],
    [rootName === 'tvshow' ? 'tmdb_series_id' : 'tmdb_movie_id', 'tmdbid'],
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
  for (const [key, tag] of managed) {
    if (!entries.has(key)) continue;
    const encoded = escapeXml(entries.get(key));
    const existing = new RegExp('(<'+tag+'(?:\\s[^>]*)?>)[\\s\\S]*?(</'+tag+'>)', 'i');
    if (existing.test(output)) output = output.replace(existing, '$1' + encoded + '$2');
    else output = output.replace(new RegExp('(\\s*</'+rootName+'>\\s*)$', 'i'),
      '\n  <' + tag + '>' + encoded + '</' + tag + '>$1');
  }
  const tmdbKey = rootName === 'tvshow' ? 'tmdb_series_id' : 'tmdb_movie_id';
  if (entries.has(tmdbKey)) {
    const encoded = escapeXml(entries.get(tmdbKey));
    const uniqueId = /(<uniqueid\b[^>]*\btype=["']tmdb["'][^>]*>)[\s\S]*?(<\/uniqueid>)/i;
    if (uniqueId.test(output)) output = output.replace(uniqueId, '$1' + encoded + '$2');
    else output = output.replace(new RegExp('(\\s*</'+rootName+'>\\s*)$', 'i'),
      '\n  <uniqueid type="tmdb">' + encoded + '</uniqueid>$1');
  }
  output = mergeNfoActors(output, rootName, relations);
  return output.endsWith('\n') ? output : output + '\n';
}

function createNfoDocument(rootName, entries, relations) {
  const tags = [
    [rootName === 'tvshow' ? 'series_title' : 'title', 'title'],
    [rootName === 'tvshow' ? 'tmdb_series_id' : 'tmdb_movie_id', 'tmdbid'],
    ['jav_code', 'id'], ['season_number', 'season'], ['episode_number', 'episode'],
    ['episode_title', 'episodetitle'], ['episode_plot', 'episodeplot'],
    ['year_or_release_date', 'year'], ['release_date', 'releasedate'],
    ['studio', 'studio'], ['plot', 'plot'], ['genre', 'genre'], ['director', 'director'],
  ];
  const lines = ['<' + rootName + '>'];
  for (const [key, tag] of tags) if (entries.has(key)) {
    lines.push('  <' + tag + '>' + escapeXml(entries.get(key)) + '</' + tag + '>');
  }
  const tmdbKey = rootName === 'tvshow' ? 'tmdb_series_id' : 'tmdb_movie_id';
  if (entries.has(tmdbKey)) lines.push(
    '  <uniqueid type="tmdb">' + escapeXml(entries.get(tmdbKey)) + '</uniqueid>',
  );
  for (const relation of relations) lines.push(actorBlock(relation));
  lines.push('</' + rootName + '>');
  return lines.join('\n') + '\n';
}

function nfoIdentityConsistent(observedEntries, desiredEntries, rootName) {
  const key = rootName === 'tvshow' ? 'tmdb_series_id' : 'tmdb_movie_id';
  const observed = observedEntries.get(key);
  const desired = desiredEntries.get(key);
  return !observed || !desired || observed === desired;
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
    if (typeof options.resolveProductIntegrationHandle === 'function') {
      const resolved = options.resolveProductIntegrationHandle(value);
      if (!resolved) {
        fail('CLEAN_PRODUCT_INTEGRATION_UNAVAILABLE',
          'The requested Product integration is not active.');
      }
      return resolved;
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

  function resolveCurrentIntegrationHandle(value) {
    if (!value || value.sourceKind !== 'provider' ||
        typeof value.providerKind !== 'string' || !value.providerKind ||
        !['libra.product_metadata.fetch@1',
          'libra.product_artifact.acquire@1'].includes(value.operationId)) {
      fail('CLEAN_PRODUCT_CURRENT_INTEGRATION_HANDLE_INPUT',
        'Current Integration Handle resolution requires one exact Provider operation.');
    }
    if (typeof options.resolveCurrentProductIntegrationHandle !== 'function') {
      fail('CLEAN_PRODUCT_INTEGRATION_UNAVAILABLE',
        'The requested current Product integration is not available.');
    }
    const resolved = options.resolveCurrentProductIntegrationHandle(value);
    if (!resolved) {
      fail('CLEAN_PRODUCT_INTEGRATION_UNAVAILABLE',
        'The requested current Product integration is not active.');
    }
    return resolved;
  }

  function exactPhysicalReality(value) {
    const location = normalizedLocation(value.location);
    const bounded = computeBoundedMaterialFingerprintSync(location);
    const stat = bounded.stat;
    if (bounded.contentFingerprint !== value.physicalIdentity.contentFingerprint ||
        bounded.fingerprintAlgorithm !== value.physicalIdentity.fingerprintAlgorithm ||
        bounded.fingerprintVersion !== value.physicalIdentity.fingerprintVersion ||
        Number(stat.size) !== value.physicalIdentity.sizeBytes ||
        Number(stat.size) !== value.sizeBytes ||
        String(stat.ino) !== value.physicalIdentity.inode) {
      fail('CLEAN_PRODUCT_REALITY_MISMATCH',
        'Physical material no longer matches the immutable Libra Run input.', {
          materialKey: value.physicalIdentity.materialKey,
        });
    }
    return Object.freeze({ location, stat });
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

  function issueShelfAcceptanceReadHandle(value) {
    if (!value || !['source_primary', 'product_primary',
      'source_and_product_primary'].includes(value.readRole) ||
        !Number.isSafeInteger(value.issuedAtMs) || value.issuedAtMs < 0 ||
        !Number.isSafeInteger(value.expiresAtMs) ||
        value.expiresAtMs !== value.issuedAtMs + 24 * 60 * 60 * 1000) {
      fail('CLEAN_PRODUCT_SHELF_ACCEPTANCE_HANDLE_INPUT',
        'Shelf Acceptance read authority requires one exact 24-hour Package fence.');
    }
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
      ownerScope: Object.freeze({
        scopeType: 'on_deck_package',
        scopeId: value.onDeckPackageId,
      }),
      bindingRevision: value.bindingRevision,
      endpointId: value.endpointId,
      location: reality.location.replace(/\\/g, '/'),
      mountScopeRevision: value.mountScopeRevision,
      expectedSizeBytes: value.sizeBytes,
      expectedMtimeNs: Number(reality.stat.mtimeNs / 1_000_000n),
      expectedCtimeNs: Number(reality.stat.ctimeNs / 1_000_000n),
      fingerprintVerifiedAtMs: value.issuedAtMs,
      readScope: 'shelf_acceptance_primary_probe_decode',
      expiresAtMs: value.expiresAtMs,
      fenceDigest: '',
    };
    basis.handleId = canonicalDigest({
      schema: 'libra.shelf-acceptance-primary-read-handle-id@1',
      onDeckPackageId: value.onDeckPackageId,
      libraRunId: value.libraRunId,
      readRole: value.readRole,
      materialKey: identity.materialKey,
      bindingRevision: value.bindingRevision,
      productMemberDigest: value.productMemberDigest,
      acceptanceSpecRecordDigest: value.acceptanceSpecRecordDigest,
    });
    basis.fenceDigest = canonicalDigest({
      schema: 'libra.shelf-acceptance-primary-read-handle-fence@1',
      ...Object.fromEntries(Object.entries(basis)
        .filter(([key]) => key !== 'fenceDigest')),
      libraRunId: value.libraRunId,
      runExecutionBasisDigest: value.runExecutionBasisDigest,
      acceptanceSpecId: value.acceptanceSpecId,
      acceptanceSpecRecordDigest: value.acceptanceSpecRecordDigest,
      productMemberDigest: value.productMemberDigest,
      readRole: value.readRole,
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
    const identity = value.reference.identity;
    const bounded = computeBoundedMaterialFingerprintSync(location);
    if (!identity || bounded.contentFingerprint !== identity.contentFingerprint ||
        bounded.fingerprintAlgorithm !== identity.fingerprintAlgorithm ||
        bounded.fingerprintVersion !== identity.fingerprintVersion ||
        Number(bounded.stat.size) !== identity.sizeBytes ||
        String(bounded.stat.ino) !== identity.inode || identity.sizeBytes > 256 * 1024) {
      fail('CLEAN_PRODUCT_NFO_REALITY_MISMATCH',
        'Related NFO bytes do not match the immutable Handoff A reference.');
    }
    const before = fs.statSync(location, { bigint:true });
    const bytes = fs.readFileSync(location);
    const after = fs.statSync(location, { bigint:true });
    if (before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      fail('CLEAN_PRODUCT_NFO_STAT_FENCE',
        'Related NFO changed during its bounded read.');
    }
    const xml = bytes.toString('utf8');
    const entries = [];
    const rootName = /<tvshow(?:\s|>)/i.test(xml) ? 'tvshow' : /<episodedetails(?:\s|>)/i.test(xml)
      ? 'episodedetails' : 'movie';
    const directChildren = directNfoChildren(xml, rootName);
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
      const value = directNfoText(directChildren, tag);
      if (value) entries.push({ key, value });
    }
    const tagValue = (tag) => directNfoText(directChildren, tag);
    const tmdbUniqueId = rootName === 'movie' ? parseRelatedNfoMovieIdentity(xml).tmdbMovieId :
      directNfoText(directChildren, 'uniqueid', (item) => /\btype\s*=\s*["']tmdb["']/i.test(item.attributes));
    if (rootName === 'movie' && (tagValue('tmdbid') || tmdbUniqueId)) {
      entries.push({ key: 'tmdb_movie_id', value: tagValue('tmdbid') || tmdbUniqueId });
    }
    if (rootName === 'tvshow') {
      if (tagValue('title')) {
        entries.push({ key: 'series_title', value: tagValue('title') });
      }
      if (tagValue('tmdbid')) {
        entries.push({ key: 'tmdb_series_id', value: tagValue('tmdbid') });
      }
    }
    if (rootName === 'episodedetails' && tagValue('title')) {
      entries.push({ key: 'episode_title', value: tagValue('title') });
    }
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
    const peopleHints = parseRelatedNfoPeopleHints(xml);
    return Object.freeze({ bytes, entries: Object.freeze(entries), peopleHints: Object.freeze(peopleHints) });
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
      operationId: 'libra.product_artifact.acquire@1',
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
      runtimeEffectAuthority: request.runtimeEffectAuthority,
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

  function imageMediaType(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
        bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes.length >= 6 && bytes.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif';
    if (bytes.length >= 6 && bytes.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
    if (bytes.length >= 12 && bytes.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    fail('CLEAN_PRODUCT_RELATED_ARTIFACT_MEDIA',
      'Related Product Artifact is not a decodable image.');
  }

  function materializeRelatedArtifact(request) {
    const kind = request?.artifactKind;
    const reference = request?.reference;
    const draft = request?.productMetadataDraft;
    const requirement = draft?.artifactRequirements?.find((item) => item.artifactKind === kind);
    if (!draft || !['poster', 'fanart'].includes(kind) || !requirement ||
        !reference || reference.role !== kind) {
      fail('CLEAN_PRODUCT_RELATED_ARTIFACT_INPUT',
        'Related Product Artifact input is incomplete.');
    }
    const location = normalizedLocation(reference.location);
    const identity = reference.identity;
    const bounded = computeBoundedMaterialFingerprintSync(location);
    if (!identity || bounded.contentFingerprint !== identity.contentFingerprint ||
        bounded.fingerprintAlgorithm !== identity.fingerprintAlgorithm ||
        bounded.fingerprintVersion !== identity.fingerprintVersion ||
        Number(bounded.stat.size) !== identity.sizeBytes ||
        String(bounded.stat.ino) !== identity.inode) {
      fail('CLEAN_PRODUCT_RELATED_ARTIFACT_REALITY_MISMATCH',
        'Related Product Artifact no longer matches the immutable Run input.');
    }
    const before = fs.statSync(location, { bigint:true });
    const bytes = fs.readFileSync(location);
    const after = fs.statSync(location, { bigint:true });
    if (before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      fail('CLEAN_PRODUCT_RELATED_ARTIFACT_STAT_FENCE',
        'Related Product Artifact changed during its bounded read.');
    }
    const mediaType = imageMediaType(bytes);
    const basisDigest = canonicalDigest({
      schema: 'libra.related-artifact-materialize@1',
      referenceId: reference.referenceId,
      referenceDigest: reference.referenceDigest,
      artifactKind: kind,
    });
    const materialized = options.workspaceProductPort.materializeArtifact({
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      relativePath: request.relativePath,
      artifactKind: kind,
      mediaType,
      bytes,
      provenanceRef: {
        objectType: 'related_material_reference',
        objectId: reference.referenceId,
        revision: 1,
        digest: reference.referenceDigest,
      },
      runtimeEffectAuthority: request.runtimeEffectAuthority,
    });
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
    const mediaCastDraft = request?.mediaCastDraft;
    const profile = request?.sidecarProfile;
    if (!draft || !mediaCastDraft || !profile ||
        mediaCastDraft.schemaRef !== 'helix://contracts/types/MediaCastDraft/v1' ||
        mediaCastDraft.schemaVersion !== 1 ||
        (mediaCastDraft.sourceBasisKind === 'metadata_observation' &&
          mediaCastDraft.metadataObservationSetDigest !==
            draft.metadataObservationSetDigest) ||
        mediaCastDraft.draftDigest !== canonicalDigest(Object.fromEntries(
          Object.entries(mediaCastDraft).filter(([key]) => key !== 'draftDigest'))) ||
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
    const actors = actorRelations(mediaCastDraft);
    const series = request.contentProfile === 'series';
    const rootName = series ? 'tvshow' : 'movie';
    let bytes;
    let provenanceRef = {
      objectType: 'product_metadata_draft_create',
      objectId: draft.draftId,
      revision: 1,
      digest: draft.draftDigest,
    };
    if (request.relatedReference) {
      const related = readRelatedNfo({
        primaryMaterialKey: request.relatedReference.primaryMaterialKey,
        reference: request.relatedReference,
      });
      const original = related.bytes.toString('utf8');
      const observedEntries = new Map(related.entries.map((item) => [item.key, item.value]));
      if (usableNfoDocument(original, rootName) && nfoIdentityConsistent(observedEntries, values, rootName)) {
        bytes = Buffer.from(updateNfoDocument(original, rootName, values, actors), 'utf8');
        provenanceRef = {
          objectType: 'related_nfo_update',
          objectId: request.relatedReference.referenceId,
          revision: 1,
          digest: request.relatedReference.referenceDigest,
        };
      } else {
        bytes = Buffer.from(createNfoDocument(rootName, values, actors), 'utf8');
        provenanceRef = {
          objectType: 'product_metadata_draft_rebuild',
          objectId: draft.draftId,
          revision: 1,
          digest: draft.draftDigest,
        };
      }
    } else {
      bytes = Buffer.from(createNfoDocument(rootName, values, actors), 'utf8');
    }
    const materialized = options.workspaceProductPort.materializeArtifact({
      libraRunId: request.libraRunId,
      workspaceId: request.workspaceId,
      relativePath: request.relativePath,
      artifactKind: 'nfo',
      mediaType: 'application/xml',
      bytes,
      provenanceRef,
      runtimeEffectAuthority: request.runtimeEffectAuthority,
    });
    if (materialized.artifactHandle.provenanceRef.objectType !== provenanceRef.objectType) {
      fail('CLEAN_PRODUCT_SIDECAR_DISPOSITION_MISMATCH',
        'Product Sidecar disposition is not reflected by its Artifact provenance.');
    }
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
    issueShelfAcceptanceReadHandle,
    materializeRelatedArtifact,
    probe,
    readRelatedNfo,
    renderProductSidecar,
    resolveCurrentIntegrationHandle,
    resolveIntegrationHandle,
    searchProviderIdentity,
  });
}

module.exports = Object.freeze({
  CleanProductProductionPortError,
  createCleanProductProductionPort,
  parseRelatedNfoMovieIdentity,
  parseRelatedNfoPeopleHints,
});
