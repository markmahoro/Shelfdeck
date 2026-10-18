'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('./helix/contracts/canonical-json');
const { createArtifactRegistry } = require('./helix/foundation/effects/artifact-registry');
const { createArtifactRepository } = require('./helix/foundation/persistence/artifact-repository');
const { createRepositoryDefinition } = require('./helix/foundation/persistence/owner-repository');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const digestBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function imageMediaType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  fail('PEOPLE_IMAGE_BYTES_INVALID', '请选择 JPEG、PNG 或 WebP 图片。');
}

function createCleanPeopleImagePort(options) {
  if (!options?.unitOfWork || !options.schemaManifest || !options.locationRegistryRepository || typeof options.rootPath !== 'string') {
    throw new TypeError('People images require clean Foundation and Platform persistence and an explicit internal root.');
  }
  const rootPath = path.resolve(options.rootPath), now = options.now || Date.now;
  const repository = createArtifactRepository(options);
  const rootId = 'service-people-reference-artifacts';
  const definition = createRepositoryDefinition({ repositoryId: 'people_image_effect_authority', owner: 'execution-foundation',
    schemaManifest: options.schemaManifest, readOnly: true, statements: {
      effect: { kind: 'select-one', tableId: 'fx_effect_journal', columns: ['effect_id', 'event_attempt_id', 'state', 'intent_digest'],
        keyColumns: ['effect_class', 'idempotency_key'] },
    } });

  function safeDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (fs.lstatSync(directory).isSymbolicLink() || normalized(fs.realpathSync(directory)) !== normalized(directory)) {
      fail('PEOPLE_IMAGE_STORAGE_UNSAFE', '人物图片目录不能经过符号链接。');
    }
  }
  function controlledRoot(allowCreate = false) {
    safeDirectory(rootPath);
    const previous = options.locationRegistryRepository.getWorkspaceRoot(rootId);
    if (previous) {
      if (path.resolve(previous.resolvedRoot) !== rootPath || previous.rootKind !== 'internal-artifact' || previous.ownerScope !== 'platform-settings' || previous.state !== 'active') {
        fail('PEOPLE_IMAGE_ROOT_CONFLICT', '人物图片目录与已保存的平台配置不一致。');
      }
      return previous;
    }
    if (!allowCreate) fail('PEOPLE_IMAGE_ROOT_CONFLICT', '人物图片的平台目录记录缺失。');
    const basis = { rootId, ownerScope: 'platform-settings', rootKind: 'internal-artifact', endpointId: 'service-local-artifacts',
      mountScopeId: canonicalDigest({ schema: 'platform.internal-people-artifact-mount@1', rootId }), mountScopeRevision: 1,
      configRevision: 1, capabilityDigest: canonicalDigest({ operations: ['read', 'no_overwrite_publish', 'stat'] }), state: 'active' };
    const rootHandleRef = canonicalDigest({ schema: 'platform.workspace-root-handle@1', rootId, endpointId: basis.endpointId,
      mountScopeId: basis.mountScopeId, mountScopeRevision: 1, configRevision: 1, capabilityDigest: basis.capabilityDigest });
    const value = { ...basis, rootHandleRef, resolvedRoot: rootPath, snapshotDigest: canonicalDigest({ ...basis, rootHandleRef }), updatedAtMs: now() };
    return options.locationRegistryRepository.publishWorkspaceRoot(value, null, roots => {
      for (const root of roots.filter(item => item.state === 'active')) {
        const relative = path.relative(root.resolvedRoot, rootPath), reverse = path.relative(rootPath, root.resolvedRoot);
        if (!relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) ||
            !reverse || !reverse.startsWith('..' + path.sep) && reverse !== '..' && !path.isAbsolute(reverse)) {
          fail('PEOPLE_IMAGE_ROOT_CONFLICT', '人物图片目录与其他工作区重叠。');
        }
      }
    });
  }
  function fileFor(id) {
    if (!SHA256.test(id)) fail('PEOPLE_IMAGE_STORAGE_REFERENCE_INVALID', '人物图片存储引用无效。');
    return path.join(rootPath, id);
  }
  function readExact(file, expectedDigest, expectedSize) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== expectedSize || stat.size > MAX_IMAGE_BYTES) {
      fail('PEOPLE_IMAGE_STORAGE_CHANGED', '人物图片文件已变化。');
    }
    const bytes = fs.readFileSync(file);
    if (digestBytes(bytes) !== expectedDigest) fail('PEOPLE_IMAGE_STORAGE_CHANGED', '人物图片校验值已变化。');
    return bytes;
  }
  function publish(file, bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('PEOPLE_IMAGE_BYTES_INVALID', '人物图片大小必须在 10 MiB 内。');
    if (fs.existsSync(file)) { readExact(file, digestBytes(bytes), bytes.length); return; }
    const temporary = file + '.partial-' + crypto.randomBytes(8).toString('hex');
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = null;
      try { fs.linkSync(temporary, file); }
      catch (error) { if (error.code !== 'EEXIST') throw error; readExact(file, digestBytes(bytes), bytes.length); }
    } finally { if (descriptor !== null && descriptor !== undefined) fs.closeSync(descriptor); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    if(process.platform==='linux'){
      const directory=fs.openSync(rootPath,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
    }
    readExact(file, digestBytes(bytes), bytes.length);
  }
  function parseStorageRef(storageRef) {
    if (typeof storageRef !== 'string' || !storageRef.startsWith('people-artifact:')) fail('PEOPLE_IMAGE_STORAGE_REFERENCE_INVALID', '人物图片存储引用无效。');
    return fileFor(storageRef.slice('people-artifact:'.length));
  }
  const registry = createArtifactRegistry({ repository, createIntentId: crypto.randomUUID,
    rootResolver: { resolve(input) {
      const root = controlledRoot();
      if (input.rootId !== root.rootId || input.expectedConfigRevision !== root.configRevision || input.ownerScope !== root.ownerScope || input.rootKind !== root.rootKind) {
        fail('PEOPLE_IMAGE_ROOT_CONFLICT', '人物图片平台目录版本已变化。');
      }
      return root;
    } },
    storageResolver: {
      resolveNew(input) { if (input.resolvedRoot !== rootPath) fail('PEOPLE_IMAGE_ROOT_CONFLICT', '人物图片平台目录已变化。'); return { storageRef: 'people-artifact:' + input.relativePath, resolvedPath: fileFor(input.relativePath) }; },
      resolveStored(storageRef) { return { rootId, rootConfigRevision: controlledRoot().configRevision, resolvedRoot: rootPath, resolvedPath: parseStorageRef(storageRef) }; },
    },
    pathAuthority: { contains: (root, file) => path.dirname(file) === root && SHA256.test(path.basename(file)) },
    storageProbe: { inspect({ resolvedPath }) {
      const stat = fs.lstatSync(resolvedPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_IMAGE_BYTES) fail('PEOPLE_IMAGE_STORAGE_CHANGED', '人物图片文件无效。');
      const bytes = fs.readFileSync(resolvedPath);
      return { exists: true, digestAlgorithm: 'sha256', digestHex: digestBytes(bytes), sizeBytes: bytes.length,
        mediaType: bytes[0] === 123 ? 'application/vnd.shelfdeck.face-embedding+json' : imageMediaType(bytes) };
    } },
    gcAuthorityVerifier: { verify: () => false },
  });

  function stageUpload({ bytes, actorId, idempotencyKey, provenance = null }) {
    if (!TOKEN.test(actorId) || typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 256 ||
        !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('PEOPLE_IMAGE_UPLOAD_INVALID', '人物图片上传参数无效。');
    const mediaType = imageMediaType(bytes), digestHex = digestBytes(bytes);
    safeDirectory(rootPath); safeDirectory(path.join(rootPath, 'uploads'));
    const uploadId = canonicalDigest({ schema: 'people.selected-upload@1', actorId, idempotencyKey, digestHex });
    publish(path.join(rootPath, 'uploads', uploadId), bytes);
    const basis = { schemaRef: 'helix://contracts/domain-types/PeopleSelectedImageHandle/v1', schemaVersion: 1, uploadId, digestHex, sizeBytes: bytes.length, mediaType,
      provenance: provenance || { source: 'user_upload' } };
    return Object.freeze({ ...basis, handleDigest: canonicalDigest(basis) });
  }
  function readUpload(handle) {
    if (!handle || Object.keys(handle).sort().join(',') !== 'digestHex,handleDigest,mediaType,provenance,schemaRef,schemaVersion,sizeBytes,uploadId' ||
        handle.schemaRef !== 'helix://contracts/domain-types/PeopleSelectedImageHandle/v1' || handle.schemaVersion !== 1 || !SHA256.test(handle.uploadId) || !SHA256.test(handle.digestHex) ||
        handle.handleDigest !== canonicalDigest(Object.fromEntries(Object.entries(handle).filter(([key]) => key !== 'handleDigest')))) {
      fail('PEOPLE_IMAGE_UPLOAD_INVALID', '人物图片上传引用无效。');
    }
    safeDirectory(rootPath); safeDirectory(path.join(rootPath, 'uploads'));
    const bytes = readExact(path.join(rootPath, 'uploads', handle.uploadId), handle.digestHex, handle.sizeBytes);
    if (imageMediaType(bytes) !== handle.mediaType) fail('PEOPLE_IMAGE_UPLOAD_INVALID', '人物图片类型不一致。');
    return bytes;
  }
  function requireEffect(context) {
    const result = options.unitOfWork.execute([{ participantId: 'people_image_effect_authority', owner: 'execution-foundation', repositories: [definition],
      execute: tx => tx.repository(definition.repositoryId).invoke('effect', { effect_class: 'workspace_write', idempotency_key: context?.idempotencyKey }) }]).people_image_effect_authority;
    if (!context?.eventAttemptId || result?.event_attempt_id !== context.eventAttemptId ||
        !(result?.state === 'intended' || result?.state === 'reconcile_required' && ['safe_retry', 'continue_forward'].includes(context.recoveryDecision))) {
      fail('PEOPLE_IMAGE_EFFECT_AUTHORITY_REQUIRED', '图片准备缺少正式执行授权。');
    }
    return result;
  }
  function materialize({ context, personId, operationId, artifactKind, bytes, provenanceRef }) {
    requireEffect(context);
    if (!TOKEN.test(personId) || !TOKEN.test(operationId) || !['reference-image', 'reference-embedding'].includes(artifactKind)) fail('PEOPLE_IMAGE_ARTIFACT_INPUT_INVALID', '人物图片产物参数无效。');
    context.assertExecutionActive();
    const root = controlledRoot(true), artifactHandleId = canonicalDigest({ schema: 'people.reference-artifact-id@1', personId, artifactKind, digestHex:digestBytes(bytes) });
    const mediaType = artifactKind === 'reference-image' ? imageMediaType(bytes) : 'application/vnd.shelfdeck.face-embedding+json';
    const intentId=canonicalDigest({schema:'people.reference-publication-intent-id@1',personId,operationId,artifactKind});
    publish(fileFor(intentId),Buffer.from(canonicalJson({schema:'people.reference-publication-intent@1',personId,operationId,artifactKind,
      artifactHandleId,digestHex:digestBytes(bytes),sizeBytes:bytes.length})));
    publish(fileFor(artifactHandleId), bytes);
    options.afterPhysicalEffect?.({ operationId, artifactKind });
    return registry.register({ artifactHandleId, artifactKind, ownerDomain: 'people', ownerScopeType: 'person', ownerScopeId: personId,
      rootId, rootConfigRevision: root.configRevision, relativePath: artifactHandleId, digestHex: digestBytes(bytes), sizeBytes: bytes.length,
      mediaType, provenanceRef, createdAtMs: now() });
  }
  function readArtifact(handle) {
    const record = repository.get(handle?.artifactHandleId);
    if (!record || record.state !== 'active' || record.ownerDomain !== 'people' || record.ownerScopeType !== 'person' ||
        record.ownerScopeId !== handle.ownerScope?.scopeId || record.digestHex !== handle.digestHex || record.artifactKind !== handle.artifactKind ||
        record.storageRef !== handle.storageRef || record.sizeBytes !== handle.sizeBytes) fail('PEOPLE_IMAGE_ARTIFACT_CHANGED', '人物图片引用已变化。');
    controlledRoot(); return readExact(parseStorageRef(record.storageRef), record.digestHex, record.sizeBytes);
  }
  return Object.freeze({ stageUpload, readUpload, materialize, readArtifact,
    readReferenceImage({ personId, artifactHandleId, artifactDigest }) {
      const record = repository.get(artifactHandleId);
      if (!record || record.state !== 'active' || record.ownerDomain !== 'people' || record.ownerScopeType !== 'person' ||
          record.ownerScopeId !== personId || record.artifactKind !== 'reference-image' || record.digestHex !== artifactDigest) {
        fail('PEOPLE_IMAGE_ARTIFACT_CHANGED', '演员参考图已变化或不属于此人物。');
      }
      controlledRoot();
      return Object.freeze({ bytes: readExact(parseStorageRef(record.storageRef), record.digestHex, record.sizeBytes), contentType: record.mediaType });
    },
  });
}

module.exports = Object.freeze({ createCleanPeopleImagePort, imageMediaType });
