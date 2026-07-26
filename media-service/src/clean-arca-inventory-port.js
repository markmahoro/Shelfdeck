'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalDigest,
  canonicalJson,
} = require('./helix/contracts/canonical-json');
const {
  createRepositoryDefinition,
} = require('./helix/foundation/persistence/owner-repository');

class CleanArcaInventoryPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanArcaInventoryPortError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanArcaInventoryPortError(code, message, details);
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeSegment(value) {
  const segment = String(value || '').trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (!segment || segment === '.' || segment === '..') {
    fail('CLEAN_ARCA_TARGET_SEGMENT_INVALID',
      'Final Inventory path contains an invalid segment.');
  }
  return segment.slice(0, 180);
}

function contained(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function foundationDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'clean_arca_inventory_effects',
    owner: 'execution-foundation',
    schemaManifest,
    statements: {
      find_effect: {
        kind: 'select-one',
        tableId: 'fx_effect_journal',
        columns: [
          'effect_id', 'effect_class', 'idempotency_key', 'intent_digest',
          'state', 'external_receipt_ref', 'output_digest', 'verified_at_ms',
          'updated_at_ms',
        ],
        keyColumns: ['effect_class', 'idempotency_key'],
        safeIntegers: true,
      },
      insert_effect: {
        kind: 'insert',
        tableId: 'fx_effect_journal',
        columns: [
          'effect_id', 'event_attempt_id', 'effect_class', 'idempotency_key',
          'intent_digest', 'state', 'external_receipt_ref', 'output_digest',
          'verified_at_ms', 'updated_at_ms',
        ],
      },
      commit_effect: {
        kind: 'update',
        tableId: 'fx_effect_journal',
        setColumns: [
          'state', 'external_receipt_ref', 'output_digest', 'verified_at_ms',
          'updated_at_ms',
        ],
        keyColumns: ['effect_id'],
        compareColumns: [
          { column: 'state', parameter: 'expected_state' },
          { column: 'intent_digest', parameter: 'expected_intent_digest' },
        ],
      },
    },
  });
}

