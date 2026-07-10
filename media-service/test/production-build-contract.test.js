'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

test('production image build has a cross-platform Node entry and a thin shell wrapper', () => {
  const nodeSource = fs.readFileSync(path.join(root, 'scripts', 'build-image.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(root, 'scripts', 'build-image.sh'), 'utf8');
  assert.match(nodeSource, /docker[\s\S]*build/);
  assert.match(nodeSource, /docker[\s\S]*save/);
  assert.match(nodeSource, /Refusing to reuse an existing production tarball/);
  assert.match(nodeSource, /SHA-256/);
  assert.match(shellSource, /exec node .*build-image\.js/);
  assert.doesNotMatch(shellSource, /docker build|docker save/);
});
