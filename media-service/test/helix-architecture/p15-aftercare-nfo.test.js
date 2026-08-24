'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AftercareNfoError,
  MAX_NFO_BYTES,
  createAftercareMovieNfo,
  inspectAftercareMovieNfo,
  renderAftercareMovieNfo,
  updateAftercareMovieNfo,
} = require('../../src/helix/domains/arca/model/aftercare-nfo');

function input(overrides = {}) {
  return {
    metadata:{ descriptiveFacts:{ entries:[
      { key:'title', value:'倩女幽魂' },
      { key:'year_or_release_date', value:1987 },
      { key:'plot', value:'更新后的简介 & 说明' },
      { key:'genres', value:['爱情', '奇幻'] },
    ] } },
    cast:{ relations:[
      { role:'actor', displayName:'张国荣', providerIdentities:[
        { provider:'tmdb', namespace:'tmdb_person', providerKey:'123' },
      ] },
      { role:'actor', displayName:'王祖贤', providerIdentities:[
        { provider:'tmdb', namespace:'tmdb_person', providerKey:'124' },
      ] },
      { role:'director', displayName:'程小东', providerIdentities:[] },
    ] },
    identity:{ provider:'tmdb', providerKey:'12345' },
    ...overrides,
  };
}

test('Aftercare movie NFO inspection is byte-bounded and rejects unsafe or malformed XML', () => {
  assert.equal(inspectAftercareMovieNfo(Buffer.from('<movie><title>合法</title></movie>')).usable, true);
  const cases = [
    [Buffer.alloc(MAX_NFO_BYTES + 1, 0x20), 'too_large'],
    [Buffer.from([0xc3, 0x28]), 'invalid_utf8'],
    [Buffer.from('<!DOCTYPE movie [<!ENTITY x "y">]><movie/>'), 'declaration_forbidden'],
    [Buffer.from('<movie><title>bad</movie></title>'), 'unbalanced_tags'],
    [Buffer.from('<movie></movie><movie></movie>'), 'movie_root_required'],
    [Buffer.from('<movie><title>&unknown;</title></movie>'), 'invalid_entity'],
    [Buffer.from('<tvshow><title>wrong root</title></tvshow>'), 'movie_root_required'],
  ];
  for (const [bytes, reasonCode] of cases) {
    assert.deepEqual(inspectAftercareMovieNfo(bytes), { usable:false, reasonCode });
  }
});

test('movie identity inspection ignores actor and collection TMDB identifiers', () => {
  const inspected = inspectAftercareMovieNfo(Buffer.from(`<movie>
    <title>007：大破天幕杀机</title>
    <actor><name>Daniel Craig</name><tmdbid>8784</tmdbid></actor>
    <set><name>James Bond Collection</name><tmdbid>645</tmdbid></set>
    <uniqueid type="tmdb">37724</uniqueid>
  </movie>`));
  assert.equal(inspected.usable, true);
  assert.deepEqual(inspected.movieIdentity, { provider:'tmdb', providerKey:'37724' });

  assert.deepEqual(inspectAftercareMovieNfo(Buffer.from(
    '<movie><tmdbid>11</tmdbid><uniqueid type="tmdb">22</uniqueid></movie>',
  )), { usable:false, reasonCode:'movie_identity_conflict' });
});

test('create renders deterministic owned metadata, movie identity, and actor strong identities', () => {
  const first = createAftercareMovieNfo(input());
  const second = createAftercareMovieNfo(input());
  assert.equal(first.disposition, 'create');
  assert.equal(first.reasonCode, 'source_missing');
  assert.deepEqual(first.bytes, second.bytes);
  const xml = first.bytes.toString('utf8');
  assert.match(xml, /^<movie>\n/);
  assert.match(xml, /<title>倩女幽魂<\/title>/);
  assert.match(xml, /<plot>更新后的简介 &amp; 说明<\/plot>/);
  assert.match(xml, /<genre>爱情 \/ 奇幻<\/genre>/);
  assert.match(xml, /<tmdbid>12345<\/tmdbid>/);
  assert.match(xml, /<uniqueid type="tmdb">12345<\/uniqueid>/);
  assert.match(xml, /<name>张国荣<\/name>\n    <tmdbid>123<\/tmdbid>/);
  assert.doesNotMatch(xml, /程小东/);
  assert.equal(inspectAftercareMovieNfo(first.bytes).usable, true);
});

