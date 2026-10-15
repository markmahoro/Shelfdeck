'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Ajv = require('ajv/dist/2020');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { buildSharedTypeSchemas } = require('../../scripts/helix-architecture/shared-type-schema-builder');
const { buildJavQueryAnchor, assertJavQueryAnchor, javQueryAnchorSchema,
  buildJavSourceSelectionSnapshot, assertJavSourceSelectionSnapshot, javSourceSelectionSnapshotSchema } =
  require('../../src/helix/contracts/jav-source-contracts');

const ajv = new Ajv({ strict: false, allErrors: true });
const validateAnchor = ajv.compile(javQueryAnchorSchema());
const validateSnapshot = ajv.compile(javSourceSelectionSnapshotSchema());
const validateHandle = ajv.compile(buildSharedTypeSchemas().IntegrationHandle);
const hash = canonicalDigest({ fixture: 'jav-source-contract' });
const copy = value => JSON.parse(JSON.stringify(value));
const invalid = fn => assert.throws(fn, { code: 'JAV_SOURCE_CONTRACT_INVALID' });
const source = (ordinal, siteRef = 'javdb') => ({ ordinal, siteRef, integrationId: siteRef + '-main',
  configRevision: 1, endpointProfileDigest: hash, networkRouteDigest: hash, authMode: 'anonymous', queryKind: 'jav_code' });
const snapshotInput = () => ({ ruleRef: 'libra.jav.source-selection@1', ruleRevision: 1, ruleDigest: hash,
  queryAnchor: buildJavQueryAnchor('jav_code', 'IPX-177'), sources: [source(0), source(1, 'javmenu')] });
const baseHandle = () => ({ schemaRef: 'helix://contracts/types/IntegrationHandle/v1', schemaVersion: 1,
  handleId: 'handle-1', integrationId: 'tmdb-main', integrationType: 'tmdb', configRevision: 1,
  secretRef: 'secret-ref-1', allowedOperation: 'libra.product_identity.evidence.observe@1', expiresAtMs: 1000, fenceDigest: hash });
const javHandle = () => ({ ...baseHandle(), integrationId: 'javdb-main', integrationType: 'jav_source',
  siteRef: 'javdb', endpointProfileDigest: hash, networkRouteDigest: hash, authMode: 'anonymous', secretRef: null });

test('preserves full numeric identity, special suffixes and three-part scopes', () => {
  const fixtures = [
    [' ｉｐｘ＿００１７７ ', 'IPX-00177', 'standard'], ['ipx00177', 'IPX-00177', 'standard'],
    ['fc2_ppv_000718323', 'FC2-000718323', 'fc2'], ['HEY_4030_02113', 'HEYDOUGA-4030-02113', 'heydouga'],
    ['getchu4052694', 'GETCHU-4052694', 'getchu'], ['GYUTTO_242158', 'GYUTTO-242158', 'gyutto'],
    ['259luxu_001022', '259LUXU-001022', 'digital_numeric'], ['MKD_S148', 'MKD-S148', 'mugen'],
    ['S2M_01', 'S2M-01', 'mugen'], ['MK3D2DBD-02', 'MK3D2DBD-02', 'mugen'],
    ['ibw_398z', 'IBW-398Z', 'ibw'], ['IBW-398', 'IBW-398', 'ibw'],
    ['t28_557', 'T28-557', 'tma'], ['T38-001', 'T38-001', 'tma'],
    ['RED-030', 'RED030', 'tokyo_hot'], ['SKY066', 'SKY066', 'tokyo_hot'], ['EX-0010', 'EX0010', 'tokyo_hot'],
    ['N-1230', 'N1230', 'tokyo_hot'], ['K1095', 'K1095', 'tokyo_hot'], ['082713_417', '082713-417', 'date'],
  ];
  for (const [input, code, codeClass] of fixtures) {
    const anchor = buildJavQueryAnchor('jav_code', input);
    assert.equal(anchor.javCode, code, input);
    assert.equal(anchor.codeClass, codeClass, input);
    assert.equal(validateAnchor(anchor), true, JSON.stringify(validateAnchor.errors));
    assert.deepEqual(assertJavQueryAnchor(anchor), anchor);
  }
  assert.notEqual(buildJavQueryAnchor('jav_code', 'IPX-00177').anchorDigest,
    buildJavQueryAnchor('jav_code', 'IPX-177').anchorDigest);
});

test('rejects truncation, filename extraction, invalid reserved forms and Unicode case folding', () => {
  for (const input of ['IPX-177.mkv', 'some IPX-177', 'FC2-1234', 'FC2-12345678901', 'HEYDOUGA-4030',
    'HEYDOUGA-4030-2113-1', 'GETCHU-1234567890123', 'RED-999', 'SKY-499', 'EX-9999', 'N-123',
    'T38-1234', 'IBW-398ZZ', 'ßis-001', 'IPX-177\nother', 'https://example.invalid/IPX-177']) invalid(() => buildJavQueryAnchor('jav_code', input));
});

test('CID remains an independent locator and cannot gain a JAV code by aliasing', () => {
  const cid = buildJavQueryAnchor('cid', ' ＩＰＸ００１７７ ');
  assert.equal(cid.cid, 'ipx00177');
  assert.equal(Object.hasOwn(cid, 'javCode'), false);
  assert.equal(validateAnchor(cid), true);
  assert.notEqual(cid.anchorDigest, buildJavQueryAnchor('jav_code', 'ipx00177').anchorDigest);
  for (const input of ['IPX-177', '../ipx00177', 'a', 'a'.repeat(65)]) invalid(() => buildJavQueryAnchor('cid', input));
  invalid(() => assertJavQueryAnchor({ ...cid, javCode: 'IPX-177' }));
});

