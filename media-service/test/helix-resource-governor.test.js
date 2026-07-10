'use strict';

const assert = require('node:assert');
const test = require('node:test');
const governor = require('../src/resourceGovernor');

test.afterEach(() => governor.resetForTests());

test('Resource Governor bounds capacity and releases the next waiter', async () => {
  governor.configure({ resourceGovernor: { capacities: { 'local:ffmpeg': 1 } } });
  const first = await governor.acquire({ owner: 'kairox', workId: 'a', resourceKey: 'local:ffmpeg' });
  let secondResolved = false;
  const secondPromise = governor.acquire({ owner: 'kairox', workId: 'b', resourceKey: 'local:ffmpeg' }).then((permit) => {
    secondResolved = true;
    return permit;
  });
  await Promise.resolve();
  assert.strictEqual(secondResolved, false);
  assert.strictEqual(governor.snapshot().resources.find((entry) => entry.resourceKey === 'local:ffmpeg').waiting, 1);
  first.release();
  const second = await secondPromise;
  assert.strictEqual(secondResolved, true);
  second.release();
});

test('runWithPermit releases capacity after failure', async () => {
  await assert.rejects(
    governor.runWithPermit({ owner: 'libra', workId: 'x', resourceKey: 'control:libra' }, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.strictEqual(governor.snapshot().activePermits.length, 0);
});

test('Resource Governor rejects a bounded wait queue overflow', async () => {
  governor.configure({ resourceGovernor: { capacities: { 'emby:s1:api': 1 }, defaultQueueLimit: 1 } });
  const active = await governor.acquire({ owner: 'libra', workId: 'a', resourceKey: 'emby:s1:api' });
  const waiting = governor.acquire({ owner: 'libra', workId: 'b', resourceKey: 'emby:s1:api' });
  await assert.rejects(
    governor.acquire({ owner: 'libra', workId: 'c', resourceKey: 'emby:s1:api' }),
    (error) => error.code === 'RESOURCE_QUEUE_FULL',
  );
  active.release();
  const next = await waiting;
  next.release();
});

test('Libra control work remains live while Optimize holds FFmpeg capacity', async () => {
  governor.resetForTests();
  governor.configure({ resourceGovernor: { capacities: { 'control:libra': 1, 'local:ffmpeg': 1 } } });
  const ffmpeg = await governor.acquire({ owner: 'kairox', workId: 'optimize-1', resourceKey: 'local:ffmpeg' });
  let secondResolved = false;
  const second = governor.acquire({ owner: 'kairox', workId: 'optimize-2', resourceKey: 'local:ffmpeg' })
    .then((permit) => { secondResolved = true; return permit; });
  const control = await governor.acquire({ owner: 'libra', workId: 'observe-1', resourceKey: 'control:libra' });
  assert.strictEqual(secondResolved, false);
  assert.strictEqual(control.resourceKey, 'control:libra');
  control.release();
  ffmpeg.release();
  (await second).release();
});
