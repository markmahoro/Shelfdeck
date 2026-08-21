'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalDigest,
  canonicalJson,
} = require('./helix/contracts/canonical-json');
const {
  createRepositoryDefinition,
} = require('./helix/foundation/persistence/owner-repository');
const {
  fromProductMember,
} = require('./helix/domains/arca/model/material-episode-claims');
const { computeBoundedMaterialFingerprintSync } = require('./helix/integrations/bounded-material-fingerprint');
const {
  DEFAULT_SHELF_PLACEMENT_POLICY,
} = require('./helix/domains/arca/model/shelf-placement-policy-contracts');

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

function managedSourceLocations(request) {
  return new Set((request?.onDeckProductPackage?.offloadContextManifest?.members || [])
    .map((item) => path.resolve(String(item.location || '')))
    .filter(Boolean));
}

function isManagedSourceLocation(request, location) {
  return managedSourceLocations(request).has(path.resolve(location));
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

function displayIdentityEntry(identityFact, key) {
  const entries = identityFact?.displayIdentity?.entries;
  if (!Array.isArray(entries)) return null;
  const entry = entries.find((item) => item?.key === key);
  return typeof entry?.value === 'string' && entry.value.trim()
    ? entry.value.trim()
    : null;
}

function inventoryDisplayIdentity(packageValue) {
  const snapshot = packageValue?.resolvedIdentitySnapshot?.factValue || {};
  const identityFact = snapshot.resolvedProductIdentity || snapshot;
  let title = identityFact.title || identityFact.displayTitle ||
    identityFact.canonicalTitle || displayIdentityEntry(identityFact, 'title');
  let year = identityFact.year || identityFact.releaseYear ||
    identityFact.release_year || displayIdentityEntry(identityFact, 'year');
  if (typeof title !== 'string' || !title.trim()) {
    fail('CLEAN_ARCA_TARGET_IDENTITY_TITLE_REQUIRED',
      'Final Inventory requires a human-readable resolved title.');
  }
  title = title.trim();
  const suffix = title.match(/^(.*?)\s*\((\d{4})\)$/);
  if (suffix) {
    title = suffix[1].trim();
    if (year === null || year === undefined || year === '') year = suffix[2];
  }
  const numericYear = year === null || year === undefined || year === ''
    ? null
    : Number(year);
  const edition = displayIdentityEntry(identityFact, 'edition');
  return Object.freeze({
    title,
    year:Number.isSafeInteger(numericYear) && numericYear >= 1000 && numericYear <= 9999
      ? numericYear
      : null,
    edition: edition || null,
  });
}

function contained(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function renderTemplate(template, values) {
  return template.replace(/\{([^{}]+)\}/g, (_match, token) => values[token] ?? '');
}

function subtitleQualifiers(fileName) {
  const stem = path.basename(fileName, path.extname(fileName));
  const languageMatch = stem.match(/(?:^|[. _-])(zh(?:[-_](?:cn|tw|hk))?|chs|cht|zho|chi|en|eng|ja|jpn|ko|kor|fr|fra|fre|de|deu|ger|es|spa)(?=$|[. _-])/i);
  const languageAliases = Object.freeze({
    chs:'zh-CN', cht:'zh-TW', zho:'zh', chi:'zh', eng:'en', jpn:'ja', kor:'ko',
    fra:'fr', fre:'fr', deu:'de', ger:'de', spa:'es',
  });
  const rawLanguage = languageMatch?.[1]?.replace('_', '-');
  const normalizedLanguage = rawLanguage
    ? (languageAliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase().replace(/-(cn|tw|hk)$/i, (_all, region) => `-${region.toUpperCase()}`))
    : '';
  return Object.freeze({
    language:normalizedLanguage ? `.${normalizedLanguage}` : '',
    forced:/(?:^|[. _-])forced(?=$|[. _-])/i.test(stem) ? '.forced' : '',
    sdh:/(?:^|[. _-])(?:sdh|hi)(?=$|[. _-])/i.test(stem) ? '.sdh' : '',
  });
}

function finalMemberName(member, source, identity, placement) {
  const extension = path.extname(source).toLowerCase();
  const stem = safeSegment(identity.year === null
    ? identity.title
    : `${identity.title} (${identity.year})`);
  const common = Object.freeze({ stem, ext:extension });
  if (member.role === 'primary_payload') {
    return safeSegment(renderTemplate(placement.primaryTemplate, common));
  }
  if (member.role === 'metadata_sidecar') {
    return safeSegment(renderTemplate(placement.nfoTemplate, common));
  }
  if (member.role === 'subtitle') {
    const qualifiers = subtitleQualifiers(source);
    if (!qualifiers.language && !qualifiers.forced && !qualifiers.sdh) {
      return safeSegment(path.basename(source));
    }
    return safeSegment(renderTemplate(placement.subtitleTemplate, {
      ...common,
      ...qualifiers,
    }));
  }
  if (member.role === 'poster') {
    return safeSegment(renderTemplate(placement.posterTemplate, { ext:extension }));
  }
  if (member.role === 'fanart') {
    return safeSegment(renderTemplate(placement.fanartTemplate, { ext:extension }));
  }
  return safeSegment(path.basename(source));
}

function suffixName(name, materialKey) {
  const extension = path.extname(name);
  return `${path.basename(name, extension)}-${String(materialKey).slice(0, 8)}${extension}`;
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
  const statfsSync = options.statfsSync || fs.statfsSync;

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

  function observe(source, member) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      fail('CLEAN_ARCA_PRODUCT_SOURCE_MISSING',
        'Product Material source is unavailable.', {
          materialKey: member.materialKey,
        });
    }
    const bounded = computeBoundedMaterialFingerprintSync(source);
    const stat = bounded.stat;
    if (Number(stat.size) !== member.sizeBytes ||
        Number(stat.size) !== member.physicalIdentity.sizeBytes ||
        bounded.fingerprintAlgorithm !== member.physicalIdentity.fingerprintAlgorithm ||
        bounded.fingerprintVersion !== member.physicalIdentity.fingerprintVersion ||
        bounded.contentFingerprint !== member.physicalIdentity.contentFingerprint) {
      fail('CLEAN_ARCA_PRODUCT_SOURCE_DRIFT',
        'Product Material bytes drifted from the immutable Package.', {
          materialKey: member.materialKey,
        });
    }
    return Object.freeze({ sizeBytes:Number(stat.size), contentFingerprint:bounded.contentFingerprint,
      digestHex:canonicalDigest({ schema:'physical-material-bounded-fingerprint-evidence@1', sizeBytes:Number(stat.size),
        fingerprintAlgorithm:bounded.fingerprintAlgorithm, fingerprintVersion:bounded.fingerprintVersion,
        contentFingerprint:bounded.contentFingerprint }) });
  }

  function resolveTargetLocation(request) {
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
    const identity = inventoryDisplayIdentity(packageValue);
    const placement = { ...DEFAULT_SHELF_PLACEMENT_POLICY, ...(shelf.placement?.value || {}) };
    const renderedFolder = renderTemplate(placement.folderTemplate, {
      title:identity.title,
      year:identity.year === null ? '' : String(identity.year),
    }).replace(/\s+\(\s*\)$/, '');
    const folder = safeSegment(identity.edition
      ? renderedFolder + ' - ' + identity.edition
      : renderedFolder);
    const targetDirectory = path.resolve(targetRoot, folder);
    if (!contained(targetRoot, targetDirectory)) {
      fail('CLEAN_ARCA_TARGET_ESCAPE',
        'Final Inventory directory escaped the Shelf Target.');
    }
    return Object.freeze({ targetRoot, targetDirectory, identity, placement });
  }

  function buildPlan(request) {
    const { targetRoot, targetDirectory, identity, placement } = resolveTargetLocation(request);
    const shelf = request.shelf;
    const packageValue = request.onDeckProductPackage;
    const primary = packageValue.productMaterialManifest.members
      .find((member) => member.role === 'primary_payload');
    if (!primary) {
      fail('CLEAN_ARCA_PRIMARY_MISSING',
        'Product Material Manifest has no primary payload.');
    }
    const contentProfile =
      packageValue.productStructureSnapshot?.structureKind === 'season'
        ? 'series'
        : 'movie';
    const draftPlans = packageValue.productMaterialManifest.members.map((member) => {
      const source = sourcePath(member);
      const name = finalMemberName(member, source, identity, placement);
      return Object.freeze({ member, source, name });
    });
    const duplicateNames = new Set(draftPlans.map((item) => item.name)
      .filter((name, index, values) => values.indexOf(name) !== index));
    if (duplicateNames.size > 0 && placement.collisionPolicy === 'reject') {
      fail('CLEAN_ARCA_TARGET_COLLISION',
        'Final Inventory Decision maps multiple members to one target.', {
          names:[...duplicateNames].sort(),
        });
    }
    const plans = draftPlans.map(({ member, source, name: proposedName }) => {
      const name = duplicateNames.has(proposedName)
        ? suffixName(proposedName, member.materialKey)
        : proposedName;
      const target = path.resolve(targetDirectory, name);
      if (!contained(targetRoot, target)) {
        fail('CLEAN_ARCA_TARGET_ESCAPE',
          'Final Inventory member escaped the Shelf Target.');
      }
      const observed = request.replayCommitted &&
        (!fs.existsSync(source) || !fs.statSync(source).isFile())
        ? observe(target, member)
        : observe(source, member);
      const episodeClaims = fromProductMember(member, contentProfile);
      return Object.freeze({
        member,
        episodeClaims,
        source,
        target,
        name,
        ...observed,
      });
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
        finalName: plan.name,
        targetEndpointId: request.shelf.target.endpointId,
        targetLocation: plan.target,
        digestHex: plan.digestHex,
        sizeBytes: plan.sizeBytes,
        episodeClaims: plan.episodeClaims,
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
        sourceMaterialKey: plan.member.materialKey,
        role: plan.member.role,
        finalName: plan.name,
        targetEndpointId: request.shelf.target.endpointId,
        targetLocation: plan.target,
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
    const statistics = statfsSync(built.targetRoot, { bigint: true });
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
        finalName: item.name,
        targetLocation: item.target,
        digestHex: item.digestHex,
        sizeBytes: item.sizeBytes,
        episodeClaims: item.episodeClaims,
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
        episodeClaims: plan.episodeClaims,
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
      if (request.replayCommitted && prior.state !== 'committed') {
        fail('CLEAN_ARCA_REPLAY_EFFECT_MISSING',
          'Committed On-deck replay requires its exact committed Inventory Effect.');
      }
      const targetFingerprint = fs.existsSync(plan.target) && fs.statSync(plan.target).isFile()
        ? computeBoundedMaterialFingerprintSync(plan.target) : null;
      const targetExact = targetFingerprint && Number(targetFingerprint.stat.size) === plan.sizeBytes &&
        targetFingerprint.contentFingerprint === plan.contentFingerprint;
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
        const temporaryFingerprint = computeBoundedMaterialFingerprintSync(temporary);
        if (Number(temporaryFingerprint.stat.size) !== plan.sizeBytes ||
            temporaryFingerprint.contentFingerprint !== plan.contentFingerprint) {
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
      const finalFingerprint = computeBoundedMaterialFingerprintSync(plan.target);
      const stat = finalFingerprint.stat;
      const identityBase = {
        schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
        schemaVersion: 2,
        mountScopeId: shelf.target.mountScopeId,
        inode: stat.ino.toString(),
        sizeBytes: Number(stat.size),
        fingerprintAlgorithm: finalFingerprint.fingerprintAlgorithm,
        fingerprintVersion: finalFingerprint.fingerprintVersion,
        contentFingerprint: finalFingerprint.contentFingerprint,
      };
      const materialKey = canonicalDigest({
        schema: 'physical-material-identity@2',
        mountScopeId: identityBase.mountScopeId,
        inode: identityBase.inode,
        sizeBytes: identityBase.sizeBytes,
        fingerprintAlgorithm: identityBase.fingerprintAlgorithm,
        fingerprintVersion: identityBase.fingerprintVersion,
        contentFingerprint: identityBase.contentFingerprint,
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
        episodeClaims: plan.episodeClaims,
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
      sourceMaterialKey: item.sourceMaterialKey,
      materialKey: item.materialKey,
      role: item.role,
      endpointId: item.endpointId,
      location: item.location,
      bindingRevision: 1,
      digestHex: item.digestHex,
      sizeBytes: item.sizeBytes,
      episodeClaims: item.episodeClaims,
    })).sort((left, right) =>
      Buffer.compare(Buffer.from(left.sourceMaterialKey),
        Buffer.from(right.sourceMaterialKey)) ||
      Buffer.compare(Buffer.from(left.materialKey),
        Buffer.from(right.materialKey)));
    if (new Set(stagedMembers.map((item) => item.sourceMaterialKey)).size !==
        stagedMembers.length ||
        new Set(stagedMembers.map((item) => item.materialKey)).size !==
        stagedMembers.length) {
      fail('CLEAN_ARCA_STAGED_IDENTITY_DUPLICATE',
        'Staged Inventory source and target Material identities must be unique.');
    }
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

  function slotHandle(request) {
    const built = buildPlan(request);
    const decision = request?.finalInventoryDecision;
    const expected = prepare(request);
    if (!decision || canonicalJson(decision) !== canonicalJson(expected)) {
      fail('CLEAN_ARCA_FINAL_DECISION_DRIFT',
        'Target slot does not match the immutable Final Inventory Decision.');
    }
    const suffix = canonicalDigest({
      schema: 'arca.inventory-stage-slot@1',
      onDeckRunId: request.onDeckRunId,
      finalInventoryDecisionDigest: decision.decisionDigest,
    }).slice(0, 16);
    const slotDirectory = built.targetDirectory + '.shelfdeck-stage-' + suffix;
    if (!contained(built.targetRoot, slotDirectory) ||
        slotDirectory === built.targetDirectory) {
      fail('CLEAN_ARCA_TARGET_ESCAPE',
        'Target staging slot escaped the Shelf target.');
    }
    const base = {
      schemaRef: 'helix://contracts/types/TargetCommitSlotHandle/v1',
      schemaVersion: 1,
      slotId: canonicalDigest({
        schema: 'arca.target-commit-slot-id@1',
        onDeckRunId: request.onDeckRunId,
        targetEndpointId: request.shelf.target.endpointId,
        targetLocation: built.targetDirectory,
        finalInventoryDecisionDigest: decision.decisionDigest,
      }),
      onDeckRunId: request.onDeckRunId,
      targetEndpointId: request.shelf.target.endpointId,
      targetDirectory: built.targetDirectory,
      slotDirectory,
      finalInventoryDecisionDigest: decision.decisionDigest,
      transactionRevision: 1,
    };
    return Object.freeze({
      ...base,
      containmentDigest: canonicalDigest({
        schema: 'arca.target-slot-containment@1',
        targetRoot: built.targetRoot,
        targetDirectory: built.targetDirectory,
        slotDirectory,
      }),
    });
  }

  function prepareSlot(request) {
    const handle = slotHandle(request);
    if (fs.existsSync(handle.targetDirectory) &&
        !fs.statSync(handle.targetDirectory).isDirectory()) {
      fail('CLEAN_ARCA_TARGET_OCCUPIED',
        'Final Inventory target is not a directory.');
    }
    if (fs.existsSync(handle.slotDirectory) &&
        !fs.statSync(handle.slotDirectory).isDirectory()) {
      fail('CLEAN_ARCA_STAGE_SLOT_INVALID',
        'Target staging slot is not a directory.');
    }
    fs.mkdirSync(handle.slotDirectory, { recursive: true });
    return handle;
  }

  function stage(request) {
    const built = buildPlan(request);
    const handle = slotHandle(request);
    if (!request?.targetCommitSlotHandle ||
        canonicalJson(request.targetCommitSlotHandle) !== canonicalJson(handle)) {
      fail('CLEAN_ARCA_STAGE_SLOT_DRIFT',
        'Product staging received a stale Target Commit Slot.');
    }
    prepareSlot(request);
    const stagedMembers = [];
    for (const plan of built.plans) {
      const target = path.resolve(handle.slotDirectory, plan.name);
      if (!contained(handle.slotDirectory, target)) {
        fail('CLEAN_ARCA_TARGET_ESCAPE',
          'Staged Inventory member escaped the Target Commit Slot.');
      }
      const finalExisting = fs.existsSync(plan.target)
        ? computeBoundedMaterialFingerprintSync(plan.target)
        : null;
      const finalExact = finalExisting &&
        Number(finalExisting.stat.size) === plan.sizeBytes &&
        finalExisting.contentFingerprint === plan.contentFingerprint;
      if (finalExisting && !finalExact && !isManagedSourceLocation(request, plan.target)) {
        fail('CLEAN_ARCA_TARGET_OCCUPIED',
          'Final Inventory target contains conflicting bytes.');
      }
      const existing = fs.existsSync(target)
        ? computeBoundedMaterialFingerprintSync(target)
        : null;
      const exact = existing && Number(existing.stat.size) === plan.sizeBytes &&
        existing.contentFingerprint === plan.contentFingerprint;
      if (existing && !exact) {
        fail('CLEAN_ARCA_STAGE_CONFLICT',
          'Target Commit Slot contains conflicting staged bytes.');
      }
      if (!finalExact && !exact) {
        const temporary = target + '.tmp-' +
          canonicalDigest({ run:request.onDeckRunId, key:plan.member.materialKey })
            .slice(0, 16);
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force:true });
        fs.copyFileSync(plan.source, temporary, fs.constants.COPYFILE_EXCL);
        const observed = computeBoundedMaterialFingerprintSync(temporary);
        if (Number(observed.stat.size) !== plan.sizeBytes ||
            observed.contentFingerprint !== plan.contentFingerprint) {
          fs.rmSync(temporary, { force:true });
          fail('CLEAN_ARCA_STAGE_COPY_VERIFY',
            'Staged Inventory bytes failed verification.');
        }
        fs.renameSync(temporary, target);
      }
      const observed = finalExact
        ? finalExisting : computeBoundedMaterialFingerprintSync(target);
      const identityBase = {
        schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
        schemaVersion: 2,
        mountScopeId: request.shelf.target.mountScopeId,
        inode: observed.stat.ino.toString(),
        sizeBytes: Number(observed.stat.size),
        fingerprintAlgorithm: observed.fingerprintAlgorithm,
        fingerprintVersion: observed.fingerprintVersion,
        contentFingerprint: observed.contentFingerprint,
      };
      const materialKey = canonicalDigest({
        schema: 'physical-material-identity@2',
        mountScopeId: identityBase.mountScopeId,
        inode: identityBase.inode,
        sizeBytes: identityBase.sizeBytes,
        fingerprintAlgorithm: identityBase.fingerprintAlgorithm,
        fingerprintVersion: identityBase.fingerprintVersion,
        contentFingerprint: identityBase.contentFingerprint,
      });
      stagedMembers.push(Object.freeze({
        sourceMaterialKey: plan.member.materialKey,
        materialKey,
        physicalIdentity: Object.freeze({ ...identityBase, materialKey }),
        role: plan.member.role,
        endpointId: request.shelf.target.endpointId,
        location: plan.target,
        bindingRevision: 1,
        digestHex: plan.digestHex,
        sizeBytes: plan.sizeBytes,
        episodeClaims: plan.episodeClaims,
      }));
    }
    stagedMembers.sort((left, right) =>
      Buffer.compare(Buffer.from(left.sourceMaterialKey),
        Buffer.from(right.sourceMaterialKey)));
    const membersDigest = canonicalDigest({
      schema: 'arca.staged-inventory-members@1',
      items: stagedMembers,
    });
    const base = {
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
        ? request.observedAtMs : 0,
      targetCommitSlotId: handle.slotId,
      stagedMembers: Object.freeze(stagedMembers),
      sourceProductManifestDigest:
        request.onDeckProductPackage.productMaterialManifest.manifestDigest,
    };
    return Object.freeze({ ...base, manifestDigest:canonicalDigest(base) });
  }

  function verifyStaged(request) {
    const manifest = request?.stagedInventoryManifest;
    const handle = slotHandle(request);
    if (!manifest || manifest.targetCommitSlotId !== handle.slotId ||
        manifest.sourceProductManifestDigest !==
          request.onDeckProductPackage.productMaterialManifest.manifestDigest) {
      fail('CLEAN_ARCA_STAGED_MANIFEST_DRIFT',
        'Staged Inventory Manifest is stale.');
    }
    const observed = manifest.stagedMembers.map((member) => {
      const finalLocation = path.resolve(member.location);
      if (!contained(handle.targetDirectory, finalLocation)) {
        fail('CLEAN_ARCA_STAGE_SLOT_ESCAPE',
          'Staged member final binding escaped the frozen target.');
      }
      const stagedLocation = path.resolve(handle.slotDirectory,
        path.basename(finalLocation));
      const location = fs.existsSync(stagedLocation)
        ? stagedLocation : finalLocation;
      const fingerprint = computeBoundedMaterialFingerprintSync(location);
      if (Number(fingerprint.stat.size) !== member.sizeBytes ||
          fingerprint.contentFingerprint !==
            request.onDeckProductPackage.productMaterialManifest.members.find(
              (item) => item.materialKey === member.sourceMaterialKey,
            )?.physicalIdentity.contentFingerprint) {
        fail('CLEAN_ARCA_STAGED_REALITY_DRIFT',
          'Staged member bytes drifted before placement.');
      }
      return member;
    });
    const basisDigest = canonicalDigest({ manifest, observed });
    return Object.freeze({
      schemaRef: 'helix://contracts/types/StagedInventoryVerification/v1',
      schemaVersion: 1,
      verificationId: canonicalDigest({
        schema: 'arca.staged-verification-id@1',
        onDeckRunId: request.onDeckRunId,
        basisDigest,
      }),
      verificationKind: 'staged_inventory',
      basisDigest,
      result: 'passed',
      reasonCodes: Object.freeze([]),
      evidenceRefs: Object.freeze([manifest.manifestId]),
      verifiedAtMs: Number.isSafeInteger(request.observedAtMs)
        ? request.observedAtMs : 0,
      stagedInventoryManifestDigest: manifest.manifestDigest,
      finalInventoryDecisionDigest:
        request.finalInventoryDecision.decisionDigest,
    });
  }

  function switchPlacement(request) {
    const built = buildPlan(request);
    const handle = slotHandle(request);
    const verification = request?.stagedInventoryVerification;
    if (!verification || verification.result !== 'passed' ||
        verification.finalInventoryDecisionDigest !==
          request.finalInventoryDecision.decisionDigest) {
      fail('CLEAN_ARCA_PLACEMENT_UNVERIFIED',
        'Placement switch requires exact passed staging verification.');
    }
    if (fs.existsSync(handle.targetDirectory) &&
        !fs.statSync(handle.targetDirectory).isDirectory()) {
      fail('CLEAN_ARCA_TARGET_OCCUPIED',
        'Final Inventory target is not a directory.');
    }
    if (!fs.existsSync(handle.targetDirectory)) {
      fs.mkdirSync(handle.targetDirectory, { recursive:true });
    }
    for (const plan of built.plans) {
      const stagedLocation = path.resolve(handle.slotDirectory, plan.name);
      const final = fs.existsSync(plan.target)
        ? computeBoundedMaterialFingerprintSync(plan.target) : null;
      const finalExact = final && Number(final.stat.size) === plan.sizeBytes &&
        final.contentFingerprint === plan.contentFingerprint;
      if (final && !finalExact && !isManagedSourceLocation(request, plan.target)) {
        fail('CLEAN_ARCA_TARGET_OCCUPIED',
          'Final Inventory target contains conflicting bytes.');
      }
      if (finalExact) {
        if (fs.existsSync(stagedLocation)) fs.rmSync(stagedLocation, { force:true });
        continue;
      }
      if (final && !finalExact && isManagedSourceLocation(request, plan.target)) {
        fs.rmSync(plan.target, { force:false });
      }
      if (!fs.existsSync(stagedLocation)) {
        fail('CLEAN_ARCA_STAGE_SLOT_MISSING',
          'Verified staged member disappeared before placement.');
      }
      const staged = computeBoundedMaterialFingerprintSync(stagedLocation);
      if (Number(staged.stat.size) !== plan.sizeBytes ||
          staged.contentFingerprint !== plan.contentFingerprint) {
        fail('CLEAN_ARCA_STAGED_REALITY_DRIFT',
          'Verified staged member drifted before placement.');
      }
      fs.renameSync(stagedLocation, plan.target);
    }
    if (fs.existsSync(handle.slotDirectory)) {
      if (fs.readdirSync(handle.slotDirectory).length !== 0) {
        fail('CLEAN_ARCA_STAGE_CONFLICT',
          'Target Commit Slot contains an unplanned member.');
      }
      fs.rmdirSync(handle.slotDirectory);
    }
    const base = {
      schemaRef: 'helix://contracts/types/PlacementSwitchReceipt/v1',
      schemaVersion: 1,
      receiptId: canonicalDigest({
        schema: 'arca.placement-switch-receipt-id@1',
        onDeckRunId: request.onDeckRunId,
      }),
      receiptKind: 'placement_switched',
      ownerDomain: 'arca',
      scopeType: request.aftercareCaseId ? 'aftercare_case' : 'on_deck_run',
      scopeId: request.aftercareCaseId || request.onDeckRunId,
      scopeDigest: canonicalDigest({ handle, verification }),
      effectReceiptRef: null,
      committedAtMs: Number.isSafeInteger(request.observedAtMs)
        ? request.observedAtMs : 0,
      targetCommitSlotId: handle.slotId,
      finalBindingSetDigest: request.targetBindings.bindingSetDigest,
      replacedInputSetDigest: request.replacedInputSetDigest,
      transactionRevision: 1,
    };
    return Object.freeze(base);
  }

  function readFinal(request) {
    const built = buildPlan({ ...request, replayCommitted:true });
    if (!fs.existsSync(built.targetDirectory) ||
        !fs.statSync(built.targetDirectory).isDirectory()) {
      fail('CLEAN_ARCA_FINAL_REALITY_MISSING',
        'Final Inventory target is absent after placement.');
    }
    const members = built.plans.map((plan) => {
      const observed = computeBoundedMaterialFingerprintSync(plan.target);
      if (Number(observed.stat.size) !== plan.sizeBytes ||
          observed.contentFingerprint !== plan.contentFingerprint) {
        fail('CLEAN_ARCA_FINAL_REALITY_DRIFT',
          'Final Inventory member drifted after placement.');
      }
      const identityBase = {schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
        mountScopeId:request.shelf.target.mountScopeId,inode:observed.stat.ino.toString(),sizeBytes:Number(observed.stat.size),
        fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,
        contentFingerprint:observed.contentFingerprint};
      const materialKey=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:identityBase.mountScopeId,inode:identityBase.inode,
        sizeBytes:identityBase.sizeBytes,fingerprintAlgorithm:identityBase.fingerprintAlgorithm,fingerprintVersion:identityBase.fingerprintVersion,
        contentFingerprint:identityBase.contentFingerprint});
      return Object.freeze({
        sourceMaterialKey: plan.member.materialKey,
        materialKey,
        physicalIdentity:Object.freeze({...identityBase,materialKey}),
        role: plan.member.role,
        endpointId:request.shelf.target.endpointId,
        location: plan.target,
        bindingRevision:1,
        digestHex:plan.digestHex,
        sizeBytes: plan.sizeBytes,
        contentFingerprint: observed.contentFingerprint,
        episodeClaims:plan.episodeClaims,
      });
    });
    members.sort((left,right)=>Buffer.compare(Buffer.from(left.sourceMaterialKey),Buffer.from(right.sourceMaterialKey)));
    const stagedMembers=members.map((item)=>Object.freeze({sourceMaterialKey:item.sourceMaterialKey,materialKey:item.materialKey,
      physicalIdentity:item.physicalIdentity,role:item.role,
      endpointId:item.endpointId,location:item.location,bindingRevision:1,digestHex:item.digestHex,sizeBytes:item.sizeBytes,episodeClaims:item.episodeClaims}));
    const membersDigest=canonicalDigest({schema:'arca.staged-inventory-members@1',items:stagedMembers}),manifestBase={
      schemaRef:'helix://contracts/types/StagedInventoryManifest/v1',schemaVersion:1,
      manifestId:canonicalDigest({schema:'arca.staged-inventory-manifest-id@1',onDeckRunId:request.onDeckRunId}),manifestKind:'staged_inventory',
      ownerDomain:'arca',memberCount:stagedMembers.length,membersDigest,publishedAtMs:Number.isSafeInteger(request.observedAtMs)?request.observedAtMs:0,
      targetCommitSlotId:slotHandle(request).slotId,stagedMembers:Object.freeze(stagedMembers),sourceProductManifestDigest:request.onDeckProductPackage.productMaterialManifest.manifestDigest};
    const manifest=Object.freeze({...manifestBase,manifestDigest:canonicalDigest(manifestBase)});
    return Object.freeze({
      targetDirectory: built.targetDirectory,
      members: Object.freeze(members),
      manifest,
      realityDigest: canonicalDigest({
        schema: 'arca.final-inventory-reality@1',
        targetDirectory: built.targetDirectory,
        members,
      }),
    });
  }

  function settleInput(request) {
    const handle = request?.materialHandle;
    if (!handle || handle.schemaRef !==
        'helix://contracts/types/PhysicalMaterialReadHandle/v1' ||
        handle.ownerDomain !== 'arca' ||
        handle.ownerScope?.scopeType !== 'on_deck_custody') {
      fail('CLEAN_ARCA_SETTLEMENT_HANDLE_INVALID',
        'Input settlement requires the exact Arca custody read handle.');
    }
    const source = path.resolve(handle.location);
    const finalRequest = request?.finalInventoryRequest;
    if (!finalRequest || !request.finalMaterialKey || !request.finalTargetLocation ||
        !request.sourceToFinalMappingDigest ||
        !['replace_or_move', 'remove_after_place'].includes(request.settlementExpectation)) {
      fail('CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID',
        'Input settlement requires its frozen source-to-final mapping.');
    }
    const built = buildPlan({ ...finalRequest, replayCommitted:true });
    const finalPlan = built.plans.find((item) =>
      item.member.materialKey === request.finalMaterialKey);
    const finalTarget = path.resolve(request.finalTargetLocation);
    if (!finalPlan || path.resolve(finalPlan.target) !== finalTarget) {
      fail('CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT',
        'Settlement mapping drifted from the Final Inventory Decision.');
    }
    const finalObserved = observe(finalTarget, finalPlan.member);
    const sameLocation = source === finalTarget;
    const sourceDirectory = path.dirname(source);
    const managedLocations = [
      ...(finalRequest.onDeckProductPackage.offloadContextManifest?.members || [])
        .map((item) => path.resolve(item.location)),
      ...built.plans.map((item) => path.resolve(item.target)),
    ];
    const allowed = new Set(managedLocations);
    for (const location of managedLocations) {
      let ancestor = path.dirname(location);
      while (ancestor !== sourceDirectory && ancestor.startsWith(sourceDirectory + path.sep)) {
        allowed.add(ancestor);
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
    }
    if (!sameLocation && fs.existsSync(sourceDirectory)) {
      const unknown = fs.readdirSync(sourceDirectory, { withFileTypes:true })
        .map((item) => path.resolve(sourceDirectory, item.name))
        .filter((item) => {
          if (allowed.has(item)) return false;
          try {
            if (!fs.statSync(item).isDirectory()) return true;
          } catch {
            return true;
          }
          return [...allowed].some((location) =>
            location === item || location.startsWith(item + path.sep));
        });
      if (unknown.length > 0) {
        fail('CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER',
          'Old Material directory contains an unplanned member.', {
            sourceDirectory,
            unknownNames:unknown.map((item) => path.basename(item)).sort(),
          });
      }
    }
    let sourceAbsent = !fs.existsSync(source);
    if (!sourceAbsent) {
      const observed = computeBoundedMaterialFingerprintSync(source);
      if (Number(observed.stat.size) !== handle.expectedSizeBytes ||
          observed.contentFingerprint !== handle.identity.contentFingerprint) {
        fail('CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT',
          'Settlement source drifted from the approved Material identity.');
      }
      if (!sameLocation) {
        fs.rmSync(source, { force:false });
        sourceAbsent = !fs.existsSync(source);
        if (!sourceAbsent) {
          fail('CLEAN_ARCA_SETTLEMENT_DELETE_FAILED',
            'Approved settlement source still exists after deletion.');
        }
      }
    }
    let oldDirectoryDisposition = sameLocation
      ? 'retained_as_final'
      : 'not_present';
    if (!sameLocation && fs.existsSync(sourceDirectory)) {
      const children = fs.readdirSync(sourceDirectory, { withFileTypes:true })
        .map((item) => path.resolve(sourceDirectory, item.name));
      if (children.length === 0 && sourceDirectory !== built.targetRoot) {
        fs.rmdirSync(sourceDirectory);
        oldDirectoryDisposition = 'removed_empty';
      } else {
        oldDirectoryDisposition = children.some((item) =>
          built.plans.some((plan) => path.resolve(plan.target) === item))
          ? 'retained_with_final_inventory'
          : 'awaiting_managed_settlement';
      }
    }
    return Object.freeze({ materialKey:handle.identity.materialKey,
      preDeleteIdentityDigest:canonicalDigest(handle.identity),
      absent:sourceAbsent,
      disposition:sameLocation ? 'retained_as_final' : 'settled_to_final',
      sourceToFinalMappingDigest:request.sourceToFinalMappingDigest,
      finalMaterialKey:request.finalMaterialKey,
      finalTargetLocation:finalTarget,
      finalRealityDigest:finalObserved.digestHex,
      finalVerified:true,
      oldDirectoryDisposition });
  }

  return Object.freeze({ assess, resolveTargetLocation, prepare, materialize, slotHandle, prepareSlot,
    stage, verifyStaged, switchPlacement, readFinal, settleInput });
}

module.exports = Object.freeze({
  CleanArcaInventoryPortError,
  createCleanArcaInventoryPort,
});
