'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chooseJavTitlePrefix } = require('../../src/helix/domains/arca/model/jav-title-prefix');

const identities = code => [{ provider:'jav', namespace:'jav_code', providerKey:code }];
const fits = ({ year = '', extension = '.mkv', folderSuffix = '' } = {}) => title =>
  Buffer.byteLength(title + folderSuffix, 'utf8') <= 222 &&
  Buffer.byteLength(title + year + extension, 'utf8') <= 230 &&
  Buffer.byteLength(title + year + '.nfo', 'utf8') <= 230;

test('JAV title shortening selects the longest common UTF-8 prefix for the actual folder and member budgets', () => {
  for (const [code, title] of [
    ['HALT-094', 'HALT-094 ' + '題'.repeat(74) + 'A'],
    ['EMLB-094', 'EMLB-094 ' + '題'.repeat(85)],
  ]) {
    const chosen = chooseJavTitlePrefix({ title, providerIdentities:identities(code), fits:fits() });
    assert.equal(chosen.shortened, true);
    assert.equal(chosen.title, code + ' ' + '題'.repeat(71));
    assert.ok(Buffer.byteLength(chosen.title + '.shelfdeck-stage-' + '0'.repeat(16)) <= 255);
    assert.ok(Buffer.byteLength(chosen.title + '.mkv.restore-' + '0'.repeat(16)) <= 255);
    assert.ok(!fits()(chosen.title + '題'));
  }
});

test('the original title remains untouched when all names fit', () => {
  const title = 'A complete title';
  assert.deepEqual(chooseJavTitlePrefix({ title, providerIdentities:[], fits:fits() }), { title, shortened:false });
});

test('prefixes preserve combining and emoji graphemes and account for fixed fields', () => {
  for (const cluster of ['e\u0301', '👩🏽‍💻', '🇯🇵']) {
    const code = 'IPX-178', title = code + ' ' + cluster.repeat(100);
    const check = fits({ year:' (2026)', extension:'.webm', folderSuffix:' - edition' });
    const chosen = chooseJavTitlePrefix({ title, providerIdentities:identities(code), fits:check });
    const visible = chosen.title.slice(code.length + 1);
    assert.equal(visible, cluster.repeat(visible.length / cluster.length));
    assert.ok(check(chosen.title));
    assert.ok(!check(chosen.title + cluster));
  }
});

test('a separate title is not guessed or stripped from a similar code', () => {
  const code = 'IPX-178', title = 'IPX-1780 ' + '題'.repeat(100);
  const chosen = chooseJavTitlePrefix({ title, providerIdentities:identities(code), fits:fits() });
  assert.ok(chosen.title.startsWith('IPX-178 IPX-1780 '));
});

test('different complete titles can yield the same short name and therefore require a separate ownership check', () => {
  const code = 'IPX-178', common = code + ' ' + '題'.repeat(80);
  const first = chooseJavTitlePrefix({title:common+'A', providerIdentities:identities(code), fits:fits()});
  const second = chooseJavTitlePrefix({title:common+'B', providerIdentities:identities(code), fits:fits()});
  assert.equal(first.title, second.title);
  assert.equal(first.title, code + ' ' + '題'.repeat(71));
});

test('different shortened names can be equal under filesystem case or Unicode normalization', () => {
  const code = 'IPX-178';
  const choose = fragment => chooseJavTitlePrefix({
    title:code + ' ' + fragment + '題'.repeat(100), providerIdentities:identities(code), fits:fits(),
  }).title;
  const upper = choose('A'), lower = choose('a');
  assert.notEqual(upper, lower);
  assert.equal(upper.toLowerCase(), lower.toLowerCase());
  const composed = choose('é'), decomposed = choose('e\u0301');
  assert.notEqual(composed, decomposed);
  assert.equal(composed.normalize('NFC'), decomposed.normalize('NFC'));
});

test('shortening requires one exact canonical typed code and a fitting title grapheme', () => {
  const title = 'A'.repeat(300), check = fits();
  for (const providerIdentities of [[], identities('ipx-178'), identities('IPX178'),
    [...identities('IPX-178'), ...identities('IPX-178')]]) {
    assert.throws(() => chooseJavTitlePrefix({ title, providerIdentities, fits:check }), {code:'CLEAN_ARCA_JAV_CODE_REQUIRED'});
  }
  assert.throws(() => chooseJavTitlePrefix({ title, providerIdentities:identities('IPX-178'), fits:() => false }),
    {code:'CLEAN_ARCA_JAV_TITLE_UNFITTING'});
});

test('canonical numbers retain leading zeroes and typed suffixes', () => {
  for (const code of ['HALT-094', 'IBW-0123Z', 'HEYDOUGA-1234-001']) {
    const title = code + ' ' + '題'.repeat(100);
    const chosen = chooseJavTitlePrefix({title, providerIdentities:identities(code), fits:fits()});
    assert.ok(chosen.title.startsWith(code + ' '));
  }
});

test('invalid Unicode is rejected before either full or shortened rendering', () => {
  assert.throws(() => chooseJavTitlePrefix({title:'bad\ud800title', providerIdentities:identities('IPX-178'), fits:() => true}),
    {code:'CLEAN_ARCA_TARGET_SEGMENT_INVALID'});
});

test('a trailing space is never trimmed out of a multi-code-point grapheme', () => {
  const title = 'IPX-178 ' + '\u0600 ' + 'A'.repeat(250);
  assert.throws(() => chooseJavTitlePrefix({title, providerIdentities:identities('IPX-178'),
    fits:value => Buffer.byteLength(value, 'utf8') <= 11}), {code:'CLEAN_ARCA_JAV_TITLE_UNFITTING'});
});
