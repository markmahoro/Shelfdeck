'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workspace = require('../src/metadataArtifactWorkspace');
const builtIns = require('../src/builtInCapabilities');
const registry = require('../src/capabilityRegistry');
const sourceAccessResolver = require('../src/sourceAccessResolver');

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

test('metadata workspace rejects parent traversal before resolving the configured path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-artifacts-escape-'));
  try {
    const configured = `${root}${path.sep}child${path.sep}..${path.sep}escaped`;
    assert.throws(() => workspace.probeWorkspace({ workspaces: { metadataArtifacts: configured } }), { code: 'METADATA_ARTIFACT_WORKSPACE_ESCAPE' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('materialize Capability consumes the current admitted source after organize/rebind without implicit Event lookup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-artifact-materialize-'));
  try {
    const artifactRoot = path.join(root, 'artifacts'); const mediaRoot = path.join(root, 'media'); fs.mkdirSync(mediaRoot);
    const mediaPath = path.join(mediaRoot, 'movie.mkv'); fs.writeFileSync(mediaPath, 'media');
    const config = { workspaces: { metadataArtifacts: artifactRoot }, subLibraries: [{ uuid: 'library', watchRoot: mediaRoot }] };
    workspace.writeArtifact(config, { itemId: 'item-1', metadataRevision: 'rev-1', name: 'metadata.nfo', content: '<movie/>', eventId: 'render' });
    builtIns.registerBuiltIns();
    let fenceCheckpoint = '';
    const result = await registry.get('metadata.artifacts.materialize').execute({ config, event: { eventId: 'materialize' }, assertFence: (checkpoint) => { fenceCheckpoint = checkpoint; }, task: { id: 'task-1', itemId: 'item-1', objectiveRevisionSnapshot: 'rev-1', sourceAccessMappingRevision: sourceAccessResolver.getRevision(), itemInfo: { path: mediaPath, metadataArtifactRevision: 'rev-1' }, helixAdmission: { sourceAccessDescriptor: { locator: { path: mediaPath } } } } });
    assert.strictEqual(fenceCheckpoint, 'before_metadata_artifacts_materialize');
    assert.strictEqual(result.result.written.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(mediaRoot, 'metadata.nfo'), 'utf8'), '<movie/>');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
