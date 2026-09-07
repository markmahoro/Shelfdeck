'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { nfoXmlText } = require('../src/helix/contracts/nfo-xml-text');

test('NFO character data decodes entities once and leaves CDATA literal', () => {
  assert.equal(nfoXmlText('A &amp; B &lt;C&gt; &#65; &#x1f600;'), 'A & B <C> A 😀');
  assert.equal(nfoXmlText('&amp;#65; &amp;lt;'), '&#65; &lt;');
  assert.equal(nfoXmlText('<![CDATA[<tag> &amp; &#65;]]>'), '<tag> &amp; &#65;');
  assert.equal(nfoXmlText('A<!-- note --> &amp; <![CDATA[<B>]]>'), 'A & <B>');
});

test('NFO scalar text rejects markup, unsafe entities, invalid code points and malformed CDATA', () => {
  for (const value of ['<tag>A</tag>', '&entity;', 'A & B', '&#0;', '&#xD800;', '&#1114112;',
    '<![CDATA[unfinished', 'bad]]>text', 'A<!-- bad -- comment -->B', '\0']) {
    assert.equal(nfoXmlText(value), null, value);
  }
});

test('XML literal line endings normalize before entity decoding', () => {
  assert.equal(nfoXmlText('Line one\r\nLine two'), 'Line one\nLine two');
  assert.equal(nfoXmlText('<![CDATA[Line one\rLine two]]>'), 'Line one\nLine two');
  assert.equal(nfoXmlText('Line one&#13;Line two'), 'Line one\rLine two');
});