test('a usable NFO is updated without losing rich, unknown, or existing strong actor fields', () => {
  const source = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<movie custom="preserved">
  <title>旧标题</title>
  <year>1986</year>
  <plot>旧简介</plot>
  <tmdbid>12345</tmdbid>
  <uniqueid type="imdb">tt0012345</uniqueid>
  <uniqueid type="tmdb" default="true">12345</uniqueid>
  <ratings><rating name="douban"><value>8.8</value></rating></ratings>
  <set><title>嵌套标题不可被更新</title></set>
  <actor><name>张国荣</name><tmdbid>123</tmdbid><thumb>keep.jpg</thumb></actor>
  <actor><name>王祖贤</name><role>小倩</role></actor>
  <actor><name>旧演员</name><tmdbid>999</tmdbid></actor>
  <customfield keep="yes">自定义内容</customfield>
</movie>
`);
  const before = Buffer.from(source);
  const result = renderAftercareMovieNfo(input({ existingBytes:source }));
  assert.equal(result.disposition, 'update');
  assert.deepEqual(source, before, 'pure renderer must not mutate source bytes');
  const xml = result.bytes.toString('utf8');
  for (const preserved of ['custom="preserved"', 'tt0012345', 'douban', '嵌套标题不可被更新',
    'keep.jpg', '<role>小倩</role>', '旧演员', '自定义内容']) {
    assert.ok(xml.includes(preserved), 'preserves ' + preserved);
  }
  assert.match(xml, /<title>倩女幽魂<\/title>/);
  assert.match(xml, /<year>1987<\/year>/);
  assert.match(xml, /<plot>更新后的简介 &amp; 说明<\/plot>/);
  assert.match(xml, /<uniqueid type="tmdb" default="true">12345<\/uniqueid>/);
  assert.equal((xml.match(/<name>张国荣<\/name>/g) || []).length, 1);
  assert.equal((xml.match(/<name>王祖贤<\/name>/g) || []).length, 1);
  assert.match(xml, /<name>王祖贤<\/name><role>小倩<\/role>\n    <tmdbid>124<\/tmdbid>/);
  assert.match(xml, /<name>旧演员<\/name><tmdbid>999<\/tmdbid>/);
  assert.equal(inspectAftercareMovieNfo(result.bytes).usable, true);
});

test('damaged, unsafe, oversized, and movie-identity-conflicting NFOs are rebuilt', () => {
  const samples = [
    [Buffer.from('<movie><title>broken</movie>'), 'unbalanced_tags'],
    [Buffer.from('<movie><title>wrong</title><tmdbid>99</tmdbid></movie>'), 'movie_identity_conflict'],
    [Buffer.alloc(MAX_NFO_BYTES + 1, 0x20), 'too_large'],
  ];
  for (const [existingBytes, reasonCode] of samples) {
    const result = renderAftercareMovieNfo(input({ existingBytes }));
    assert.equal(result.disposition, 'rebuild');
    assert.equal(result.reasonCode, reasonCode);
    const xml = result.bytes.toString('utf8');
    assert.match(xml, /<title>倩女幽魂<\/title>/);
    assert.match(xml, /<tmdbid>12345<\/tmdbid>/);
    assert.doesNotMatch(xml, /broken|wrong/);
    assert.equal(inspectAftercareMovieNfo(result.bytes).usable, true);
  }
});

test('missing NFO is created and direct update refuses an unusable or conflicting source', () => {
  assert.equal(renderAftercareMovieNfo(input({ existingBytes:null })).disposition, 'create');
  assert.throws(() => updateAftercareMovieNfo(input({ existingBytes:Buffer.from('<movie>') })),
    (error) => error instanceof AftercareNfoError && error.code === 'ARCA_AFTERCARE_NFO_UPDATE_SOURCE_INVALID');
  assert.throws(() => updateAftercareMovieNfo(input({ existingBytes:Buffer.from(
    '<movie><tmdbid>99</tmdbid></movie>',
  ) })), (error) => error instanceof AftercareNfoError && error.code === 'ARCA_AFTERCARE_NFO_UPDATE_IDENTITY_CONFLICT');
});

test('rendering fails closed when owned metadata would exceed the NFO byte bound', () => {
  const oversized = input({ metadata:{ entries:[{ key:'title', value:'x'.repeat(MAX_NFO_BYTES) }] } });
  assert.throws(() => createAftercareMovieNfo(oversized),
    (error) => error instanceof AftercareNfoError && error.code === 'ARCA_AFTERCARE_NFO_OUTPUT_TOO_LARGE');
  assert.throws(() => createAftercareMovieNfo(input({ identity:{ provider:'tmdb', providerKey:'  ' } })),
    (error) => error instanceof AftercareNfoError && error.code === 'ARCA_AFTERCARE_NFO_IDENTITY_INVALID');
});