function createCleanArcaInventoryPort(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      typeof options.workspaceRoot !== 'string' || !options.workspaceRoot) {
    fail('CLEAN_ARCA_INVENTORY_DEPENDENCIES',
      'Arca Inventory Port requires clean persistence and the service Workspace root.');
  }
  const foundation = foundationDefinition(options.schemaManifest);
  const workspaceRoot = path.resolve(options.workspaceRoot);

  function execute(participantId, body) {
    return options.unitOfWork.execute([{
      participantId,
      owner: 'execution-foundation',
      repositories: [foundation],
      execute: body,
    }])[participantId];
  }

  function sourcePath(member) {
    if (member.workspaceMaterialHandle) {
      const handle = member.workspaceMaterialHandle;
      const root = path.resolve(workspaceRoot, handle.workspaceId);
      const source = path.resolve(root,
        ...String(handle.relativePath || '').split('/'));
      if (!contained(root, source) ||
          handle.ownerDomain !== 'libra' ||
          handle.materialKey !== member.materialKey) {
        fail('CLEAN_ARCA_WORKSPACE_SOURCE_INVALID',
          'Workspace Product source escaped its immutable Handle.');
      }
      return source;
    }
    const source = path.resolve(member.location?.location || '');
    if (!member.location ||
        !['domain_binding', 'physical_path'].includes(
          member.location.locationKind,
        ) ||
        !member.location.location) {
      fail('CLEAN_ARCA_PRODUCT_SOURCE_INVALID',
        'Direct Product source requires its immutable physical location.');
    }
    return source;
  }

  function targetName(member, primaryBase) {
    if (member.role === 'primary_payload') {
      return path.basename(sourcePath(member));
    }
    const extensions = {
      metadata_sidecar: '.nfo',
      poster: '.jpg',
      fanart: '.jpg',
      subtitle: '.srt',
      external_audio: '.mka',
      chapter: '.xml',
    };
    const extension = extensions[member.role] ||
      path.extname(sourcePath(member)) || '.bin';
    const suffixes = {
      poster: '-poster',
      fanart: '-fanart',
      subtitle: '',
      external_audio: '-audio',
      chapter: '-chapters',
    };
    return primaryBase + (suffixes[member.role] || '') + extension;
  }

  function observe(source, member) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      fail('CLEAN_ARCA_PRODUCT_SOURCE_MISSING',
        'Product Material source is unavailable.', {
          materialKey: member.materialKey,
        });
    }
    const stat = fs.statSync(source);
    const digestHex = digestFile(source);
    if (stat.size !== member.sizeBytes ||
        digestHex !== member.physicalIdentity.contentHash) {
      fail('CLEAN_ARCA_PRODUCT_SOURCE_DRIFT',
        'Product Material bytes drifted from the immutable Package.', {
          materialKey: member.materialKey,
        });
    }
    return Object.freeze({ sizeBytes: stat.size, digestHex });
  }

  function buildPlan(request) {
    const targetRoot = path.resolve(request?.shelf?.target?.rootLocation || '');
    const shelf = request?.shelf;
    const packageValue = request?.onDeckProductPackage;
    if (!shelf || shelf.status !== 'active' || !packageValue ||
        shelf.shelfId !== packageValue.shelfId ||
        !Array.isArray(packageValue.productMaterialManifest?.members) ||
        packageValue.productMaterialManifest.members.length < 1) {
      fail('CLEAN_ARCA_INVENTORY_INPUT',
        'Inventory materialization requires an active exact Shelf and Product Package.');
    }
    if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
      fail('CLEAN_ARCA_TARGET_ROOT_UNAVAILABLE',
        'Shelf Target root is unavailable.');
    }
    const identityFact = packageValue.resolvedIdentitySnapshot?.factValue || {};
    const title = identityFact.title || identityFact.displayTitle ||
      identityFact.canonicalTitle || packageValue.onDeckPackageId;
    const placement = shelf.placement?.value || {};
    const folderTemplate = placement.folderTemplate || '{title}';
    if (folderTemplate !== '{title}') {
      fail('CLEAN_ARCA_PLACEMENT_TEMPLATE_UNSUPPORTED',
        'Beta Movie Inventory supports only the frozen title folder template.');
    }
    const folder = safeSegment(title);
    const targetDirectory = path.resolve(targetRoot, folder);
    if (!contained(targetRoot, targetDirectory)) {
      fail('CLEAN_ARCA_TARGET_ESCAPE',
        'Final Inventory directory escaped the Shelf Target.');
    }
    const primary = packageValue.productMaterialManifest.members
      .find((member) => member.role === 'primary_payload');
    if (!primary) {
      fail('CLEAN_ARCA_PRIMARY_MISSING',
        'Product Material Manifest has no primary payload.');
    }
    const primaryBase = safeSegment(
      path.basename(sourcePath(primary), path.extname(sourcePath(primary))),
    );
    const plans = packageValue.productMaterialManifest.members.map((member) => {
      const source = sourcePath(member);
      const observed = observe(source, member);
      const name = safeSegment(targetName(member, primaryBase));
      const target = path.resolve(targetDirectory, name);
      if (!contained(targetRoot, target)) {
        fail('CLEAN_ARCA_TARGET_ESCAPE',
          'Final Inventory member escaped the Shelf Target.');
      }
      return Object.freeze({ member, source, target, name, ...observed });
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.member.materialKey),
        Buffer.from(right.member.materialKey)));
    if (new Set(plans.map((item) => item.target)).size !== plans.length) {
      fail('CLEAN_ARCA_TARGET_COLLISION',
        'Final Inventory Decision maps multiple members to one target.');
    }
    return Object.freeze({
      targetRoot,
      targetDirectory,
      plans: Object.freeze(plans),
    });
  }

  function prepare(request) {
    const built = buildPlan(request);
    const members = built.plans.map((plan) => {
      const basis = {
        schema: 'arca.final-inventory-member@1',
        sourceMaterialKey: plan.member.materialKey,
        role: plan.member.role,
        targetEndpointId: request.shelf.target.endpointId,
        targetLocation: plan.target,
        digestHex: plan.digestHex,
        sizeBytes: plan.sizeBytes,
      };
      return Object.freeze({
        objectId: canonicalDigest({
          schema: 'arca.final-inventory-member-id@1',
          onDeckRunId: request.onDeckRunId,
          sourceMaterialKey: plan.member.materialKey,
        }),
        revision: 1,
        schemaRef: 'helix://contracts/domain-types/FinalInventoryMember/v1',
        digest: canonicalDigest(basis),
        objectKind: 'final-inventory-member',
      });
    });
    const decisionBase = {
      schemaRef: 'helix://contracts/domain-types/FinalInventoryDecision/v1',
      schemaVersion: 1,
      objectId: canonicalDigest({
        schema: 'arca.final-inventory-decision-id@1',
        onDeckRunId: request.onDeckRunId,
      }),
      revision: 1,
      onDeckRunId: request.onDeckRunId,
      shelfId: request.shelf.shelfId,
      members,
      placementRevision: request.shelf.currentPlacementRevision,
    };
    const decisionDigest = canonicalDigest({
      schema: 'arca.final-inventory-decision@1',
      ...decisionBase,
      targetEndpointId: request.shelf.target.endpointId,
      targetLocation: built.targetDirectory,
      productManifestDigest:
        request.onDeckProductPackage.productMaterialManifest.manifestDigest,
      offloadContextDigest:
        request.onDeckProductPackage.offloadContextManifest.manifestDigest,
    });
    return Object.freeze({
      ...decisionBase,
      digest: decisionDigest,
      decisionDigest,
    });
  }

  function assess(request) {
    const built = buildPlan(request);
    const statistics = fs.statfsSync(built.targetRoot, { bigint: true });
    const available = statistics.bavail * statistics.bsize;
    const availableBytes = available > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(available);
    const requiredBytes = built.plans.reduce(
      (sum, item) => sum + item.sizeBytes,
      0,
    );
    const draftDigest = canonicalDigest({
      schema: 'arca.final-inventory-decision-draft@1',
      shelfId: request.shelf.shelfId,
      placementRevision: request.shelf.currentPlacementRevision,
      targetEndpointId: request.shelf.target.endpointId,
      targetLocation: built.targetDirectory,
      members: built.plans.map((item) => ({
        sourceMaterialKey: item.member.materialKey,
        role: item.member.role,
        targetLocation: item.target,
        digestHex: item.digestHex,
        sizeBytes: item.sizeBytes,
      })),
    });
    const basis = {
      schemaRef:
        'helix://contracts/types/InventoryFeasibilityEvidence/v1',
      schemaVersion: 1,
      evidenceId: canonicalDigest({
        schema: 'arca.inventory-feasibility-evidence-id@1',
        onDeckPackageId: request.onDeckProductPackage.onDeckPackageId,
        shelfId: request.shelf.shelfId,
        placementRevision: request.shelf.currentPlacementRevision,
        draftDigest,
      }),
      evidenceKind: 'inventory_feasibility',
      producerRef: 'arca.acceptance.inventory_feasibility.observe@1',
      basisDigest: canonicalDigest({
        schema: 'arca.inventory-feasibility-basis@1',
        packageDigest: request.onDeckProductPackage.packageDigest,
        shelfId: request.shelf.shelfId,
        standardRevision: request.shelf.currentStandardRevision,
        placementRevision: request.shelf.currentPlacementRevision,
        draftDigest,
      }),
      observedAtMs: Number.isSafeInteger(request.observedAtMs)
        ? request.observedAtMs
        : 0,
      shelfId: request.shelf.shelfId,
      placementRevision: request.shelf.currentPlacementRevision,
      targetEndpointId: request.shelf.target.endpointId,
      requiredBytes,
      availableBytes,
      finalInventoryDecisionDraftDigest: draftDigest,
    };
    return Object.freeze({
      ...basis,
      payloadDigest: canonicalDigest(basis),
      outcome: availableBytes >= requiredBytes ? 'passed' : 'failed',
      targetLocation: built.targetDirectory,
    });
  }

  function materialize(request) {
    const built = buildPlan(request);
    const decision = request?.finalInventoryDecision;
    const expected = prepare(request);
    if (!decision || canonicalJson(decision) !== canonicalJson(expected)) {
      fail('CLEAN_ARCA_FINAL_DECISION_DRIFT',
        'Inventory effect does not match the immutable Final Inventory Decision.');
    }
    const targetRoot = built.targetRoot;
    const targetDirectory = built.targetDirectory;
    const plans = built.plans;
    fs.mkdirSync(targetDirectory, { recursive: true });
    const shelf = request.shelf;
    const packageValue = request.onDeckProductPackage;
    const staged = [];
    for (const plan of plans) {
      const intent = {
        schema: 'arca.inventory-product-stage-intent@1',
        onDeckRunId: request.onDeckRunId,
        custodyId: request.custodyId,
        onDeckPackageId: packageValue.onDeckPackageId,
        packageDigest: packageValue.packageDigest,
        shelfId: shelf.shelfId,
        placementRevision: shelf.currentPlacementRevision,
        sourceMaterialKey: plan.member.materialKey,
        sourceDigest: plan.digestHex,
        sourceSizeBytes: plan.sizeBytes,
        targetEndpointId: shelf.target.endpointId,
        targetMountScopeId: shelf.target.mountScopeId,
        targetMountScopeRevision: shelf.target.mountScopeRevision,
        targetLocation: plan.target,
      };
      const intentDigest = canonicalDigest(intent);
      const idempotencyKey = canonicalDigest({
        schema: 'arca.inventory-product-stage-idempotency@1',
        onDeckRunId: request.onDeckRunId,
        sourceMaterialKey: plan.member.materialKey,
        targetLocation: plan.target,
      });
      const effectId = canonicalDigest({
        schema: 'foundation.effect-id@1',
        effectClass: 'material_commit',
        idempotencyKey,
      });
      const prior = execute('clean_arca_inventory_intend', (context) => {
        const repo = context.repository(foundation.repositoryId);
        const existing = repo.invoke('find_effect', {
          effect_class: 'material_commit',
          idempotency_key: idempotencyKey,
        });
        if (existing) {
          if (existing.effect_id !== effectId ||
              existing.intent_digest !== intentDigest) {
            fail('CLEAN_ARCA_EFFECT_CONFLICT',
              'Inventory Effect key belongs to another immutable intent.');
          }
          return existing;
        }
        repo.invoke('insert_effect', {
          effect_id: effectId,
          event_attempt_id: null,
          effect_class: 'material_commit',
          idempotency_key: idempotencyKey,
          intent_digest: intentDigest,
          state: 'intended',
          external_receipt_ref: null,
          output_digest: null,
          verified_at_ms: null,
          updated_at_ms: context.commitTimeMs,
        });
        return repo.invoke('find_effect', {
          effect_class: 'material_commit',
          idempotency_key: idempotencyKey,
        });
      });
      const targetExact = fs.existsSync(plan.target) &&
        fs.statSync(plan.target).isFile() &&
        fs.statSync(plan.target).size === plan.sizeBytes &&
        digestFile(plan.target) === plan.digestHex;
      if (prior.state === 'committed' && !targetExact) {
        fail('CLEAN_ARCA_COMMITTED_REALITY_DRIFT',
          'Committed Inventory Effect no longer matches physical reality.');
      }
      if (prior.state !== 'committed' && !targetExact) {
        fs.mkdirSync(path.dirname(plan.target), { recursive: true });
        if (fs.existsSync(plan.target)) {
          fail('CLEAN_ARCA_TARGET_OCCUPIED',
            'Final Inventory target contains conflicting bytes.');
        }
        const temporary = plan.target + '.tmp-' + effectId.slice(0, 16);
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
        fs.copyFileSync(plan.source, temporary, fs.constants.COPYFILE_EXCL);
        if (fs.statSync(temporary).size !== plan.sizeBytes ||
            digestFile(temporary) !== plan.digestHex) {
          fs.rmSync(temporary, { force: true });
          fail('CLEAN_ARCA_STAGE_COPY_VERIFY',
            'Staged Inventory bytes failed verification.');
        }
        fs.renameSync(temporary, plan.target);
        if (typeof options.afterPhysicalEffect === 'function') {
          options.afterPhysicalEffect(Object.freeze({
            effectId,
            onDeckRunId: request.onDeckRunId,
            source: plan.source,
            target: plan.target,
          }));
        }
      }
      const stat = fs.statSync(plan.target, { bigint: true });
      const identityBase = {
        schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1',
        schemaVersion: 1,
        mountScopeId: shelf.target.mountScopeId,
        inode: stat.ino.toString(),
        contentHashAlgorithm: 'sha256',
        contentHash: plan.digestHex,
      };
      const materialKey = canonicalDigest({
        schema: 'physical-material-identity@1',
        mountScopeId: identityBase.mountScopeId,
        inode: identityBase.inode,
        contentHashAlgorithm: identityBase.contentHashAlgorithm,
        contentHash: identityBase.contentHash,
      });
      const physicalIdentity = Object.freeze({
        ...identityBase,
        materialKey,
      });
      const output = {
        schema: 'arca.staged-inventory-member@1',
        sourceMaterialKey: plan.member.materialKey,
        materialKey,
        role: plan.member.role,
        physicalIdentity,
        endpointId: shelf.target.endpointId,
        location: plan.target,
        sizeBytes: plan.sizeBytes,
        digestHex: plan.digestHex,
        effectId,
      };
      const outputDigest = canonicalDigest(output);
      execute('clean_arca_inventory_commit_effect', (context) => {
        const repo = context.repository(foundation.repositoryId);
        const current = repo.invoke('find_effect', {
          effect_class: 'material_commit',
          idempotency_key: idempotencyKey,
        });
        if (!current || current.effect_id !== effectId ||
            current.intent_digest !== intentDigest) {
          fail('CLEAN_ARCA_EFFECT_MISSING',
            'Inventory Effect intent is absent.');
        }
        if (current.state === 'committed') {
          if (current.output_digest !== outputDigest ||
              current.external_receipt_ref !== plan.target) {
            fail('CLEAN_ARCA_EFFECT_REPLAY_CORRUPT',
              'Committed Inventory Effect cannot reconstruct its output.');
          }
          return;
        }
        if (repo.invoke('commit_effect', {
          state: 'committed',
          external_receipt_ref: plan.target,
          output_digest: outputDigest,
          verified_at_ms: context.commitTimeMs,
          updated_at_ms: context.commitTimeMs,
          effect_id: effectId,
          expected_state: 'intended',
          expected_intent_digest: intentDigest,
        }).changes !== 1) {
          fail('CLEAN_ARCA_EFFECT_CAS',
            'Inventory Effect commit lost its CAS fence.');
        }
      });
      staged.push(Object.freeze({
        ...output,
        outputDigest,
        replayed: prior.state === 'committed' || targetExact,
      }));
    }
    const stagedMembers = staged.map((item) => Object.freeze({
      objectId: canonicalDigest({
        schema: 'arca.staged-inventory-member-id@1',
        onDeckRunId: request.onDeckRunId,
        materialKey: item.materialKey,
      }),
      revision: 1,
      schemaRef: 'helix://contracts/types/StagedInventoryMember/v1',
      snapshotDigest: item.outputDigest,
      objectKind: 'staged-inventory-member',
    }));
    const membersDigest = canonicalDigest({
      schema: 'arca.staged-inventory-members@1',
      items: stagedMembers,
    });
    const manifestBase = {
      schemaRef: 'helix://contracts/types/StagedInventoryManifest/v1',
      schemaVersion: 1,
      manifestId: canonicalDigest({
        schema: 'arca.staged-inventory-manifest-id@1',
        onDeckRunId: request.onDeckRunId,
      }),
      manifestKind: 'staged_inventory',
      ownerDomain: 'arca',
      memberCount: stagedMembers.length,
      membersDigest,
      publishedAtMs: Number.isSafeInteger(request.observedAtMs)
        ? request.observedAtMs
        : 0,
      targetCommitSlotId: canonicalDigest({
        schema: 'arca.target-commit-slot-id@1',
        onDeckRunId: request.onDeckRunId,
        targetEndpointId: shelf.target.endpointId,
        targetLocation: targetDirectory,
      }),
      stagedMembers: Object.freeze(stagedMembers),
      sourceProductManifestDigest:
        packageValue.productMaterialManifest.manifestDigest,
    };
    return Object.freeze({
      manifest: Object.freeze({
        ...manifestBase,
        manifestDigest: canonicalDigest(manifestBase),
      }),
      members: Object.freeze(staged),
    });
  }

  return Object.freeze({ assess, prepare, materialize });
}

module.exports = Object.freeze({
  CleanArcaInventoryPortError,
  createCleanArcaInventoryPort,
});
