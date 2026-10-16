'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { titleAliases, titleAssociationAliases, deriveTitleEvidence } =
  require('../../src/helix/domains/perception/model/perception-aliases');

test('bounded title memoization preserves option scope, immutable output and original evidence', () => {
  const title = 'ＡＢＣ / Other title - 1080p WEB-DL HEVC';
  const options = { providerDelimited: true };
  const first = titleAssociationAliases(title, options);
  assert.deepEqual(first, ['ABC', 'Other title']);
  assert.strictEqual(titleAssociationAliases(title, options), first);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(titleAliases(title, options), ['ABC', 'Other title - 1080p WEB-DL HEVC']);
  assert.deepEqual(titleAliases(title, { ...options, stripTechnical: true }),
    ['ABC', 'Other title - 1080p WEB-DL HEVC', 'Other title']);
  assert.deepEqual(titleAssociationAliases(title), ['ABC / Other title']);
  const evidence = deriveTitleEvidence(title + '\0' + '2002', options);
  assert.notEqual(evidence[0].evidenceDigest,
    deriveTitleEvidence(title + '\0' + '2003', options)[0].evidenceDigest);
  for (let i = 0; i < 8193; i++) titleAssociationAliases('Eviction title ' + i, options);
  const rebuilt = titleAssociationAliases(title, options);
  assert.notStrictEqual(rebuilt, first);
  assert.deepEqual(rebuilt, first);
  assert.deepEqual(deriveTitleEvidence(title + '\0' + '2002', options), evidence);
  const long = 'x'.repeat(513);
  assert.notStrictEqual(titleAssociationAliases(long), titleAssociationAliases(long));
  assert.deepEqual(titleAssociationAliases(long), [long]);
});
