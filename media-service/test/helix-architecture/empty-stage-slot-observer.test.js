'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { observeEmptyStageSlot } = require('../../src/helix/integrations/empty-stage-slot-observer');

function fixture(t, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-empty-slot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shelf = path.join(root, 'shelf'), directory = path.join(shelf, '.stage');
  fs.mkdirSync(directory, { recursive: true });
  const readdir = fs.readdirSync;
  let observed = false;
  t.mock.method(fs, 'readdirSync', function (location, ...args) {
    const result = readdir.call(fs, location, ...args);
    if (location === directory && !observed) {
      observed = true;
      mutate({ root, shelf, directory });
    }
    return result;
  });
  return { root, shelf, directory, observe: () => observeEmptyStageSlot({
    targetRoot: shelf, targetCommitSlotHandle: { slotId: 'slot', slotDirectory: directory },
  }) };
}

test('unrelated sibling directory activity does not invalidate an unchanged empty slot', t => {
  const f = fixture(t, ({ shelf }) => {
    fs.mkdirSync(path.join(shelf, 'other-run'));
    fs.utimesSync(shelf, new Date(1000), new Date(1000));
  });
  assert.equal(f.observe().memberCount, 0);
  assert.deepEqual(fs.readdirSync(f.directory), []);
  assert.equal(fs.existsSync(path.join(f.shelf, 'other-run')), true);
});

test('a slot changed and emptied during observation is still rejected', t => {
  const f = fixture(t, ({ directory }) => {
    const member = path.join(directory, 'transient');
    fs.writeFileSync(member, 'temporary output');
    fs.unlinkSync(member);
    fs.utimesSync(directory, new Date(1000), new Date(1000));
  });
  assert.throws(f.observe, { code: 'ARCA_STAGE_REALITY_UNPROVEN', message: 'Stage path changed during observation.' });
});

test('remaining slot output is rejected even when introduced after the first read', t => {
  const f = fixture(t, ({ directory }) => fs.writeFileSync(path.join(directory, 'output'), 'partial'));
  assert.throws(f.observe, { code: 'ARCA_STAGE_REALITY_UNPROVEN' });
  assert.equal(fs.readFileSync(path.join(f.directory, 'output'), 'utf8'), 'partial');
});

test('ancestor replacement is rejected even when the replacement slot is empty', t => {
  const f = fixture(t, ({ root, shelf, directory }) => {
    fs.renameSync(shelf, path.join(root, 'original-shelf'));
    fs.mkdirSync(directory, { recursive: true });
  });
  assert.throws(f.observe, { code: 'ARCA_STAGE_REALITY_UNPROVEN', message: 'Stage path changed during observation.' });
});

test('ancestor permission drift remains part of the observation fence', t => {
  let drift = false;
  const f = fixture(t, () => { drift = true; });
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (location, options) {
    const stat = lstat.call(fs, location, options);
    if (drift && location === f.shelf) stat.mode ^= 0o100n;
    return stat;
  });
  assert.throws(f.observe, { code: 'ARCA_STAGE_REALITY_UNPROVEN', message: 'Stage path changed during observation.' });
});
