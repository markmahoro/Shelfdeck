'use strict';

const { canonicalDigest, canonicalJson } = require('./canonical-json');

const JAV_GRAMMAR_REVISION = 1;
const JAV_CODE_PATTERNS = Object.freeze({
  fc2: '^FC2-[0-9]{5,10}$',
  heydouga: '^HEYDOUGA-[0-9]{4}-[0-9]{3,5}$',
  getchu: '^GETCHU-[0-9]{1,12}$',
  gyutto: '^GYUTTO-[0-9]{1,12}$',
  digital_numeric: '^[0-9]{1,4}[A-Z]{2,10}-[0-9]{1,8}$',
  mugen: '^(?:MKB?D-S[0-9]{2,3}|(?:MK3D2DBD|S2M|S2MBD)-[0-9]{2,3})$',
  ibw: '^IBW-[0-9]{2,5}Z?$',
  tma: '^T[23]8-[0-9]{3}$',
  tokyo_hot: '^(?:N[0-9]{4}|K[0-9]{4}|RED[01][0-9]{2}|SKY[0-3][0-9]{2}|EX00[01][0-9])$',
  date: '^[0-9]{6}-[0-9]{2,3}$',
  standard: '^[A-Z]{2,10}-[0-9]{2,5}$',
});
const CID_PATTERN = '^[a-z0-9]{2,64}$';
const RESERVED_PATTERN = '^(?:FC2|HEY|HEYDOUGA|GETCHU|GYUTTO|IBW|MKB?D|MK3D2DBD|S2MBD|S2M|T[23]8|RED|SKY|EX|N|K)(?:[-_0-9]|$)';
const JAV_SITE_REFS = Object.freeze(['javdb', 'javmenu', 'jav321', 'fc2_official',
  'caribbeancom_official', 'heydouga_official', 'avwiki', 'mgstage', 'dl_getchu', 'gyutto', 'fanza']);
const JAV_SITES_BY_CLASS = Object.freeze(Object.fromEntries(Object.entries({
  standard: ['javdb', 'javmenu', 'jav321'], fc2: ['fc2_official', 'javmenu', 'javdb'],
  date: ['javmenu', 'caribbeancom_official', 'javdb'],
  mugen: ['javmenu', 'javdb'], ibw: ['javmenu', 'javdb'], tma: ['javmenu', 'javdb'],
  tokyo_hot: ['javmenu', 'javdb'], digital_numeric: ['avwiki', 'mgstage', 'javmenu', 'javdb'],
  heydouga: ['heydouga_official', 'javmenu', 'javdb'], getchu: ['dl_getchu'], gyutto: ['gyutto'], cid: ['fanza'],
}).map(([key, sites]) => [key, Object.freeze(sites)])));
const ALIAS_RULES = Object.freeze([
  ['^FC2[-_]*(?:PPV[-_]*)?([0-9]{5,10})$', 'FC2-$1'],
  ['^(?:HEY|HEYDOUGA)[-_]*([0-9]{4})[-_]([0-9]{3,5})$', 'HEYDOUGA-$1-$2'],
  ['^(GETCHU|GYUTTO)[-_]*([0-9]{1,12})$', '$1-$2'],
  ['^(RED|SKY|EX|N|K)[-_]([0-9]+)$', '$1$2'],
  ['^([A-Z0-9]+)_([A-Z0-9]+)$', '$1-$2'],
  ['^([A-Z]{2,10})([0-9]{2,5})$', '$1-$2'],
]);
const JAV_GRAMMAR_DIGEST = canonicalDigest({ revision: JAV_GRAMMAR_REVISION,
  canonicalPatterns: JAV_CODE_PATTERNS, classificationOrder: Object.keys(JAV_CODE_PATTERNS),
  reservedPattern: RESERVED_PATTERN, cidPattern: CID_PATTERN, aliases: ALIAS_RULES });
const text = (maxLength = 256) => ({ type: 'string', minLength: 1, maxLength });
const digest = () => ({ type: 'string', pattern: '^[a-f0-9]{64}$' });
const object = properties => ({ type: 'object', additionalProperties: false,
  properties, required: Object.keys(properties) });
const enumText = values => ({ type: 'string', enum: [...values] });

