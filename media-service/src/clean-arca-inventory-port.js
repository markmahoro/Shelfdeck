'use strict';
const {packageContentProfile}=require('./helix/domains/arca/model/product-content-profile');
const {chooseJavTitlePrefix}=require('./helix/domains/arca/model/jav-title-prefix');
const {splitGraphemes}=require('unicode-segmenter/grapheme');
const {relatedPrimaryName}=require('./helix/domains/arca/model/related-primary-name');
const {assertRequiredUsAdultActor}=require('./helix/contracts/us-adult-actor-package');
const {assertUsAdultInventoryPresentation}=require('./helix/contracts/us-adult-inventory-presentation');
const {originalNameProvenance,buildUsAdultTitle,buildUsAdultName}=require('./helix/contracts/us-adult-presentation');

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const {offloadProductKeys}=require('./helix/contracts/offload-product-targets');
const {seriesPlacementContext,seriesMemberStem}=require('./helix/domains/arca/model/series-placement');
const path = require('node:path');
const { observeEmptyStageSlot } = require('./helix/integrations/empty-stage-slot-observer');
const { observeNfoReferenceSemantics, preservesNfoReferenceSemantics } = require('./helix/contracts/nfo-reference-semantics');
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
const {
  computeBoundedMaterialFingerprint,
  computeBoundedMaterialFingerprintSync,
  readBoundedFileSnapshot,
  readBoundedFileSnapshotSync,
} = require('./helix/integrations/bounded-material-fingerprint');
const {
  MAX_NFO_BYTES,
  readableNfo,
} = require('./helix/domains/arca/model/aftercare-nfo');
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

function requireContinuation(request) {
  if (typeof request?.shouldContinue === 'function' && request.shouldContinue() === false) {
    fail('CLEAN_ARCA_EFFECT_FENCED', 'Inventory effect lost its current modification authority.');
  }
}

