'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');

test('Docker packages every local module reachable from the default Supervisor and cold bootstrap entry points', () => {
  const root = path.resolve(__dirname, '..'), dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const sources = [...dockerfile.matchAll(/^COPY (media-service\/\S+) (\S+)$/gm)].map(match => match[1].slice('media-service/'.length));
  function included(file) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    return sources.some(source => source.includes('*') ?
      new RegExp('^' + source.split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$').test(relative) :
      relative === source || relative.startsWith(source + '/'));
  }
  const pending = ['src/server.js', 'scripts/formation-reset-bootstrap.js'].map(file => path.join(root, file)), visited = new Set(), missing = [];
  while (pending.length) {
    const file = pending.pop(); if (visited.has(file)) continue; visited.add(file);
    if (!included(file)) missing.push(path.relative(root, file));
    if (path.extname(file) !== '.js') continue;
    const resolve = createRequire(file).resolve;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\brequire\(['"](\.[^'"]+)['"]\)/g)) {
      const dependency = resolve(match[1]);
      assert.ok(dependency.startsWith(root + path.sep), 'the service image cannot require an external checkout module');
      pending.push(dependency);
    }
  }
  assert.ok(visited.size > 100, 'qualification must traverse the real Host composition');
  assert.deepEqual(missing, []);
});
