'use strict';

/**
 * Contract seam: each catalogue Host Event owns a buffalo CPU session and must
 * release it when the Event finishes (success or failure). Orphan sessions are
 * not a People-prep concern; they violate the Host Event session boundary.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PORTS = path.resolve(__dirname, '../../src/clean-us-adult-catalogue-ports.js');
const HOST = path.resolve(__dirname, '../../src/clean-service-host.js');

test('catalogue Host factories stop the Event CPU session in finally', () => {
  const source = fs.readFileSync(PORTS, 'utf8');
  assert.match(source, /async function stopSession/);
  assert.match(source, /withSessionStop/);
  assert.match(source, /finally\{await stopSession\(cpuSession\);\}/);
  assert.match(source, /extractFrames:withSessionStop/);
  assert.match(source, /computeEmbeddings:withSessionStop/);
  assert.match(source, /computeClusters:withSessionStop/);
});

test('People buffalo reference preparation creates a model-only CPU session', () => {
  const host = fs.readFileSync(HOST, 'utf8');
  const block = host.match(/buffaloPeoplePreparation[\s\S]*?createPeopleReferencePreparation/);
  assert.ok(block, 'buffaloPeoplePreparation wiring must exist');
  assert.match(block[0], /modelRoot:catalogueHostConfig\.buffaloModelRoot/);
  assert.doesNotMatch(block[0], /catalogueRoot:catalogueHostConfig\.catalogueRoot/);
  assert.doesNotMatch(block[0], /catalogueGeneration:/);
});