test('anchors reject reclassified identities, noncanonical aliases and tampered digests', () => {
  const anchor = buildJavQueryAnchor('jav_code', 'GETCHU-00123');
  const wrongClass = { ...anchor, codeClass: 'standard' };
  assert.equal(validateAnchor(wrongClass), false);
  invalid(() => assertJavQueryAnchor(wrongClass));
  invalid(() => assertJavQueryAnchor({ ...anchor, javCode: 'GETCHU_00123' }));
  invalid(() => assertJavQueryAnchor({ ...anchor, anchorDigest: '0'.repeat(64) }));
  invalid(() => assertJavQueryAnchor({ ...anchor, grammarRevision: 2 }));
});

test('freezes single-site requirements, ordered source configuration and route identity', () => {
  const input = snapshotInput(), snapshot = buildJavSourceSelectionSnapshot(input);
  assert.equal(validateSnapshot(snapshot), true, JSON.stringify(validateSnapshot.errors));
  assert.deepEqual(assertJavSourceSelectionSnapshot(snapshot), snapshot);
  assert.deepEqual(snapshot.requiredFields, ['title']);
  assert.deepEqual(snapshot.requiredSourceArtifacts, ['cover']);
  input.sources[0].configRevision = 2;
  assert.equal(snapshot.sources[0].configRevision, 1);
  assert.equal(Object.isFrozen(snapshot.sources[0]), true);
  const changedRoute = snapshotInput(); changedRoute.sources[0].networkRouteDigest = '0'.repeat(64);
  assert.notEqual(buildJavSourceSelectionSnapshot(changedRoute).snapshotDigest, snapshot.snapshotDigest);
});

test('rejects hidden source fallback, duplicate attempts, secret payloads and query substitution', () => {
  const mutations = [
    input => { input.sources = []; },
    input => { input.sources[1].ordinal = 3; },
    input => { input.sources[1] = { ...input.sources[0], ordinal: 1 }; },
    input => { input.sources[0].queryKind = 'cid'; },
    input => { input.sources[0].proxyPassword = 'not-a-secret-fixture'; },
    input => { input.sources[0].siteRef = 'arbitrary_url'; },
    input => { input.sources[0].networkRouteDigest = ''; },
    input => { input.requiredFields = ['title', 'studio']; },
    input => { input.sources = Array.from({ length: 9 }, (_, ordinal) => source(ordinal)); },
  ];
  for (const mutate of mutations) { const input = snapshotInput(); mutate(input); invalid(() => buildJavSourceSelectionSnapshot(input)); }
  const snapshot = copy(buildJavSourceSelectionSnapshot(snapshotInput()));
  snapshot.requiredSourceArtifacts = [];
  assert.equal(validateSnapshot(snapshot), false);
  invalid(() => assertJavSourceSelectionSnapshot(snapshot));
});

test('source namespaces follow the code class and never borrow unrelated provider identities', () => {
  const input = snapshotInput();
  input.queryAnchor = buildJavQueryAnchor('jav_code', 'GETCHU-4052694');
  invalid(() => buildJavSourceSelectionSnapshot(input));
  input.sources = [source(0, 'dl_getchu')];
  const getchu = buildJavSourceSelectionSnapshot(input);
  assert.equal(getchu.sources[0].siteRef, 'dl_getchu');
  assert.equal(validateSnapshot(getchu), true);
  const borrowed = copy(getchu); borrowed.sources[0] = source(0, 'javdb');
  assert.equal(validateSnapshot(borrowed), false);
  input.queryAnchor = buildJavQueryAnchor('cid', 'ipx00177');
  invalid(() => buildJavSourceSelectionSnapshot(input));
  input.sources = [{ ...source(0, 'fanza'), queryKind: 'cid' }];
  const cid = buildJavSourceSelectionSnapshot(input);
  assert.equal(cid.queryAnchor.queryKind, 'cid');
  assert.equal(validateSnapshot(cid), true);
});

test('old Secret-bound handles retain their shape and cannot become anonymous', () => {
  assert.equal(validateHandle(baseHandle()), true);
  assert.equal(validateHandle({ ...baseHandle(), secretRef: null }), false);
  assert.equal(validateHandle({ ...baseHandle(), siteRef: 'javdb' }), false);
  assert.equal(validateHandle({ ...baseHandle(), authMode: 'anonymous' }), false);
});

test('JAV handles require a complete frozen source and mutually exclusive authentication', () => {
  const handle = javHandle();
  assert.equal(validateHandle(handle), true, JSON.stringify(validateHandle.errors));
  assert.equal(validateHandle({ ...handle, authMode: 'secret', secretRef: 'javdb-session-ref' }), true);
  assert.equal(validateHandle({ ...handle, secretRef: 'javdb-session-ref' }), false);
  assert.equal(validateHandle({ ...handle, authMode: 'secret' }), false);
  for (const field of ['siteRef', 'endpointProfileDigest', 'networkRouteDigest', 'authMode', 'secretRef']) {
    const missing = { ...handle }; delete missing[field]; assert.equal(validateHandle(missing), false, field);
  }
  assert.equal(validateHandle({ ...handle, endpointProfileDigest: '' }), false);
  assert.equal(validateHandle({ ...handle, siteRef: 'arbitrary_url' }), false);
  assert.equal(validateHandle({ ...handle, cookie: 'not-a-secret-fixture' }), false);
});
