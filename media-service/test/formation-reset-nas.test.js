'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BACKUP_ROOT,
  CONFIRMATION,
  backupCommand,
  imageCommand,
  parseArgs,
  resetCommand,
} = require('../../scripts/formation-reset-nas');

test('NAS Formation Reset has one contract and requires its apply confirmation', () => {
  assert.deepEqual(parseArgs([]), { apply:false, confirm:'' });
  assert.throws(() => parseArgs(['--mode','nuclear']), /Unknown argument/);
  assert.throws(() => parseArgs(['--apply']), /FORMATION_RESET_V2/);
  assert.deepEqual(parseArgs(['--apply','--confirm',CONFIRMATION]),
    { apply:true, confirm:CONFIRMATION });
});

test('NAS Formation Reset command is offline, image-bounded, and mounts only data and transcode', () => {
  const command = resetCommand('markmahoro/shelfdeck:test',true);
  assert.match(command, /helix-formation-reset\.js/);
  assert.doesNotMatch(command, /--mode/);
  assert.match(command, /--offline-confirmed/);
  assert.match(command, /FORMATION_RESET_V2/);
  assert.match(command, /shelfdeck\/data:\/app\/data/);
  assert.match(command, /shelfdeck_transcode:\/transcode/);
  assert.doesNotMatch(command, /:\/media/);
});

test('NAS Formation Reset backup command is fenced below the application backup root', () => {
  const command = backupCommand(`${BACKUP_ROOT}/formation-reset-test-normal`);
  assert.match(command, /unsafe backup path/);
  assert.match(command, /test ! -L/);
  assert.match(command, /test ! -e/);
  assert.match(command, /sha256sum/);
  assert.match(command, /shelfdeck\.db/);
});

test('NAS Formation Reset pins the exact image ID of the running container', () => {
  const command = imageCommand();
  assert.match(command, /docker compose ps -q shelfdeck/);
  assert.match(command, /\{\{\.Image\}\}/);
  assert.doesNotMatch(command, /Config\.Image/);
});