function fail(message) {
  const error = new TypeError(message);
  error.code = 'JAV_SOURCE_CONTRACT_INVALID';
  throw error;
}
function exact(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) fail(label + ' has unsupported or missing fields.');
}
function validText(value, maxLength = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value.trim() === value;
}
function validDigest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function canonicalCode(value) {
  const classify = code => {
    for (const [codeClass, pattern] of Object.entries(JAV_CODE_PATTERNS)) {
      if (codeClass === 'standard' && new RegExp(RESERVED_PATTERN).test(code)) continue;
      if (new RegExp(pattern).test(code)) return { codeClass, javCode: code };
    }
    return null;
  };
  const canonical = classify(value);
  if (canonical) return canonical;
  let code = value;
  for (const [pattern, replacement] of ALIAS_RULES) {
    if (new RegExp(pattern).test(code)) { code = code.replace(new RegExp(pattern), replacement); break; }
  }
  // Reserved forms never fall through to the ordinary release-code grammar.
  const aliased = classify(code);
  if (aliased) return aliased;
  fail('The complete JAV code does not match a contracted grammar.');
}

function buildJavQueryAnchor(queryKind, input) {
  if (!['jav_code', 'cid'].includes(queryKind) || typeof input !== 'string' || input.length > 256)
    fail('JAV queries require an explicit query kind and bounded text.');
  const normalized = input.normalize('NFKC').trim();
  const fields = queryKind === 'jav_code' ? canonicalCode(normalized.replace(/[a-z]/g, char => char.toUpperCase()))
    : { cid: normalized.replace(/[A-Z]/g, char => char.toLowerCase()) };
  if (queryKind === 'cid' && !new RegExp(CID_PATTERN).test(fields.cid)) fail('CID is a bounded locator, not a JAV code.');
  const payload = { queryKind, ...fields, grammarRevision: JAV_GRAMMAR_REVISION, grammarDigest: JAV_GRAMMAR_DIGEST };
  return Object.freeze({ ...payload, anchorDigest: canonicalDigest(payload) });
}

function assertJavQueryAnchor(value) {
  const fields = value?.queryKind === 'jav_code' ? ['codeClass', 'javCode'] : ['cid'];
  exact(value, ['queryKind', ...fields, 'grammarRevision', 'grammarDigest', 'anchorDigest'], 'JAV query anchor');
  const expected = buildJavQueryAnchor(value.queryKind, value.javCode ?? value.cid);
  if (canonicalJson(value) !== canonicalJson(expected)) fail('JAV query anchor is not canonical or its grammar/digest changed.');
  return expected;
}

function javQueryAnchorSchema() {
  const common = { grammarRevision: { const: JAV_GRAMMAR_REVISION }, grammarDigest: { const: JAV_GRAMMAR_DIGEST }, anchorDigest: digest() };
  return { oneOf: [
    ...Object.entries(JAV_CODE_PATTERNS).map(([codeClass, pattern]) => object({ queryKind: { const: 'jav_code' },
      codeClass: { const: codeClass }, javCode: { type: 'string', pattern, maxLength: 64,
        ...(codeClass === 'standard' ? { not: { pattern: RESERVED_PATTERN } } : {}) }, ...common })),
    object({ queryKind: { const: 'cid' }, cid: { type: 'string', pattern: CID_PATTERN }, ...common }),
  ] };
}

function javSourceEntrySchema() {
  return object({ ordinal: { type: 'integer', minimum: 0, maximum: 7 }, siteRef: enumText(JAV_SITE_REFS),
    integrationId: text(), configRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    endpointProfileDigest: digest(), networkRouteDigest: digest(), authMode: enumText(['anonymous', 'secret']),
    queryKind: enumText(['jav_code', 'cid']) });
}

