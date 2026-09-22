'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { relatedArtworkRole } = require('../../src/helix/domains/procurement/model/related-artwork-role');

test('related artwork classification requires an exact generic name or an exact associated stem and role', () => {
  const stems = new Set(['Inside.Man (2006) [1080p]', '局内人 (2006) 1080p DTS']);
  for (const extension of ['jpg', 'jpeg', 'png', 'webp']) {
    for (const [suffix, role] of [['poster', 'poster'], ['fanart', 'fanart'], ['background', 'fanart'], ['backdrop', 'fanart']]) {
      assert.equal(relatedArtworkRole(`${suffix}.${extension}`, stems), role);
      for (const stem of stems) for (const separator of ['-', '.', '_']) {
        assert.equal(relatedArtworkRole(`${stem}${separator}${suffix}.${extension}`.toUpperCase(), stems), role);
      }
    }
  }
  for (const name of ['Other-poster.jpg', 'poster-copy.jpg', 'poster.txt',
    'InsideXMan (2006) [1080p]-poster.jpg', 'Inside.Man (2006) [1080p]-sample-poster.jpg',
    'Inside.Man (2006) [1080p]poster.jpg', '局内人 (2006) 1080p DTS-clearlogo.png',
    '局内人 (2006) 1080p DTS-poster.jpg.exe']) {
    assert.equal(relatedArtworkRole(name, stems), null, name);
  }
});