function pathExistsOrThrow(location) {
  try {
    fs.lstatSync(location);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function managedSourceLocations(request) {
  return new Set((request?.onDeckProductPackage?.offloadContextManifest?.members || [])
    .map((item) => path.resolve(String(item.location || '')))
    .filter(Boolean));
}

function isManagedSourceLocation(request, location) {
  return managedSourceLocations(request).has(path.resolve(location));
}

function isLibraryPresentationRole(role) {
  return role === 'metadata_sidecar' || role === 'poster' || role === 'fanart'
    || role === 'sidecar' || role === 'subtitle';
}

// Media members keep anti-miscover Attention on same-path foreign bytes.
// Library presentation (nfo/poster/fanart/subtitle/sidecar) may overwrite the
// planned path; differently named foreign files never enter this check.
function blocksForeignTargetOverwrite(role) {
  return !isLibraryPresentationRole(role);
}

function hiddenStageSlotDirectory(targetDirectory, suffix) {
  return path.join(path.dirname(targetDirectory), '.shelfdeck-stage-' + suffix);
}

function legacyStageSlotDirectory(targetDirectory, suffix) {
  return targetDirectory + '.shelfdeck-stage-' + suffix;
}

function resolveStageSlotDirectory(targetDirectory, suffix) {
  const hidden = hiddenStageSlotDirectory(targetDirectory, suffix);
  const legacy = legacyStageSlotDirectory(targetDirectory, suffix);
  // Prefer the in-flight legacy sibling so a 26 GiB copy is not abandoned
  // after the hidden-slot naming change. New Runs create the hidden form.
  if (fs.existsSync(legacy)) return legacy;
  return hidden;
}

function fingerprintsMatchPlan(observed, plan) {
  return Number(observed.stat.size) === plan.sizeBytes &&
    observed.contentFingerprint === plan.contentFingerprint;
}

function isMovieNfoPlan(plan) {
  return plan.member.role === 'metadata_sidecar' &&
    path.extname(plan.target).toLowerCase() === '.nfo';
}

function priorPlacementCoversTarget(request, plan, handle) {
  const receipt = request?.priorPlacementReceipt;
  return isMovieNfoPlan(plan) &&
    receipt?.schemaRef === 'helix://contracts/types/PlacementSwitchReceipt/v1' &&
    receipt.schemaVersion === 1 &&
    receipt.receiptKind === 'placement_switched' &&
    receipt.ownerDomain === 'arca' &&
    receipt.scopeType === 'on_deck_run' &&
    receipt.scopeId === request.onDeckRunId &&
    receipt.targetCommitSlotId === handle.slotId &&
    receipt.transactionRevision === 1;
}

function packageObservation(member) {
  return Object.freeze({
    sizeBytes:Number(member.sizeBytes),
    contentFingerprint:member.physicalIdentity.contentFingerprint,
    digestHex:canonicalDigest({
      schema:'physical-material-bounded-fingerprint-evidence@1',
      sizeBytes:Number(member.sizeBytes),
      fingerprintAlgorithm:member.physicalIdentity.fingerprintAlgorithm,
      fingerprintVersion:member.physicalIdentity.fingerprintVersion,
      contentFingerprint:member.physicalIdentity.contentFingerprint,
    }),
  });
}


function mutableSettlementBasis(request, finalPlan) {
  if (!isMovieNfoPlan(finalPlan) || path.extname(request.materialHandle.location).toLowerCase() !== '.nfo') return null;
  const source = request.finalInventoryRequest.onDeckProductPackage.offloadContextManifest?.members?.find((item) =>
    item.contextRole === 'related_input' && item.sourceRelatedReferenceId &&
    item.materialKey === request.materialHandle.identity.materialKey &&
    path.resolve(item.location) === path.resolve(request.materialHandle.location) &&
    item.finalProductMaterialKey === request.finalMaterialKey &&
    canonicalDigest(item.physicalIdentity) === canonicalDigest(request.materialHandle.identity));
  const observations = request.finalInventoryRequest.onDeckProductPackage.productionProvenance?.sourceNfoObservations || [];
  const matches = observations.filter((item) => source && item.sourceRef === source.sourceRelatedReferenceId);
  const observation = matches.length === 1 ? matches[0] : null;
  if (!observation || observation.sourceKind !== 'related_nfo' ||
      observation.sourceRef !== source.sourceRelatedReferenceId) return null;
  const { payloadDigest, ...body } = observation;
  if (canonicalDigest(body) !== payloadDigest) return null;
  return observation.sourceNfoSemantics;
}
function verifySettlementSource(request, observed, basis) {
  const handle = request.materialHandle;
  if (Number(observed.stat.size) === handle.expectedSizeBytes &&
      observed.contentFingerprint === handle.identity.contentFingerprint) return;
  const current = observed.bytes && observeNfoReferenceSemantics(observed.bytes);
  const accepted = request.finalInventoryRequest.nfoPresentationBasis?.identity;
  const currentId = current?.entries.find((item) => item.key === 'tmdb')?.value;
  if (!preservesNfoReferenceSemantics(basis, current) ||
      currentId && accepted?.provider === 'tmdb' && currentId !== accepted.providerKey) {
    fail('CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT',
      'Settlement source no longer preserves its approved reference facts.');
  }
}
function currentSettlementIdentityDigest(handle, observed) {
  const body = {mountScopeId:handle.identity.mountScopeId,inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,
    contentFingerprint:observed.contentFingerprint};
  const materialKey = canonicalDigest({schema:'physical-material-identity@2',mountScopeId:body.mountScopeId,
    inode:body.inode,sizeBytes:body.sizeBytes,fingerprintAlgorithm:body.fingerprintAlgorithm,fingerprintVersion:body.fingerprintVersion,
    contentFingerprint:body.contentFingerprint});
  return canonicalDigest({...handle.identity,...body,materialKey});
}
function assertSettlementSnapshot(observed, current) {
  if (String(observed.stat.ino) !== String(current.stat.ino) ||
      observed.stat.mtimeNs !== current.stat.mtimeNs || observed.stat.ctimeNs !== current.stat.ctimeNs ||
      observationDigest(observed) !== observationDigest(current))
    fail('CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT', 'Settlement source changed after semantic authorization.');
}

function observationDigest(observed) {
  return canonicalDigest({schema:'physical-material-bounded-fingerprint-evidence@1',
    sizeBytes:Number(observed.stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,
    fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint});
}

const JAV_DIRECTORY_BUDGET = 255 - Buffer.byteLength('.shelfdeck-stage-' + '0'.repeat(16));
const JAV_MEMBER_BUDGET = 255 - Buffer.byteLength('.restore-' + '0'.repeat(16));

function newJavOnDeck(request) {
  const packageValue = request?.onDeckProductPackage;
  const fact = packageValue?.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity ||
    packageValue?.resolvedIdentitySnapshot?.factValue;
  return !request?.aftercareCaseId && !request?.correctionId &&
    fact?.contentProfile === 'jav' && fact.identityKind === 'jav_code' &&
    fact.structureKind === 'single' && packageValue.productStructureSnapshot?.structureKind === 'single';
}

function safeSegment(value, preserveLength = false) {
  const segment = String(value || '').trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (!segment || segment === '.' || segment === '..') {
    fail('CLEAN_ARCA_TARGET_SEGMENT_INVALID',
      'Final Inventory path contains an invalid segment.');
  }
  if (preserveLength && Array.from(segment).some((character) => {
    const point = character.codePointAt(0);
    return point >= 0xd800 && point <= 0xdfff;
  })) {
    fail('CLEAN_ARCA_TARGET_SEGMENT_INVALID', 'Final Inventory path contains invalid Unicode.');
  }
  return preserveLength ? segment : segment.slice(0, 180);
}

function displayIdentityEntry(identityFact, key) {
  const entries = identityFact?.displayIdentity?.entries;
  if (!Array.isArray(entries)) return null;
  const entry = entries.find((item) => item?.key === key);
  return typeof entry?.value === 'string' && entry.value.trim()
    ? entry.value.trim()
    : null;
}
function exactUsAdultSegment(value){
  if(typeof value!=='string'||!value||value!==value.trim()||/[<>:"/\\|?*\u0000-\u001f]/.test(value)||/[. ]$/.test(value)||
    ['.','..'].includes(value)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)||Buffer.byteLength(value,'utf8')>255)
    fail('US_ADULT_NAME_UNSUPPORTED','US Adult names must fit the target filesystem without rewriting or truncation.');
  return value;
}

function inventoryDisplayIdentity(packageValue,request) {
  const snapshot = packageValue?.resolvedIdentitySnapshot?.factValue || {};
  const identityFact = snapshot.resolvedProductIdentity || snapshot;
  if(identityFact.contentProfile==='western_adult'){
    const originalName=originalNameProvenance(displayIdentityEntry(identityFact,'original_file_name'));
    if(displayIdentityEntry(identityFact,'original_file_name_digest')!==originalName.provenanceDigest)
      fail('US_ADULT_ORIGINAL_NAME_PROOF_INVALID','US Adult placement requires its first frozen original name.');
    let actorName;
    if(request?.inventoryActorRefreshSelection!==undefined) {
      if(!request.aftercareCaseId||request.correctionId||request.inventoryUsAdultPresentation!==undefined)
        fail('CLEAN_ARCA_INVENTORY_INPUT','Actor target naming requires one precise Aftercare selection.');
      const selection=require('./helix/contracts/us-adult-actor-selection').assertSelection(request.inventoryActorRefreshSelection,
        {shelfEntryId:request.shelfEntryId,aftercareCaseId:request.aftercareCaseId});
      if(canonicalDigest(selection.originalName)!==canonicalDigest(originalName))fail('US_ADULT_ORIGINAL_NAME_PROOF_INVALID','Actor target changed the first original name.');
      actorName=selection.personSnapshot.canonicalName;
    } else if(request?.inventoryUsAdultPresentation!==undefined) {
      if(!request.aftercareCaseId||request.correctionId)fail('CLEAN_ARCA_INVENTORY_INPUT','Inventory actor naming requires an Arca Aftercare Case.');
      actorName=assertUsAdultInventoryPresentation(request.inventoryUsAdultPresentation,
        {shelfEntryId:request.shelfEntryId,aftercareCaseId:request.aftercareCaseId,originalName}).actorName;
    } else {
      assertRequiredUsAdultActor(packageValue);
      actorName=packageValue.mediaCastSnapshot.relations[0].displayName;
    }
    const named=buildUsAdultTitle({actorName,originalName});
    return Object.freeze({title:named.title,year:null,edition:null,usAdultNaming:Object.freeze({actorName,originalName})});
  }
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
  const localizedChineseMatch = stem.match(/(?:^|[. _-])chinese\((简|简体|繁|繁体)\)(?=$|[. _-])/i);
  const languageAliases = Object.freeze({
    chs:'zh-CN', cht:'zh-TW', zho:'zh', chi:'zh', eng:'en', jpn:'ja', kor:'ko',
    fra:'fr', fre:'fr', deu:'de', ger:'de', spa:'es',
  });
  const rawLanguage = languageMatch?.[1]?.replace('_', '-') ||
    (localizedChineseMatch ? (localizedChineseMatch[1].startsWith('简') ? 'zh-CN' : 'zh-TW') : '');
  const normalizedLanguage = rawLanguage
    ? (languageAliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase().replace(/-(cn|tw|hk)$/i, (_all, region) => `-${region.toUpperCase()}`))
    : '';
  return Object.freeze({
    language:normalizedLanguage ? `.${normalizedLanguage}` : '',
    forced:/(?:^|[. _-])forced(?=$|[. _-])/i.test(stem) ? '.forced' : '',
    sdh:/(?:^|[. _-])(?:sdh|hi)(?=$|[. _-])/i.test(stem) ? '.sdh' : '',
  });
}

function finalMemberName(member, source, identity, placement, series = null) {
  const segment=identity.usAdultNaming?exactUsAdultSegment:
    identity.javTitleBudget ? value=>safeSegment(value,true) : safeSegment;
  if(series&&member.role==='sidecar'){
    const relatedName=relatedPrimaryName(series.packageValue,member,primary=>
      finalMemberName(primary,primary.location?.location||primary.workspaceMaterialHandle?.relativePath||'video.mkv',identity,placement,series));
    if(relatedName)return safeSegment(relatedName);
  }
  const extension = path.extname(source).toLowerCase();
  const baseStem = segment(identity.year === null
    ? identity.title
    : `${identity.title} (${identity.year})`);
  const stem=series ? safeSegment(seriesMemberStem(series,member,baseStem)) : baseStem;
  const common = Object.freeze({ stem, ext:extension });
  if (member.role === 'primary_payload') {
    if(identity.usAdultNaming)return buildUsAdultName({...identity.usAdultNaming,outputExtension:extension}).fileName;
    return segment(renderTemplate(placement.primaryTemplate, common));
  }
  if (member.role === 'metadata_sidecar') {
    return segment(renderTemplate(placement.nfoTemplate, common));
  }
  if (member.role === 'subtitle') {
    const qualifiers = subtitleQualifiers(source);
    if (!qualifiers.language && !qualifiers.forced && !qualifiers.sdh) {
      return segment(path.basename(source));
    }
    return segment(renderTemplate(placement.subtitleTemplate, {
      ...common,
      ...qualifiers,
    }));
  }
  if (member.role === 'poster') {
    return segment(renderTemplate(placement.posterTemplate, { ext:extension }));
  }
  if (member.role === 'fanart') {
    return segment(renderTemplate(placement.fanartTemplate, { ext:extension }));
  }
  return segment(path.basename(source));
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

async function cooperativeCopyFile(source, target, flags = 0) {
  if (flags !== 0 && flags !== fs.constants.COPYFILE_EXCL) {
    throw new TypeError('Cooperative Inventory copy supports only the exclusive-create flag.');
  }
  // Keep the service turn cooperative, then delegate the complete copy to the
  // platform's native asynchronous primitive. A JavaScript read/write loop
  // produces one libuv completion per chunk and can starve HTTP callbacks when
  // Stage competes with FFmpeg on the same volume.
  await new Promise((resolve) => setImmediate(resolve));
  await fs.promises.copyFile(source, target, flags);
}

async function copyPinnedExclusive(source, target) {
  const fd = fs.openSync(target, 'wx', 0o600);
  try {
    await pipeline(fs.createReadStream(source, { highWaterMark:1024*1024 }),
      fs.createWriteStream(target, { fd, autoClose:false, highWaterMark:1024*1024 }));
    fs.fsyncSync(fd);
    return fd;
  } catch (error) {
    try { fs.closeSync(fd); } catch {}
    throw error;
  }
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
  const copyFile = options.copyFile || cooperativeCopyFile;
  const computeFingerprint = options.computeFingerprint ||
    computeBoundedMaterialFingerprint;
  const shortStageLeases = new Map();

  function releaseShortStage(slotId) {
    const lease = shortStageLeases.get(slotId);
    if (!lease) return;
    shortStageLeases.delete(slotId);
    clearTimeout(lease.timer);
    for (const fd of lease.descriptors.values()) { try { fs.closeSync(fd); } catch {} }
  }

  function requireShortStage(slotId, sourceMaterialKey, observed) {
    const fd = shortStageLeases.get(slotId)?.descriptors.get(sourceMaterialKey);
    if (fd === undefined) fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN',
      'The original in-process Stage descriptor is unavailable; files were retained.');
    const held = fs.fstatSync(fd, { bigint:true });
    if (!held.isFile() || held.dev !== observed.stat.dev || held.ino !== observed.stat.ino ||
        held.size !== observed.stat.size || held.mtimeNs !== observed.stat.mtimeNs || held.ctimeNs !== observed.stat.ctimeNs) {
      fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'The live staged member changed; its files were retained.');
    }
    return held;
  }

  function requireShortSlotDirectory(handle) {
    let observed;
    try { observed=fs.lstatSync(handle.slotDirectory); }
    catch(error) {
      if(error?.code==='ENOENT') fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'The shortened staging slot disappeared.');
      throw error;
    }
    if (!observed.isDirectory() || observed.isSymbolicLink())
      fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'The shortened staging slot is not a direct directory.');
  }

  async function restorePresentationMember(request, plan, stagedLocation) {
    if (!isLibraryPresentationRole(plan.member.role) ||
        !fs.existsSync(stagedLocation) || !fs.existsSync(plan.source)) {
      return false;
    }
    const staged = await computeFingerprint(stagedLocation);
    if (fingerprintsMatchPlan(staged, plan)) return false;
    const source = await computeFingerprint(plan.source);
    if (!fingerprintsMatchPlan(source, plan)) return false;
    const temporary = stagedLocation + '.restore-' +
      canonicalDigest({ run:request.onDeckRunId, key:plan.member.materialKey })
        .slice(0, 16);
    await fs.promises.rm(temporary, { force:true });
    try {
      await copyFile(plan.source, temporary, fs.constants.COPYFILE_EXCL);
      const observed = await computeFingerprint(temporary);
      if (!fingerprintsMatchPlan(observed, plan)) {
        fail('CLEAN_ARCA_STAGE_COPY_VERIFY',
          'Staged Inventory bytes failed verification.');
      }
      await fs.promises.rm(stagedLocation, { force:true });
      await fs.promises.rename(temporary, stagedLocation);
    } catch (error) {
      await fs.promises.rm(temporary, { force:true }).catch(() => undefined);
      throw error;
    }
    return true;
  }

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

  async function observeAsync(source, member) {
    let bounded;
    try {
      bounded = await computeFingerprint(source);
    } catch (error) {
      if (error?.details?.causeCode === 'ENOENT') {
        fail('CLEAN_ARCA_PRODUCT_SOURCE_MISSING',
          'Product Material source is unavailable.', {
            materialKey: member.materialKey,
          });
      }
      throw error;
    }
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

  function resolveTargetLocationWithIdentity(request, policyOnly = false, identityOverride = null) {
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
    if(request.inventoryUsAdultPresentation!==undefined&&
        (packageValue.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||packageValue.resolvedIdentitySnapshot?.factValue)?.contentProfile!=='western_adult')
      fail('CLEAN_ARCA_INVENTORY_INPUT','Inventory actor naming cannot change a different content profile.');
    const identity = identityOverride || inventoryDisplayIdentity(packageValue,request);
    const placement = { ...DEFAULT_SHELF_PLACEMENT_POLICY, ...(shelf.placement?.value || {}) };
    if(identity.usAdultNaming)placement.collisionPolicy='reject';
    const renderedFolder = renderTemplate(placement.folderTemplate, {
      title:identity.title,
      year:identity.year === null ? '' : String(identity.year),
    }).replace(/\s+\(\s*\)$/, '');
    const segment = identity.usAdultNaming ? exactUsAdultSegment :
      identity.javTitleBudget ? value => safeSegment(value, true) : safeSegment;
    const folder = segment(identity.edition
      ? renderedFolder + ' - ' + identity.edition
      : renderedFolder);
    if(request.inventoryArtifactScopes!==undefined&&!request.aftercareCaseId)
      fail('CLEAN_ARCA_INVENTORY_INPUT','Registered Inventory Artifact scopes require an Aftercare Case.');
    const series=seriesPlacementContext(packageValue,request.inventoryArtifactScopes);
    const rootBinding=!policyOnly&&series&&options.readSeriesRootBinding?.({shelfId:shelf.shelfId,
      providerKey:(packageValue.resolvedIdentitySnapshot.factValue.resolvedProductIdentity||packageValue.resolvedIdentitySnapshot.factValue)
        .providerIdentities.find(item=>item.namespace==='tmdb_series').providerKey});
    if(rootBinding&&(rootBinding.endpointId!==shelf.target.endpointId||rootBinding.mountScopeId!==shelf.target.mountScopeId))
      fail('CLEAN_ARCA_SERIES_ROOT_BINDING_STALE','Shared Series root no longer matches this Shelf target.');
    const targetDirectory = series ? path.resolve(rootBinding?.rootLocation||path.join(targetRoot,folder),'Season '+String(series.seasonNumber).padStart(2,'0')) : path.resolve(targetRoot, folder);
    if (!contained(targetRoot, targetDirectory)) {
      fail('CLEAN_ARCA_TARGET_ESCAPE',
        'Final Inventory directory escaped the Shelf Target.');
    }
    return Object.freeze({ targetRoot, targetDirectory, identity, placement, series });
  }

  function resolveTargetLocation(request, policyOnly = false) {
    if (!newJavOnDeck(request)) return resolveTargetLocationWithIdentity(request, policyOnly);
    const packageValue = request.onDeckProductPackage;
    const original = inventoryDisplayIdentity(packageValue, request);
    const fact = packageValue.resolvedIdentitySnapshot.factValue.resolvedProductIdentity ||
      packageValue.resolvedIdentitySnapshot.factValue;
    let lastNameError = null;
    const render = (title, shortened) => {
      const identity = Object.freeze({ ...original, title, javTitleBudget:true });
      const resolved = resolveTargetLocationWithIdentity(request, policyOnly, identity);
      if (Buffer.byteLength(path.basename(resolved.targetDirectory), 'utf8') > JAV_DIRECTORY_BUDGET) return null;
      const members = packageValue.productMaterialManifest.members.map(member => {
        const source = sourcePath(member);
        return { member, source, name:finalMemberName(member, source, identity, resolved.placement, resolved.series) };
      });
      if (!members.some(item => item.member.role === 'primary_payload')) {
        fail('CLEAN_ARCA_PRIMARY_MISSING', 'Product Material Manifest has no primary payload.');
      }
      const counts = new Map();
      for (const item of members) counts.set(item.name, (counts.get(item.name) || 0) + 1);
      const names = members.map(item => counts.get(item.name) > 1 && item.member.role === 'subtitle'
        ? safeSegment(path.basename(item.source), true) : item.name);
      if (names.some(name => Buffer.byteLength(name, 'utf8') > JAV_MEMBER_BUDGET)) return null;
      if (shortened) {
        if (new Set(names).size !== names.length) {
          lastNameError = new CleanArcaInventoryPortError('CLEAN_ARCA_TARGET_COLLISION',
            'Shortened Inventory members must not share a final target.');
          return null;
        }
        const primaryStems = members.flatMap((item, index) => item.member.role === 'primary_payload'
          ? [path.basename(names[index], path.extname(names[index]))] : []);
        const nfoStems = members.flatMap((item, index) => item.member.role === 'metadata_sidecar'
          ? [path.extname(names[index]).toLowerCase() === '.nfo'
            ? path.basename(names[index], path.extname(names[index])) : null] : []);
        if (nfoStems.some(stem => stem === null || primaryStems.some(primary => primary !== stem))) {
          lastNameError = new CleanArcaInventoryPortError('CLEAN_ARCA_JAV_SHORT_STEM_MISMATCH',
            'Shortened primary and NFO names must share a stem.');
          return null;
        }
      }
      return resolved;
    };
    let choice;
    try {
      choice = chooseJavTitlePrefix({ title:original.title, providerIdentities:fact.providerIdentities, splitGraphemes,
        fits:title => Boolean(render(title, title !== original.title)) });
    } catch (error) {
      if (error?.code === 'CLEAN_ARCA_JAV_TITLE_UNFITTING' && lastNameError) throw lastNameError;
      throw error;
    }
    const result = render(choice.title, choice.shortened);
    return Object.freeze({ ...result, shortenedJavTitle:choice.shortened });
  }

  function buildPlan(request) {
    const { targetRoot, targetDirectory, identity, placement, series, shortenedJavTitle } = resolveTargetLocation(request);
    const shelf = request.shelf;
    const packageValue = request.onDeckProductPackage;
    const primary = packageValue.productMaterialManifest.members
      .find((member) => member.role === 'primary_payload');
    if (!primary) {
      fail('CLEAN_ARCA_PRIMARY_MISSING',
        'Product Material Manifest has no primary payload.');
    }
    const contentProfile = packageContentProfile(packageValue);
    const draftPlans = packageValue.productMaterialManifest.members.map((member) => {
      const source = sourcePath(member);
      const name = finalMemberName(member, source, identity, placement, series);
      return Object.freeze({ member, source, name });
    });
    const uniquified = draftPlans.map((item) => {
      const colliding = draftPlans.filter((other) => other.name === item.name).length > 1;
      if (!colliding || item.member.role !== 'subtitle') return item;
      return Object.freeze({ ...item, name: safeSegment(path.basename(item.source), Boolean(identity.javTitleBudget)) });
    });
    const duplicateNames = new Set(uniquified.map((item) => item.name)
      .filter((name, index, values) => values.indexOf(name) !== index));
    if (duplicateNames.size > 0 && (shortenedJavTitle || placement.collisionPolicy === 'reject')) {
      fail('CLEAN_ARCA_TARGET_COLLISION',
        'Final Inventory Decision maps multiple members to one target.', {
          names:[...duplicateNames].sort(),
        });
    }
    const plans = uniquified.map(({ member, source, name: proposedName }) => {
      const name = duplicateNames.has(proposedName)
        ? suffixName(proposedName, member.materialKey)
        : proposedName;
      const target = path.resolve(targetDirectory, name);
      if (!contained(targetRoot, target)) {
        fail('CLEAN_ARCA_TARGET_ESCAPE',
          'Final Inventory member escaped the Shelf Target.');
      }
      const observed = request.finalRealityRead
        ? packageObservation(member)
        : (request.replayCommitted || request.replaySettledSources) &&
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
      shortenedJavTitle:Boolean(shortenedJavTitle),
      plans: Object.freeze(plans),
    });
  }

  async function buildPlanAsync(request) {
    const { targetRoot, targetDirectory, identity, placement, series, shortenedJavTitle } = resolveTargetLocation(request);
    const packageValue = request.onDeckProductPackage;
    const primary = packageValue.productMaterialManifest.members
      .find((member) => member.role === 'primary_payload');
    if (!primary) {
      fail('CLEAN_ARCA_PRIMARY_MISSING',
        'Product Material Manifest has no primary payload.');
    }
    const contentProfile = packageContentProfile(packageValue);
    const draftPlans = packageValue.productMaterialManifest.members.map((member) => {
      const source = sourcePath(member);
      const name = finalMemberName(member, source, identity, placement, series);
      return Object.freeze({ member, source, name });
    });
    const uniquified = draftPlans.map((item) => {
      const colliding = draftPlans.filter((other) => other.name === item.name).length > 1;
      if (!colliding || item.member.role !== 'subtitle') return item;
      return Object.freeze({ ...item, name: safeSegment(path.basename(item.source), Boolean(identity.javTitleBudget)) });
    });
    const duplicateNames = new Set(uniquified.map((item) => item.name)
      .filter((name, index, values) => values.indexOf(name) !== index));
    if (duplicateNames.size > 0 && (shortenedJavTitle || placement.collisionPolicy === 'reject')) {
      fail('CLEAN_ARCA_TARGET_COLLISION',
        'Final Inventory Decision maps multiple members to one target.', {
          names:[...duplicateNames].sort(),
        });
    }
    const plans = [];
    for (const { member, source, name:proposedName } of uniquified) {
      const name = duplicateNames.has(proposedName)
        ? suffixName(proposedName, member.materialKey)
        : proposedName;
      const target = path.resolve(targetDirectory, name);
      if (!contained(targetRoot, target)) {
        fail('CLEAN_ARCA_TARGET_ESCAPE',
          'Final Inventory member escaped the Shelf Target.');
      }
      let observed;
      if (request.finalRealityRead) observed = packageObservation(member);
      else try {
        observed = await observeAsync(source, member);
      } catch (error) {
        if (!(request.replayCommitted || request.replaySettledSources) ||
            error?.code !== 'CLEAN_ARCA_PRODUCT_SOURCE_MISSING') throw error;
        observed = await observeAsync(target, member);
      }
      plans.push(Object.freeze({
        member,
        episodeClaims:fromProductMember(member, contentProfile),
        source,
        target,
        name,
        ...observed,
      }));
    }
    plans.sort((left, right) =>
      Buffer.compare(Buffer.from(left.member.materialKey),
        Buffer.from(right.member.materialKey)));
    if (new Set(plans.map((item) => item.target)).size !== plans.length) {
      fail('CLEAN_ARCA_TARGET_COLLISION',
        'Final Inventory Decision maps multiple members to one target.');
    }
    return Object.freeze({
      targetRoot,
      targetDirectory,
      shortenedJavTitle:Boolean(shortenedJavTitle),
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
          if (blocksForeignTargetOverwrite(plan.member.role)) {
            fail('CLEAN_ARCA_TARGET_OCCUPIED',
              'Final Inventory target contains conflicting bytes.');
          }
          fs.rmSync(plan.target, { force:false });
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
    const slotDirectory = resolveStageSlotDirectory(built.targetDirectory, suffix);
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
    const shortened=newJavOnDeck(request)&&resolveTargetLocation(request).shortenedJavTitle;
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
    if (shortened && pathExistsOrThrow(handle.slotDirectory)) requireShortSlotDirectory(handle);
    fs.mkdirSync(handle.slotDirectory, { recursive: true });
    if (shortened) requireShortSlotDirectory(handle);
    return handle;
  }

  async function stage(request) {
    const built = await buildPlanAsync(request);
    requireContinuation(request);
    const handle = slotHandle(request);
    if (!request?.targetCommitSlotHandle ||
        canonicalJson(request.targetCommitSlotHandle) !== canonicalJson(handle)) {
      fail('CLEAN_ARCA_STAGE_SLOT_DRIFT',
        'Product staging received a stale Target Commit Slot.');
    }
    if (built.shortenedJavTitle) {
      if (pathExistsOrThrow(handle.targetDirectory)) {
        fail('CLEAN_ARCA_JAV_SHORT_TARGET_OCCUPIED',
          'The shortened Final Inventory target already exists.', {
            sourceDirectory:handle.targetDirectory,
            conflicts:[{ target:handle.targetDirectory, name:path.basename(handle.targetDirectory) }], conflictCount:1,
          });
      }
      for (const plan of built.plans) {
        const staged = path.resolve(handle.slotDirectory, plan.name);
        const temporary = staged + '.tmp-' +
          canonicalDigest({ run:request.onDeckRunId, key:plan.member.materialKey }).slice(0, 16);
        if (pathExistsOrThrow(staged) || pathExistsOrThrow(temporary)) {
          fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN',
            'The shortened target has an unclassified staged member; its files were retained.');
        }
      }
    }
    // Resolve media target conflicts before creating or changing any staged material.
    // Presentation leftovers at the planned path are overwritten later; they must
    // not freeze the whole On-deck. Differently named foreign files are ignored.
    const conflicts = [];
    for (const plan of built.plans) {
      requireContinuation(request);
      if (!fs.existsSync(plan.target)) continue;
      const observed = await computeFingerprint(plan.target);
      if (!fingerprintsMatchPlan(observed, plan) &&
          !priorPlacementCoversTarget(request, plan, handle) &&
          !isManagedSourceLocation(request, plan.target) &&
          blocksForeignTargetOverwrite(plan.member.role)) {
        conflicts.push(Object.freeze({ target: plan.target, name: plan.name }));
      }
    }
    if (conflicts.length) {
      fail('CLEAN_ARCA_STAGE_TARGET_OCCUPIED',
        'Final Inventory media target contains conflicting bytes before staging.', {
          sourceDirectory:path.dirname(conflicts[0].target), unknownNames:[path.basename(conflicts[0].target)],
          conflicts:conflicts.slice(0, 16), conflictCount:conflicts.length,
        });
    }
    prepareSlot(request);
    const stagedMembers = [], pinned = built.shortenedJavTitle ? new Map() : null;
    try {
    for (const plan of built.plans) {
      requireContinuation(request);
      const target = path.resolve(handle.slotDirectory, plan.name);
      if (!contained(handle.slotDirectory, target)) {
        fail('CLEAN_ARCA_TARGET_ESCAPE',
          'Staged Inventory member escaped the Target Commit Slot.');
      }
      const finalExisting = fs.existsSync(plan.target)
        ? await computeFingerprint(plan.target)
        : null;
      if (built.shortenedJavTitle && finalExisting) {
        fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'A final member appeared during staging; its files were retained.');
      }
      const finalExact = finalExisting &&
        Number(finalExisting.stat.size) === plan.sizeBytes &&
        finalExisting.contentFingerprint === plan.contentFingerprint;
      const priorPlacementTarget = finalExisting && !finalExact &&
        priorPlacementCoversTarget(request, plan, handle);
      let finalSemantic = false;
      let finalObserved = finalExisting;
      if (priorPlacementTarget) {
        try {
          finalObserved = await readStableNfo(plan.target);
          verifyFinalObservation(request, plan, finalObserved);
          finalSemantic = true;
        } catch (error) {
          if (error?.code !== 'CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT') throw error;
        }
      }
      if (finalExisting && !finalExact && !priorPlacementTarget &&
          !isManagedSourceLocation(request, plan.target) &&
          blocksForeignTargetOverwrite(plan.member.role)) {
        fail('CLEAN_ARCA_TARGET_OCCUPIED',
          'Final Inventory media target contains conflicting bytes.');
      }
      const existing = fs.existsSync(target)
        ? await computeFingerprint(target)
        : null;
      if (built.shortenedJavTitle && existing) {
        fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'A staged member appeared during staging; its files were retained.');
      }
      let exact = existing && Number(existing.stat.size) === plan.sizeBytes &&
        existing.contentFingerprint === plan.contentFingerprint;
      if (existing && !exact) {
        const restored = await restorePresentationMember(request, plan, target);
        if (!restored) {
          fail('CLEAN_ARCA_STAGE_CONFLICT',
            'Target Commit Slot contains conflicting staged bytes.');
        }
        exact = true;
      }
      if (request.replayCommitted && !finalExact && !finalSemantic && !exact) {
        fail('CLEAN_ARCA_COMMITTED_REALITY_DRIFT',
          'Committed Inventory Effect no longer matches physical reality.');
      }
      if (!finalExact && !finalSemantic && !exact) {
        const temporary = target + '.tmp-' +
          canonicalDigest({ run:request.onDeckRunId, key:plan.member.materialKey })
            .slice(0, 16);
        if (!built.shortenedJavTitle) await fs.promises.rm(temporary, { force:true });
        try {
          if (pinned) pinned.set(plan.member.materialKey, await copyPinnedExclusive(plan.source, temporary));
          else await copyFile(plan.source, temporary, fs.constants.COPYFILE_EXCL);
          const observed = await computeFingerprint(temporary);
          if (Number(observed.stat.size) !== plan.sizeBytes ||
              observed.contentFingerprint !== plan.contentFingerprint) {
            fail('CLEAN_ARCA_STAGE_COPY_VERIFY',
              'Staged Inventory bytes failed verification.');
          }
          if (built.shortenedJavTitle) {
            const held = fs.fstatSync(pinned.get(plan.member.materialKey), { bigint:true });
            if (!held.isFile() || held.dev !== observed.stat.dev || held.ino !== observed.stat.ino ||
                held.size !== observed.stat.size || held.mtimeNs !== observed.stat.mtimeNs || held.ctimeNs !== observed.stat.ctimeNs)
              fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'The copied member no longer matches its live descriptor.');
            try { await fs.promises.link(temporary, target); }
            catch (error) {
              if (error?.code === 'EEXIST') fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN',
                'A staged member appeared during exclusive publication; its files were retained.');
              throw error;
            }
            const linked = fs.lstatSync(target, { bigint:true }), original = fs.lstatSync(temporary, { bigint:true });
            if (!linked.isFile() || !original.isFile() || linked.dev !== held.dev || linked.ino !== held.ino ||
                original.dev !== held.dev || original.ino !== held.ino)
              fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'The staged link no longer matches its live descriptor.');
            await fs.promises.unlink(temporary);
          } else await fs.promises.rename(temporary, target);
        } catch (error) {
          if (!built.shortenedJavTitle) await fs.promises.rm(temporary, { force:true }).catch(() => undefined);
          throw error;
        }
      }
      requireContinuation(request);
      const observed = finalExact
        ? finalExisting : finalSemantic
          ? finalObserved : await computeFingerprint(target);
      if (pinned) {
        const held = fs.fstatSync(pinned.get(plan.member.materialKey), { bigint:true });
        if (!held.isFile() || held.dev !== observed.stat.dev || held.ino !== observed.stat.ino ||
            held.size !== observed.stat.size || held.mtimeNs !== observed.stat.mtimeNs || held.ctimeNs !== observed.stat.ctimeNs)
          fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'The staged member changed before its Manifest was created.');
      }
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
        physicalIdentity: Object.freeze({ ...identityBase, materialKey }),
        role: plan.member.role,
        endpointId: request.shelf.target.endpointId,
        location: plan.target,
        bindingRevision: 1,
        episodeClaims: plan.episodeClaims,
      }));
    }
    stagedMembers.sort((left, right) =>
      Buffer.compare(Buffer.from(left.sourceMaterialKey),
        Buffer.from(right.sourceMaterialKey)) ||
      Buffer.compare(Buffer.from(left.physicalIdentity.materialKey),
        Buffer.from(right.physicalIdentity.materialKey)));
    requireContinuation(request);
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
    const manifest=Object.freeze({ ...base, manifestDigest:canonicalDigest(base) });
    if (pinned) {
      const timer=setTimeout(()=>releaseShortStage(handle.slotId), 60*60*1000);
      timer.unref();
      shortStageLeases.set(handle.slotId,{descriptors:pinned,timer});
    }
    return manifest;
    } catch (error) {
      if (pinned) for (const fd of pinned.values()) { try { fs.closeSync(fd); } catch {} }
      throw error;
    }
  }

  async function verifyStaged(request) {
    const manifest = request?.stagedInventoryManifest;
    requireContinuation(request);
    const handle = slotHandle(request);
    if (!manifest || manifest.targetCommitSlotId !== handle.slotId ||
        manifest.sourceProductManifestDigest !==
          request.onDeckProductPackage.productMaterialManifest.manifestDigest) {
      fail('CLEAN_ARCA_STAGED_MANIFEST_DRIFT',
        'Staged Inventory Manifest is stale.');
    }
    const built = await buildPlanAsync(request);
    if (built.shortenedJavTitle) requireShortSlotDirectory(handle);
    const planBySource = new Map(built.plans.map((item) =>
      [item.member.materialKey, item]));
    const observed = [];
    for (const member of manifest.stagedMembers) {
      requireContinuation(request);
      const finalLocation = path.resolve(member.location);
      if (!contained(handle.targetDirectory, finalLocation)) {
        fail('CLEAN_ARCA_STAGE_SLOT_ESCAPE',
          'Staged member final binding escaped the frozen target.');
      }
      const stagedLocation = path.resolve(handle.slotDirectory,
        path.basename(finalLocation));
      if (built.shortenedJavTitle && (!pathExistsOrThrow(stagedLocation) ||
          !fs.lstatSync(stagedLocation).isFile())) {
        fail('CLEAN_ARCA_SHORT_STAGE_UNCERTAIN', 'A shortened staged member is missing or unclassified.');
      }
      const location = fs.existsSync(stagedLocation)
        ? stagedLocation : finalLocation;
      const plan = planBySource.get(member.sourceMaterialKey);
      const stagedExists = fs.existsSync(stagedLocation);
      if (plan && stagedExists && !built.shortenedJavTitle) {
        await restorePresentationMember(request, plan, stagedLocation);
      }
      const packageMember = request.onDeckProductPackage.productMaterialManifest.members.find(
        (item) => item.materialKey === member.sourceMaterialKey,
      );
      const semanticPresentation = plan && isMovieNfoPlan(plan) &&
        request.nfoPresentationBasis;
      const semanticFinal = !stagedExists && semanticPresentation &&
        priorPlacementCoversTarget(request, plan, handle);
      const fingerprint = semanticPresentation
        ? await readStableNfo(location) : await computeFingerprint(location);
      if (built.shortenedJavTitle) requireShortStage(handle.slotId, member.sourceMaterialKey, fingerprint);
      const identityChanged = Number(fingerprint.stat.size) !==
        member.physicalIdentity.sizeBytes || fingerprint.contentFingerprint !==
        member.physicalIdentity.contentFingerprint ||
        (built.shortenedJavTitle && String(fingerprint.stat.ino) !== String(member.physicalIdentity.inode));
      const packageChanged = Number(fingerprint.stat.size) !== Number(packageMember?.sizeBytes) ||
        fingerprint.contentFingerprint !== packageMember?.physicalIdentity.contentFingerprint;
      if (identityChanged || (!semanticFinal && packageChanged)) {
        fail('CLEAN_ARCA_STAGED_REALITY_DRIFT',
          'Staged member bytes drifted before placement.');
      }
      if (semanticPresentation) verifyFinalObservation(request, plan, fingerprint);
      requireContinuation(request);
      observed.push(member);
    }
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

  function placementReceipt(request, handle, verification) {
    const base = {
      schemaRef: 'helix://contracts/types/PlacementSwitchReceipt/v1',
      schemaVersion: 1,
      receiptId: canonicalDigest({ schema:'arca.placement-switch-receipt-id@1', onDeckRunId:request.onDeckRunId }),
      receiptKind: 'placement_switched', ownerDomain: 'arca',
      scopeType: request.aftercareCaseId ? 'aftercare_case' : 'on_deck_run',
      scopeId: request.aftercareCaseId || request.onDeckRunId,
      scopeDigest: canonicalDigest({ handle, verification }), effectReceiptRef: null,
      committedAtMs: Number.isSafeInteger(request.observedAtMs) ? request.observedAtMs : 0,
      targetCommitSlotId: handle.slotId, finalBindingSetDigest: request.targetBindings.bindingSetDigest,
      replacedInputSetDigest: request.replacedInputSetDigest, transactionRevision: 1,
    };
    return Object.freeze(base);
  }

  async function switchShortenedJav(request, built, handle, verification) {
    requireShortSlotDirectory(handle);
    const manifest = request.stagedInventoryManifest;
    const { manifestDigest, ...manifestBody } = manifest || {};
    if (!manifest || manifest.manifestKind !== 'staged_inventory' || manifest.ownerDomain !== 'arca' ||
        manifestDigest !== canonicalDigest(manifestBody) ||
        manifestDigest !== verification.stagedInventoryManifestDigest ||
        manifest.targetCommitSlotId !== handle.slotId ||
        manifest.sourceProductManifestDigest !== request.onDeckProductPackage.productMaterialManifest.manifestDigest ||
        !Array.isArray(manifest.stagedMembers) || manifest.memberCount !== built.plans.length ||
        manifest.stagedMembers.length !== built.plans.length ||
        manifest.membersDigest !== canonicalDigest({schema:'arca.staged-inventory-members@1',items:manifest.stagedMembers})) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'The exact staged Manifest is required for a shortened target.');
    }
    const members = new Map(manifest.stagedMembers.map(member => [member.sourceMaterialKey, member]));
    if (members.size !== built.plans.length) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'The staged Manifest contains duplicate source members.');
    }
    const staged = [];
    for (const plan of built.plans) {
      requireContinuation(request);
      const member = members.get(plan.member.materialKey), location = path.resolve(handle.slotDirectory, plan.name);
      if (!member || member.role !== plan.member.role || member.location !== plan.target ||
          member.endpointId !== request.shelf.target.endpointId || !contained(handle.slotDirectory, location) ||
          !fs.lstatSync(location).isFile()) {
        fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'The staged member no longer matches its frozen target.');
      }
      const observed = await computeFingerprint(location), identity = member.physicalIdentity;
      requireShortStage(handle.slotId, plan.member.materialKey, observed);
      if (!identity || identity.mountScopeId !== request.shelf.target.mountScopeId ||
          String(observed.stat.ino) !== String(identity.inode) || Number(observed.stat.size) !== identity.sizeBytes ||
          observed.fingerprintAlgorithm !== identity.fingerprintAlgorithm || observed.fingerprintVersion !== identity.fingerprintVersion ||
          observed.contentFingerprint !== identity.contentFingerprint || !fingerprintsMatchPlan(observed, plan)) {
        fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'The staged member changed after verification.');
      }
      staged.push({ plan, location, observed });
    }
    requireContinuation(request);
    try { fs.mkdirSync(handle.targetDirectory); }
    catch (error) {
      if (error?.code === 'EEXIST') fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN',
        'The shortened target already exists and its publication is unclassified.');
      throw error;
    }
    for (const item of staged) {
      requireContinuation(request);
      requireShortSlotDirectory(handle);
      try { fs.linkSync(item.location, item.plan.target); }
      catch (error) {
        if (error?.code === 'EEXIST') fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN',
          'A final member appeared during exclusive publication; all files were retained.');
        throw error;
      }
      const final = await computeFingerprint(item.plan.target), current = fs.lstatSync(item.location, { bigint:true });
      requireShortStage(handle.slotId, item.plan.member.materialKey, final);
      if (!current.isFile() || current.dev !== final.stat.dev || current.ino !== final.stat.ino ||
          String(final.stat.ino) !== String(item.observed.stat.ino) || !fingerprintsMatchPlan(final, item.plan)) {
        fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Published and staged member identities no longer agree.');
      }
    }
    for (const item of staged) {
      requireContinuation(request);
      requireShortSlotDirectory(handle);
      const observed=await computeFingerprint(item.location);
      requireShortStage(handle.slotId, item.plan.member.materialKey, observed);
      const source = fs.lstatSync(item.location, { bigint:true }), target = fs.lstatSync(item.plan.target, { bigint:true });
      if (!source.isFile() || !target.isFile() || source.dev !== target.dev || source.ino !== target.ino ||
          String(source.ino) !== String(item.observed.stat.ino)) {
        fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'The staged alias changed before cleanup.');
      }
      fs.unlinkSync(item.location);
    }
    requireShortSlotDirectory(handle);
    if (fs.readdirSync(handle.slotDirectory).length !== 0) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'The staged slot contains an unclassified member.');
    }
    fs.rmdirSync(handle.slotDirectory);
    return placementReceipt(request, handle, verification);
  }

  async function switchPlacement(request) {
    const built = await buildPlanAsync(request);
    const handle = slotHandle(request);
    const verification = request?.stagedInventoryVerification;
    if (!verification || verification.result !== 'passed' ||
        verification.finalInventoryDecisionDigest !==
          request.finalInventoryDecision.decisionDigest) {
      fail('CLEAN_ARCA_PLACEMENT_UNVERIFIED',
        'Placement switch requires exact passed staging verification.');
    }
    requireContinuation(request);
    if (built.shortenedJavTitle) {
      try { return await switchShortenedJav(request, built, handle, verification); }
      finally { releaseShortStage(handle.slotId); }
    }
    if (fs.existsSync(handle.targetDirectory) &&
        !fs.statSync(handle.targetDirectory).isDirectory()) {
      fail('CLEAN_ARCA_TARGET_OCCUPIED',
        'Final Inventory target is not a directory.');
    }
    const preparedPlans = [];
    for (const plan of built.plans) {
      const stagedLocation = path.resolve(handle.slotDirectory, plan.name);
      const final = fs.existsSync(plan.target)
        ? await computeFingerprint(plan.target) : null;
      const finalExact = final && Number(final.stat.size) === plan.sizeBytes &&
        final.contentFingerprint === plan.contentFingerprint;
      const priorPlacementTarget = final && !finalExact &&
        priorPlacementCoversTarget(request, plan, handle);
      let finalSemantic = false;
      if (priorPlacementTarget) {
        try {
          const observed = await readStableNfo(plan.target);
          verifyFinalObservation(request, plan, observed);
          finalSemantic = true;
        } catch (error) {
          if (error?.code !== 'CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT') throw error;
        }
      }
      if (final && !finalExact && !priorPlacementTarget &&
          !isManagedSourceLocation(request, plan.target) &&
          blocksForeignTargetOverwrite(plan.member.role)) {
        fail('CLEAN_ARCA_TARGET_OCCUPIED',
          'Final Inventory media target contains conflicting bytes.');
      }
      let sourceSnapshot = null;
      // Same-root managed NFO settlement only. Foreign leftover presentation at
      // the planned path overwrites without this settlement mapping gate.
      if (final && !finalExact && !priorPlacementTarget && !request.aftercareCaseId && isMovieNfoPlan(plan) &&
          isManagedSourceLocation(request, plan.target)) {
        const source = request.onDeckProductPackage.offloadContextManifest?.members?.find((item) =>
          item.contextRole === 'related_input' && item.sourceRelatedReferenceId &&
          path.resolve(item.location) === path.resolve(plan.target) && item.finalProductMaterialKey === plan.member.materialKey);
        if (!source?.physicalIdentity) fail('CLEAN_ARCA_TARGET_OCCUPIED', 'NFO replacement has no exact related source mapping.');
        const sourceRequest = {materialHandle:{location:source.location,identity:source.physicalIdentity,
          expectedSizeBytes:source.physicalIdentity.sizeBytes},finalMaterialKey:plan.member.materialKey,finalInventoryRequest:request};
        sourceSnapshot = await readStableNfo(plan.target);
        try { verifySettlementSource(sourceRequest, sourceSnapshot, mutableSettlementBasis(sourceRequest, plan)); }
        catch (error) {
          if (error.code !== 'CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT') throw error;
          fail('CLEAN_ARCA_TARGET_OCCUPIED', 'NFO source facts changed before replacement.');
        }
      }
      preparedPlans.push(Object.freeze({
        plan, stagedLocation, final, finalExact, priorPlacementTarget,
        finalSemantic, sourceSnapshot,
      }));
    }
    // No final target may be changed until every destination has passed the
    // conflict preflight. A later conflicting member must not leave an earlier
    // member partially switched and force an otherwise deterministic failure
    // into Effect recovery.
    for (const prepared of preparedPlans) {
      const { plan, stagedLocation, finalExact, finalSemantic } = prepared;
      if (finalExact || finalSemantic) {
        continue;
      }
      if (!fs.existsSync(stagedLocation)) {
        fail('CLEAN_ARCA_STAGE_SLOT_MISSING',
          'Verified staged member disappeared before placement.');
      }
      await restorePresentationMember(request, plan, stagedLocation);
      const staged = await computeFingerprint(stagedLocation);
      if (Number(staged.stat.size) !== plan.sizeBytes ||
          staged.contentFingerprint !== plan.contentFingerprint) {
        fail('CLEAN_ARCA_STAGED_REALITY_DRIFT',
          'Verified staged member drifted before placement.');
      }
    }
    requireContinuation(request);
    for (const prepared of preparedPlans) {
      if (!prepared.sourceSnapshot) continue;
      try { assertSettlementSnapshot(prepared.sourceSnapshot, readStableNfoSync(prepared.plan.target)); }
      catch (error) {
        if (error.code !== 'CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT') throw error;
        fail('CLEAN_ARCA_TARGET_OCCUPIED', 'NFO source changed after replacement preflight.');
      }
    }
    if (!fs.existsSync(handle.targetDirectory)) {
      fs.mkdirSync(handle.targetDirectory, { recursive:true });
    }
    for (const prepared of preparedPlans) {
      const { plan, stagedLocation, final, finalExact, priorPlacementTarget,
        finalSemantic } = prepared;
      if (finalExact || finalSemantic) {
        if (fs.existsSync(stagedLocation)) fs.rmSync(stagedLocation, { force:true });
        continue;
      }
      if (final && !finalExact && (priorPlacementTarget ||
          isManagedSourceLocation(request, plan.target) ||
          isLibraryPresentationRole(plan.member.role))) {
        fs.rmSync(plan.target, { force:false });
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
    const slotSuffix = path.basename(handle.slotDirectory)
      .replace(/^.*?shelfdeck-stage-/, '');
    const unusedSlot = handle.slotDirectory ===
      hiddenStageSlotDirectory(handle.targetDirectory, slotSuffix)
      ? legacyStageSlotDirectory(handle.targetDirectory, slotSuffix)
      : hiddenStageSlotDirectory(handle.targetDirectory, slotSuffix);
    if (unusedSlot !== handle.slotDirectory && fs.existsSync(unusedSlot) &&
        fs.readdirSync(unusedSlot).length === 0) {
      fs.rmdirSync(unusedSlot);
    }
    return placementReceipt(request, handle, verification);
  }

  function finalRealityMember(request, plan, observed, verification) {
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
        digestHex:observationDigest(observed),
        sizeBytes:Number(observed.stat.size),
        contentFingerprint: observed.contentFingerprint,
        verificationKind:verification.verificationKind,
        semanticEvidenceDigest:verification.semanticEvidenceDigest,
        observedAtMs:Number.isSafeInteger(request.observedAtMs)?request.observedAtMs:0,
        episodeClaims:plan.episodeClaims,
      });
  }

  function finalRealityResult(request, built, members) {
    members.sort((left,right)=>Buffer.compare(Buffer.from(left.sourceMaterialKey),Buffer.from(right.sourceMaterialKey)));
    const stagedMembers=members.map((item)=>Object.freeze({sourceMaterialKey:item.sourceMaterialKey,
      physicalIdentity:item.physicalIdentity,role:item.role,
      endpointId:item.endpointId,location:item.location,bindingRevision:1,episodeClaims:item.episodeClaims}));
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
      observedAtMs:Number.isSafeInteger(request.observedAtMs)?request.observedAtMs:0,
      memberEvidence:Object.freeze(members.map((item)=>Object.freeze({
        sourceProductMaterialKey:item.sourceMaterialKey,
        role:item.role,
        verificationKind:item.verificationKind,
        actualPhysicalIdentity:item.physicalIdentity,
        observedAtMs:item.observedAtMs,
        semanticEvidenceDigest:item.semanticEvidenceDigest,
      }))),
      realityDigest: canonicalDigest({
        schema: 'arca.final-inventory-reality@1',
        targetDirectory: built.targetDirectory,
        members,
      }),
    });
  }

  function assertFinalFingerprint(plan, observed) {
    if (Number(observed.stat.size) !== plan.sizeBytes ||
        observed.contentFingerprint !== plan.contentFingerprint) {
      fail('CLEAN_ARCA_FINAL_REALITY_DRIFT',
        'Final Inventory member drifted after placement.');
    }
  }

  function verifyFinalObservation(request, plan, observed) {
    if (!isMovieNfoPlan(plan)) {
      assertFinalFingerprint(plan, observed);
      return Object.freeze({verificationKind:'exact_package_identity',semanticEvidenceDigest:null});
    }
    if (!readableNfo(observed.bytes)) {
      fail('CLEAN_ARCA_FINAL_NFO_UNREADABLE', 'Final Inventory requires a nonempty readable NFO.');
    }
    return Object.freeze({verificationKind:'readable_nfo',
      semanticEvidenceDigest:canonicalDigest({kind:'readable_nfo',contentFingerprint:observed.contentFingerprint})});
  }

  function assertFinalVerificationContext(request) {
    if (!['on_deck','aftercare'].includes(request?.verificationContext)) {
      fail('CLEAN_ARCA_FINAL_VERIFICATION_CONTEXT_REQUIRED',
        'Final Inventory reads require an explicit On-deck or Aftercare verification context.');
    }
  }

  function readStableNfoSync(location) {
    let lastError;
    for (let attempt=0;attempt<3;attempt+=1) {
      try{return readBoundedFileSnapshotSync(location,MAX_NFO_BYTES);}
      catch(error){lastError=error;if(error?.code!=='PHYSICAL_MATERIAL_STAT_FENCE_CHANGED')throw error;}
    }
    throw lastError;
  }

  async function readStableNfo(location) {
    let lastError;
    for (let attempt=0;attempt<3;attempt+=1) {
      try{return await readBoundedFileSnapshot(location,MAX_NFO_BYTES);}
      catch(error){lastError=error;if(error?.code!=='PHYSICAL_MATERIAL_STAT_FENCE_CHANGED')throw error;
        await new Promise((resolve)=>setImmediate(resolve));}
    }
    throw lastError;
  }

  function readFinal(request) {
    assertFinalVerificationContext(request);
    const built = buildPlan({ ...request, finalRealityRead:true });
    if (!fs.existsSync(built.targetDirectory) ||
        !fs.statSync(built.targetDirectory).isDirectory()) {
      fail('CLEAN_ARCA_FINAL_REALITY_MISSING',
        'Final Inventory target is absent after placement.');
    }
    const members = built.plans.map((plan) => {
      const observed = isMovieNfoPlan(plan)
        ? readStableNfoSync(plan.target)
        : computeBoundedMaterialFingerprintSync(plan.target);
      return finalRealityMember(request, plan, observed,
        verifyFinalObservation(request,plan,observed));
    });
    return finalRealityResult(request, built, members);
  }

  async function readFinalAsync(request) {
    assertFinalVerificationContext(request);
    const built = await buildPlanAsync({ ...request, finalRealityRead:true });
    let targetStat;
    try {
      targetStat = await fs.promises.stat(built.targetDirectory);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (!targetStat?.isDirectory()) {
      fail('CLEAN_ARCA_FINAL_REALITY_MISSING',
        'Final Inventory target is absent after placement.');
    }
    const members = [];
    for (const plan of built.plans) {
      const observed = isMovieNfoPlan(plan)
        ? await readStableNfo(plan.target)
        : await computeFingerprint(plan.target);
      members.push(finalRealityMember(request, plan, observed,
        verifyFinalObservation(request,plan,observed)));
    }
    return finalRealityResult(request, built, members);
  }

  function settleInput(request) {
    if(request&&Object.hasOwn(request,'finalTargets'))fail('CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID','Multiple targets require the asynchronous complete-set settlement path.');
    const handle = request?.materialHandle;
    if (!handle || handle.schemaRef !==
        'helix://contracts/types/PhysicalMaterialReadHandle/v1' ||
        handle.ownerDomain !== 'arca' ||
        handle.ownerScope?.scopeType !== 'on_deck_custody') {
      fail('CLEAN_ARCA_SETTLEMENT_HANDLE_INVALID',
        'Input settlement requires the exact Arca custody read handle.');
    }
    const source = path.resolve(handle.location);
    request.assertCurrentApproval?.(source);
    const finalRequest = request?.finalInventoryRequest;
    if (!finalRequest || !request.finalMaterialKey || !request.finalTargetLocation ||
        !request.sourceToFinalMappingDigest ||
        !['replace_or_move', 'remove_after_place'].includes(request.settlementExpectation)) {
      fail('CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID',
        'Input settlement requires its frozen source-to-final mapping.');
    }
    const built = buildPlan({ ...finalRequest, finalRealityRead:true });
    const finalPlan = built.plans.find((item) =>
      item.member.materialKey === request.finalMaterialKey);
    const finalTarget = path.resolve(request.finalTargetLocation);
    if (!finalPlan || path.resolve(finalPlan.target) !== finalTarget) {
      fail('CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT',
        'Settlement mapping drifted from the Final Inventory Decision.');
    }
    const finalObserved = isMovieNfoPlan(finalPlan)
      ? readStableNfoSync(finalTarget)
      : computeBoundedMaterialFingerprintSync(finalTarget);
    verifyFinalObservation(finalRequest,finalPlan,finalObserved);
    const sameLocation = source === finalTarget;
    const sourceBasis = mutableSettlementBasis(request, finalPlan);
    let preDeleteIdentityDigest = null;
    const sourceDirectory = path.dirname(source);
    let sourceAbsent = !fs.existsSync(source);
    if (!sourceAbsent) {
      const observed = sourceBasis ? readStableNfoSync(source) : computeBoundedMaterialFingerprintSync(source);
      if (!sameLocation) preDeleteIdentityDigest = currentSettlementIdentityDigest(handle, observed);
      if (sameLocation) {
        // Same-root Switch already replaced this path with product bytes.
        // The final target was role-verified above; NFO may have a different
        // physical identity while preserving its accepted presentation.
      } else {
        verifySettlementSource(request, observed, sourceBasis);
      }
      if (!sameLocation) {
        if (sourceBasis) assertSettlementSnapshot(observed, readStableNfoSync(source));
        request.assertCurrentApproval?.(source);
        fs.rmSync(source, { force:false });
        sourceAbsent = !fs.existsSync(source);
        if (!sourceAbsent) {
          fail('CLEAN_ARCA_SETTLEMENT_DELETE_FAILED',
            'Approved settlement source still exists after deletion.');
        }
      }
    }
    // A Settlement Handle authorizes one file, never its siblings or directories.
    const oldDirectoryDisposition = sameLocation ? 'retained_as_final'
      : fs.existsSync(sourceDirectory) ? 'retained_directory' : 'not_present';
    return Object.freeze({ materialKey:handle.identity.materialKey,
      preDeleteIdentityDigest,
      absent:sourceAbsent,
      disposition:sameLocation ? 'retained_as_final' : 'settled_to_final',
      sourceToFinalMappingDigest:request.sourceToFinalMappingDigest,
      finalMaterialKey:request.finalMaterialKey,
      finalTargetLocation:finalTarget,
      finalRealityDigest:observationDigest(finalObserved),
      finalVerified:true,
      oldDirectoryDisposition });
  }

  async function settleMultipleInputTargets(request,source) {
    const finalRequest=request.finalInventoryRequest,targets=request.finalTargets,handle=request.materialHandle;
    const reject=()=>fail('CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID','Multiple-target settlement requires its exact complete source-to-final mapping.');
    if(Object.hasOwn(request,'finalMaterialKey')||Object.hasOwn(request,'finalTargetLocation')||
        !Array.isArray(targets)||targets.length<2||targets.length>1024||request.settlementExpectation!=='remove_after_place'||
        finalRequest?.onDeckProductPackage?.productStructureSnapshot?.structureKind!=='season')reject();
    const packageValue=finalRequest.onDeckProductPackage;
    const sources=(packageValue.offloadContextManifest?.members||[]).filter(item=>item.materialKey===handle.identity.materialKey);
    if(sources.length!==1)reject();
    const sourceMember=sources[0],keys=offloadProductKeys(sourceMember);
    if(keys.length!==targets.length||request.sourceToFinalMappingDigest!==canonicalDigest(sourceMember)||
        path.resolve(sourceMember.location)!==source||canonicalDigest(sourceMember.physicalIdentity)!==canonicalDigest(handle.identity)||
        targets.some((item,index)=>item?.materialKey!==keys[index]||typeof item.targetLocation!=='string'||!item.targetLocation||item.targetLocation.length>4096))reject();
    const built=resolveTargetLocation(finalRequest),finals=finalRequest.finalInventoryMembers,seenPaths=new Set(),evidence=[];
    if(!Array.isArray(finals)||finals.length!==targets.length)reject();
    const realRoot=await fs.promises.realpath(built.targetDirectory);
    const realSource=await fs.promises.realpath(source).catch(error=>{if(error?.code==='ENOENT')return null;throw error;});
    const pathKey=value=>process.platform==='win32'?value.toLowerCase():value;

    for(const target of targets){
      const matches=finals.filter(item=>item.sourceMaterialKey===target.materialKey),
        products=packageValue.productMaterialManifest.members.filter(item=>item.materialKey===target.materialKey),
        location=path.resolve(target.targetLocation);
      if(matches.length!==1||products.length!==1||path.resolve(matches[0].targetLocation)!==location||
          !contained(built.targetDirectory,location)||location===source||seenPaths.has(location)||
          products[0].role!=='primary_payload'||products[0].controlOperation!=='acquire_workspace_product'||!products[0].episodeClaims?.length)
        fail('CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT','A multiple-target successor drifted from the accepted final mapping.');
      const realTarget=await fs.promises.realpath(location);
      if(!contained(realRoot,realTarget)||(realSource&&pathKey(realSource)===pathKey(realTarget))||seenPaths.has(pathKey(realTarget)))
        fail('CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT','A successor aliases the source or escapes the final target directory.');
      seenPaths.add(pathKey(realTarget));

      const plan={member:products[0],target:location,sizeBytes:Number(products[0].sizeBytes),contentFingerprint:products[0].physicalIdentity.contentFingerprint};
      const observed=await computeFingerprint(location);verifyFinalObservation(finalRequest,plan,observed);
      evidence.push(Object.freeze({materialKey:target.materialKey,targetLocation:location,finalRealityDigest:observationDigest(observed)}));
    }
    const exists=async location=>{try{await fs.promises.access(location);return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}};
    let absent=!await exists(source),preDeleteIdentityDigest=null;
    if(!absent){
      const observed=await computeFingerprint(source);verifySettlementSource(request,observed,null);
      preDeleteIdentityDigest=currentSettlementIdentityDigest(handle,observed);
      request.assertCurrentApproval?.(source);
      await fs.promises.rm(source,{force:false});absent=!await exists(source);
      if(!absent)fail('CLEAN_ARCA_SETTLEMENT_DELETE_FAILED','Approved settlement source still exists after deletion.');
    }
    return Object.freeze({materialKey:handle.identity.materialKey,preDeleteIdentityDigest,absent,disposition:'settled_to_final',
      sourceToFinalMappingDigest:request.sourceToFinalMappingDigest,finalTargets:Object.freeze(evidence),
      finalRealityDigest:canonicalDigest({schema:'arca.settlement-final-targets@1',members:evidence}),finalVerified:true,
      oldDirectoryDisposition:await exists(path.dirname(source))?'retained_directory':'not_present'});
  }

  async function settleInputAsync(request) {
    const handle = request?.materialHandle;
    if (!handle || handle.schemaRef !==
        'helix://contracts/types/PhysicalMaterialReadHandle/v1' ||
        handle.ownerDomain !== 'arca' ||
        handle.ownerScope?.scopeType !== 'on_deck_custody') {
      fail('CLEAN_ARCA_SETTLEMENT_HANDLE_INVALID',
        'Input settlement requires the exact Arca custody read handle.');
    }
    const source = path.resolve(handle.location);
    request.assertCurrentApproval?.(source);
    if(Object.hasOwn(request,'finalTargets'))return settleMultipleInputTargets(request,source);
    const finalRequest = request?.finalInventoryRequest;
    if (!finalRequest || !request.finalMaterialKey || !request.finalTargetLocation ||
        !request.sourceToFinalMappingDigest ||
        !['replace_or_move', 'remove_after_place'].includes(request.settlementExpectation)) {
      fail('CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID',
        'Input settlement requires its frozen source-to-final mapping.');
    }
    const target = resolveTargetLocation(finalRequest);
    const decisionMember = finalRequest.finalInventoryMember ||
      finalRequest.finalInventoryDecision?.members?.find((item) =>
        item.sourceMaterialKey === request.finalMaterialKey);
    const productMember = finalRequest.onDeckProductPackage?.productMaterialManifest?.members?.find((item) =>
      item.materialKey === request.finalMaterialKey);
    const finalTarget = path.resolve(request.finalTargetLocation);
    if (!decisionMember || !productMember ||
        path.resolve(decisionMember.targetLocation) !== finalTarget) {
      fail('CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT',
        'Settlement mapping drifted from the Final Inventory Decision.');
    }
    const finalPlan=Object.freeze({member:productMember,target:finalTarget,
      sizeBytes:Number(productMember.sizeBytes),contentFingerprint:productMember.physicalIdentity.contentFingerprint});
    const finalObserved = isMovieNfoPlan(finalPlan)
      ? await readStableNfo(finalTarget)
      : await computeFingerprint(finalTarget);
    verifyFinalObservation(finalRequest,finalPlan,finalObserved);
    const sameLocation = source === finalTarget;
    const sourceBasis = mutableSettlementBasis(request, finalPlan);
    let preDeleteIdentityDigest = null;
    const sourceDirectory = path.dirname(source);
    const exists = async (location) => {
      try { await fs.promises.access(location); return true; }
      catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
    };
    let sourceAbsent = !await exists(source);
    if (!sourceAbsent) {
      if (sameLocation) {
        // The final target was role-verified above.
      } else {
        const observed = sourceBasis ? await readStableNfo(source) : await computeFingerprint(source);
        verifySettlementSource(request, observed, sourceBasis);
        preDeleteIdentityDigest = currentSettlementIdentityDigest(handle, observed);
        if (sourceBasis) assertSettlementSnapshot(observed, readStableNfoSync(source));
      }
      if (!sameLocation) {
        request.assertCurrentApproval?.(source);
        await fs.promises.rm(source, { force:false });
        sourceAbsent = !await exists(source);
        if (!sourceAbsent) {
          fail('CLEAN_ARCA_SETTLEMENT_DELETE_FAILED',
            'Approved settlement source still exists after deletion.');
        }
      }
    }
    // A Settlement Handle authorizes one file, never its siblings or directories.
    const oldDirectoryDisposition = sameLocation ? 'retained_as_final'
      : await exists(sourceDirectory) ? 'retained_directory' : 'not_present';
    return Object.freeze({ materialKey:handle.identity.materialKey,
      preDeleteIdentityDigest,
      absent:sourceAbsent,
      disposition:sameLocation ? 'retained_as_final' : 'settled_to_final',
      sourceToFinalMappingDigest:request.sourceToFinalMappingDigest,
      finalMaterialKey:request.finalMaterialKey,
      finalTargetLocation:finalTarget,
      finalRealityDigest:observationDigest(finalObserved),
      finalVerified:true,
      oldDirectoryDisposition });
  }

  function inspectJavCorrectionPlacement(request) {
    if(!request?.correctionId||request.aftercareCaseId||packageContentProfile(request.onDeckProductPackage)!=='jav')
      fail('CLEAN_ARCA_CORRECTION_SCOPE_INVALID','Correction placement observation requires an owned JAV correction scope.');
    const built=buildPlan(request),members=request.onDeckProductPackage.productMaterialManifest.members;
    if(built.plans.filter(plan=>plan.member.role==='primary_payload').length!==1||
        request.shelf.placement.value.collisionPolicy!==undefined&&request.shelf.placement.value.collisionPolicy!=='reject')
      fail('CLEAN_ARCA_CORRECTION_SCOPE_INVALID','Correction must retain one video and reject name collisions.');
    const statMaybe=value=>{try{return fs.lstatSync(value);}catch(error){if(error.code==='ENOENT')return null;throw error;}},
      key=value=>{const resolved=path.resolve(value);return process.platform==='win32'?resolved.toLowerCase():resolved;},
      sources=new Map(built.plans.map(plan=>[key(plan.source),plan])),targetDirectory=built.targetDirectory;
    for(const target of [built.targetRoot,targetDirectory,...built.plans.map(plan=>plan.target)]) {
      let cursor=target;
      while(contained(built.targetRoot,cursor)) {
        if(statMaybe(cursor)?.isSymbolicLink())
          fail('CLEAN_ARCA_TARGET_ESCAPE','Correction target traverses a symbolic link.');
        if(key(cursor)===key(built.targetRoot))break;
        cursor=path.dirname(cursor);
      }
    }
    if(fs.existsSync(targetDirectory)) {
      if(!fs.statSync(targetDirectory).isDirectory()||!built.plans.some(plan=>key(path.dirname(plan.source))===key(targetDirectory)))
        fail('CLEAN_ARCA_TARGET_COLLISION','Correction target directory is already occupied.');
      const existing=fs.readdirSync(targetDirectory);
      if(existing.length>members.length||existing.some(name=>!sources.has(key(path.join(targetDirectory,name)))))
        fail('CLEAN_ARCA_TARGET_COLLISION','Correction cannot replace a directory containing materials outside this Entry.');
    }
    const observations=built.plans.map(plan=>{
      const targetExists=Boolean(statMaybe(plan.target)),ownedTarget=sources.get(key(plan.target)),observed=computeBoundedMaterialFingerprintSync(plan.source,{requireStableSnapshot:true});
      if(String(observed.stat.ino)!==plan.member.physicalIdentity.inode||Number(observed.stat.size)!==plan.member.physicalIdentity.sizeBytes||
          observed.contentFingerprint!==plan.member.physicalIdentity.contentFingerprint||statMaybe(plan.source)?.isSymbolicLink())
        fail('CLEAN_ARCA_PRODUCT_SOURCE_DRIFT','Correction source does not retain its exact owned Physical Identity.');
      if(targetExists&&(!ownedTarget||ownedTarget.member.materialKey!==plan.member.materialKey))
        fail('CLEAN_ARCA_TARGET_COLLISION','Correction target contains a conflicting material.');
      return {materialKey:plan.member.materialKey,sourceLocation:plan.source,targetLocation:plan.target,
        contentFingerprint:plan.contentFingerprint,sizeBytes:plan.sizeBytes,sourceInode:String(observed.stat.ino),targetExists};
    });
    return Object.freeze({schema:'arca.jav-correction-target-reality@1',targetRealityDigest:canonicalDigest({correctionId:request.correctionId,
      targetEndpointId:request.shelf.target.endpointId,targetDirectory,observations})});
  }

  return Object.freeze({ assess, resolveTargetLocation, resolvePolicyTargetLocation:request=>resolveTargetLocation(request,true), prepare, inspectJavCorrectionPlacement, materialize, slotHandle, prepareSlot, observeEmptyStageSlot,
    stage, verifyStaged, switchPlacement, readFinal, readFinalAsync, settleInput, settleInputAsync });
}

module.exports = Object.freeze({
  CleanArcaInventoryPortError,
  cooperativeCopyFile,
  createCleanArcaInventoryPort,
});