function javSourceSelectionSnapshotSchema() {
  return { ...object({ schema: { const: 'libra.jav-source-selection-snapshot@1' }, ruleRef: text(),
    ruleRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, ruleDigest: digest(),
    queryAnchor: javQueryAnchorSchema(), requiredFields: { const: ['title'] }, requiredSourceArtifacts: { const: ['cover'] },
    sources: { type: 'array', minItems: 1, maxItems: 8, items: javSourceEntrySchema() }, snapshotDigest: digest() }),
    allOf: Object.entries(JAV_SITES_BY_CLASS).map(([codeClass, sites]) => ({
      if: { properties: { queryAnchor: { properties: { queryKind: { const: codeClass === 'cid' ? 'cid' : 'jav_code' },
        ...(codeClass === 'cid' ? {} : { codeClass: { const: codeClass } }) },
        required: codeClass === 'cid' ? ['queryKind'] : ['queryKind', 'codeClass'] } }, required: ['queryAnchor'] },
      then: { properties: { sources: { items: { properties: { siteRef: enumText(sites),
        queryKind: { const: codeClass === 'cid' ? 'cid' : 'jav_code' } } } } } },
    })),
  };
}

function buildJavSourceSelectionSnapshot(value) {
  exact(value, ['ruleRef', 'ruleRevision', 'ruleDigest', 'queryAnchor', 'sources'], 'JAV source snapshot input');
  if (!validText(value.ruleRef) || !Number.isSafeInteger(value.ruleRevision) || value.ruleRevision < 1 || !validDigest(value.ruleDigest) ||
      !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 8) fail('JAV source snapshot has invalid rule or source bounds.');
  const queryAnchor = assertJavQueryAnchor(value.queryAnchor), combinations = new Set();
  const allowedSites = JAV_SITES_BY_CLASS[queryAnchor.queryKind === 'cid' ? 'cid' : queryAnchor.codeClass];
  const sources = value.sources.map((entry, ordinal) => {
    exact(entry, ['ordinal', 'siteRef', 'integrationId', 'configRevision', 'endpointProfileDigest',
      'networkRouteDigest', 'authMode', 'queryKind'], 'JAV source entry');
    if (entry.ordinal !== ordinal || !allowedSites.includes(entry.siteRef) || !validText(entry.integrationId) ||
        !Number.isSafeInteger(entry.configRevision) || entry.configRevision < 1 || !validDigest(entry.endpointProfileDigest) ||
        !validDigest(entry.networkRouteDigest) || !['anonymous', 'secret'].includes(entry.authMode) ||
        entry.queryKind !== queryAnchor.queryKind) fail('JAV sources require continuous ordinals and exact configuration/query fences.');
    const combination = canonicalJson([entry.siteRef, entry.integrationId, entry.configRevision]);
    if (combinations.has(combination)) fail('A JAV source configuration cannot be attempted twice in one snapshot.');
    combinations.add(combination);
    return Object.freeze({ ...entry });
  });
  const payload = { schema: 'libra.jav-source-selection-snapshot@1', ruleRef: value.ruleRef,
    ruleRevision: value.ruleRevision, ruleDigest: value.ruleDigest, queryAnchor,
    requiredFields: Object.freeze(['title']), requiredSourceArtifacts: Object.freeze(['cover']), sources: Object.freeze(sources) };
  const snapshot = Object.freeze({ ...payload, snapshotDigest: canonicalDigest(payload) });
  if (Buffer.byteLength(canonicalJson(snapshot), 'utf8') > 16 * 1024) fail('JAV source snapshot exceeds its canonical byte budget.');
  return snapshot;
}

function assertJavSourceSelectionSnapshot(value) {
  exact(value, ['schema', 'ruleRef', 'ruleRevision', 'ruleDigest', 'queryAnchor', 'requiredFields',
    'requiredSourceArtifacts', 'sources', 'snapshotDigest'], 'JAV source snapshot');
  const expected = buildJavSourceSelectionSnapshot({ ruleRef: value.ruleRef, ruleRevision: value.ruleRevision,
    ruleDigest: value.ruleDigest, queryAnchor: value.queryAnchor, sources: value.sources });
  if (canonicalJson(value) !== canonicalJson(expected)) fail('JAV source snapshot requirements or digest changed.');
  return expected;
}

module.exports = Object.freeze({ JAV_CODE_PATTERNS, JAV_ALIAS_RULES:ALIAS_RULES, JAV_GRAMMAR_REVISION, JAV_GRAMMAR_DIGEST, JAV_SITE_REFS, JAV_SITES_BY_CLASS,
  buildJavQueryAnchor, assertJavQueryAnchor, javQueryAnchorSchema,
  buildJavSourceSelectionSnapshot, assertJavSourceSelectionSnapshot, javSourceSelectionSnapshotSchema });
