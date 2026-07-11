'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveRoot(config = {}) {
  const configured = config.workspaces && config.workspaces.metadataArtifacts;
  const dataDir = process.env.CONTROL_PLANE_DATA_DIR || process.env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.resolve(String(configured || path.join(dataDir, 'workspaces', 'metadata-artifacts')));
}
function comparable(value) { const resolved = path.resolve(String(value || '')); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; }
function overlaps(left, right) { const a = comparable(left); const b = comparable(right); return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`); }
function resolvedPhysicalPath(value) {
  const original = String(value || '');
  if (original.split(/[\\/]+/).includes('..')) throw Object.assign(new Error('Metadata artifact workspace cannot contain parent traversal'), { code: 'METADATA_ARTIFACT_WORKSPACE_ESCAPE' });
  let cursor = path.resolve(original);
  const suffix = [];
  while (!fs.existsSync(cursor)) { const parent = path.dirname(cursor); if (parent === cursor) break; suffix.unshift(path.basename(cursor)); cursor = parent; }
  const physical = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : cursor;
  return path.join(physical, ...suffix);
}
function validateLocation(config, root) {
  const configured = config.workspaces && config.workspaces.metadataArtifacts;
  if (configured && String(configured).split(/[\\/]+/).includes('..')) throw Object.assign(new Error('Metadata artifact workspace cannot contain parent traversal'), { code: 'METADATA_ARTIFACT_WORKSPACE_ESCAPE' });
  const physicalRoot = resolvedPhysicalPath(root);
  const conflicts = [config.transcodeTempRoot, config.upgradeStagingLocalPath, ...(config.subLibraries || []).map((entry) => entry.watchRoot)].filter(Boolean);
  const conflict = conflicts.find((entry) => overlaps(physicalRoot, resolvedPhysicalPath(entry)));
  if (conflict) throw Object.assign(new Error(`Metadata artifact workspace overlaps another managed path: ${conflict}`), { code: 'METADATA_ARTIFACT_WORKSPACE_OVERLAP' });
}

function safeSegment(value) { return String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180) || 'unknown'; }
function revisionDir(config, subjectId, revision) { return path.join(resolveRoot(config), 'items', safeSegment(subjectId), safeSegment(revision)); }
function checksum(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(temp, content);
  const fd = fs.openSync(temp, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  return { path: file, size: fs.statSync(file).size, sha256: checksum(fs.readFileSync(file)) };
}

function writeArtifact(config, input = {}) {
  const dir = revisionDir(config, input.subjectId, input.metadataRevision);
  const name = safeSegment(input.name);
  const record = atomicWrite(path.join(dir, name), input.content);
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest = { subjectId: input.subjectId, metadataRevision: input.metadataRevision, artifacts: {}, updatedAt: new Date().toISOString() };
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
  manifest.artifacts[name] = { ...record, source: input.source || '', eventId: input.eventId || '' };
  manifest.updatedAt = new Date().toISOString();
  atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.artifacts[name];
}

function readManifest(config, subjectId, revision) {
  const file = path.join(revisionDir(config, subjectId, revision), 'manifest.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function verifyManifest(config, subjectId, revision) {
  const manifest = readManifest(config, subjectId, revision);
  if (!manifest) return { valid: false, reason: 'manifest_missing', artifacts: {} };
  for (const [name, artifact] of Object.entries(manifest.artifacts || {})) {
    const file = path.join(revisionDir(config, subjectId, revision), safeSegment(name));
    if (!fs.existsSync(file) || checksum(fs.readFileSync(file)) !== artifact.sha256) return { valid: false, reason: 'artifact_checksum_mismatch', artifact: name, artifacts: manifest.artifacts };
  }
  return { valid: true, artifacts: manifest.artifacts, manifest };
}

function probeWorkspace(config = {}) {
  const root = resolveRoot(config);
  validateLocation(config, root);
  fs.mkdirSync(root, { recursive: true });
  const probeDir = path.join(root, '.probe');
  fs.mkdirSync(probeDir, { recursive: true });
  const source = path.join(probeDir, `${crypto.randomUUID()}.tmp`);
  const target = `${source}.renamed`;
  fs.writeFileSync(source, 'shelfdeck');
  fs.renameSync(source, target);
  const readable = fs.readFileSync(target, 'utf8') === 'shelfdeck';
  fs.unlinkSync(target);
  const stats = fs.statfsSync ? fs.statfsSync(root) : null;
  return { configuredPath: config.workspaces && config.workspaces.metadataArtifacts || '', resolvedPath: root, writable: true, atomicRenameSupported: readable, availableBytes: stats ? Number(stats.bavail) * Number(stats.bsize) : null, validationError: null };
}
function cleanupUnreferenced(config = {}, references = [], nowMs = Date.now()) {
  const root = path.join(resolveRoot(config), 'items');
  const protectedKeys = new Set((references || []).map((entry) => `${safeSegment(entry.subjectId)}\0${safeSegment(entry.artifactRevision || entry.taskId)}`));
  const retentionMs = 7 * 24 * 60 * 60 * 1000;
  let removedRevisions = 0;
  let removedBytes = 0;
  if (!fs.existsSync(root)) return { removedRevisions, removedBytes };
  for (const subjectName of fs.readdirSync(root)) {
    const itemDir = path.join(root, subjectName);
    if (!fs.statSync(itemDir).isDirectory()) continue;
    for (const revision of fs.readdirSync(itemDir)) {
      const dir = path.join(itemDir, revision);
      const stat = fs.statSync(dir);
      if (!stat.isDirectory() || protectedKeys.has(`${subjectName}\0${revision}`) || nowMs - stat.mtimeMs < retentionMs) continue;
      const size = fs.readdirSync(dir).reduce((sum, name) => { try { return sum + fs.statSync(path.join(dir, name)).size; } catch (_) { return sum; } }, 0);
      fs.rmSync(dir, { recursive: true, force: true });
      removedRevisions += 1; removedBytes += size;
    }
    if (fs.existsSync(itemDir) && fs.readdirSync(itemDir).length === 0) fs.rmdirSync(itemDir);
  }
  return { removedRevisions, removedBytes };
}

module.exports = { resolveRoot, revisionDir, writeArtifact, readManifest, verifyManifest, probeWorkspace, atomicWrite, validateLocation, overlaps, cleanupUnreferenced };
