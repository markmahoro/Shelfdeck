'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workspace = require('../src/metadataArtifactWorkspace');

test('metadata artifacts are revision isolated, checksummed and atomically probed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-artifacts-'));
  try {
    const config = { workspaces: { metadataArtifacts: root }, subLibraries: [] };
    const probe = workspace.probeWorkspace(config);
    assert.strictEqual(probe.writable, true);
    assert.strictEqual(probe.atomicRenameSupported, true);
    workspace.writeArtifact(config, { itemId: 'item/1', metadataRevision: 'rev-1', name: 'metadata.nfo', content: '<movie/>', eventId: 'event-1' });
    const verified = workspace.verifyManifest(config, 'item/1', 'rev-1');
    assert.strictEqual(verified.valid, true);
    assert.ok(verified.artifacts['metadata.nfo'].sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('metadata workspace rejects overlap with media and other workspaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-artifacts-overlap-'));
  try {
    assert.throws(() => workspace.probeWorkspace({ workspaces: { metadataArtifacts: path.join(root, 'media', 'artifacts') }, subLibraries: [{ watchRoot: path.join(root, 'media') }] }), { code: 'METADATA_ARTIFACT_WORKSPACE_OVERLAP' });
    assert.throws(() => workspace.probeWorkspace({ workspaces: { metadataArtifacts: root }, transcodeTempRoot: root, subLibraries: [] }), { code: 'METADATA_ARTIFACT_WORKSPACE_OVERLAP' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
