'use strict';

const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { normalizeAudioClass } = require('../../../contracts/normalized-audio-class');
const { acceptsProductionAttestation } = require('./authorized-defect-manifest');

const READ_SET_SCHEMA =
  'helix://contracts/domain-types/ShelfAcceptancePrimaryReadSet/v1';
const HANDLE_SCHEMA =
  'helix://contracts/types/PhysicalMaterialReadHandle/v1';
const REQUIREMENT_SCHEMA =
  'helix://contracts/domain-types/MandatoryRequirement/v1';
const GAP_ORDER = Object.freeze([
  'media_form_unmet',
  'video_codec_unmet',
  'container_unmet',
  'file_extension_unmet',
  'minimum_raster_unmet',
  'system_upscale_forbidden',
  'primary_audio_unmet',
  'dynamic_range_conversion_unmet',
  'output_color_profile_unmet',
  'dolby_vision_metadata_not_removed',
  'playback_decode_failed',
]);
const GAP_INDEX = new Map(GAP_ORDER.map((value, index) => [value, index]));
const SAMPLE_POINTS = Object.freeze([5, 50, 95]);
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCEPTED_OUTPUT_DYNAMIC_RANGE_KINDS = Object.freeze([
  'sdr',
  'hdr10_compatible',
  'hlg',
  'dolby_vision',
  'unknown',
]);

class MandatoryMediaAcceptanceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MandatoryMediaAcceptanceError';
    this.code = code;
    this.details = details;
  }
}

function invalid(message, details) {
  throw new MandatoryMediaAcceptanceError(
    'ARCA_MANDATORY_MEDIA_INVALID_CONTRACT', message, details);
}

function ordered(values) {
  return Object.freeze([...new Set(values || [])].sort((left, right) =>
    (GAP_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (GAP_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    Buffer.compare(Buffer.from(left), Buffer.from(right))));
}

function gapSetDigest(items, checkKind = 'mandatory_media') {
  return canonicalDigest({
    schema: 'arca.acceptance-check-actual-gap-set@1',
    checkKind,
    items,
  });
}

function exactDigest(value, digestField) {
  const body = Object.fromEntries(Object.entries(value || {})
    .filter(([name]) => name !== digestField));
  return value?.[digestField] === canonicalDigest(body);
}

function normalizedLocation(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const resolved = path.resolve(value.replace(/\//g, path.sep));
  return path.normalize(value.replace(/\//g, path.sep)) === resolved
    ? resolved : null;
}

function primaryStreams(streams) {
  const orderedStreams = [...(Array.isArray(streams) ? streams : [])]
    .sort((left, right) => Number(left.streamIndex) - Number(right.streamIndex));
  const defaults = orderedStreams.filter((item) => item.dispositionDefault === true);
  return defaults.length ? defaults : orderedStreams.slice(0, 1);
}

function dimensions(stream) {
  const width = Number(stream?.displayWidth || stream?.width || stream?.codedWidth || 0);
  const height = Number(stream?.displayHeight || stream?.height || stream?.codedHeight || 0);
  return { longEdge:Math.max(width, height), shortEdge:Math.min(width, height) };
}

function rasterClass(probe) {
  const videos = primaryStreams(probe?.videoStreams);
  if (!videos.length) return 'none';
  const values = videos.map(dimensions);
  if (values.every((item) => item.longEdge >= 3800 && item.shortEdge >= 1600)) {
    return '4k';
  }
  if (values.every((item) => item.longEdge >= 1900 && item.shortEdge >= 800)) {
    return '1080p';
  }
  if (values.every((item) => item.longEdge >= 1200 && item.shortEdge >= 600)) {
    return '720p';
  }
  return 'below_720p';
}

function primaryVideo(probe) {
  return primaryStreams(probe?.videoStreams)[0] || {};
}

function videoCodec(probe) {
  const codecs = [...new Set(primaryStreams(probe?.videoStreams)
    .map((item) => String(item.codec || item.codecName || '').toLowerCase()))];
  return codecs.length === 1 && codecs[0] ? codecs[0] :
    codecs.length ? 'mixed' : 'none';
}

function audioClasses(probe) {
  return Object.freeze([...new Set(primaryStreams(probe?.audioStreams).map((item) =>
    typeof item.normalizedAudioClass === 'string' && item.normalizedAudioClass
      ? item.normalizedAudioClass
      : normalizeAudioClass({ ...item,
        codec:String(item.codec || item.codecName || '').toLowerCase() })))]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
}

function dynamicRangeKind(probe) {
  const kinds = [...new Set(primaryStreams(probe?.videoStreams)
    .map((item) => item.dynamicRangeKind || 'unknown'))];
  return kinds.length === 1 ? kinds[0] : 'unknown';
}

function colorProfile(video) {
  return Object.freeze({
    range: video.colorRange || 'unknown',
    primaries: video.colorPrimaries || 'unknown',
    transfer: video.colorTransfer || 'unknown',
    matrix: video.colorMatrix || 'unknown',
  });
}

function decodeSummary(value) {
  const passed = [...(value?.passedSamplePointsPercent || [])]
    .filter((item) => SAMPLE_POINTS.includes(item))
    .sort((left, right) => left - right);
  return Object.freeze({
    samplePointsPercent: SAMPLE_POINTS,
    passedSamplePointsPercent: Object.freeze([...new Set(passed)]),
    decodeDigest: value?.decodeDigest || canonicalDigest({
      schema: 'arca.mandatory-media-decode-missing@1',
      passed,
    }),
  });
}

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function handleRole(item, product) {
  if (item.samePhysicalMaterial) return 'source_and_product_primary';
  return product ? 'product_primary' : 'source_primary';
}

function validateHandle(handle, item, readSet, packageValue, product) {
  const role = handleRole(item, product);
  if (!handle || handle.schemaRef !== HANDLE_SCHEMA || handle.schemaVersion !== 1 ||
      handle.ownerDomain !== 'libra' ||
      handle.ownerScope?.scopeType !== 'on_deck_package' ||
      handle.ownerScope?.scopeId !== packageValue.onDeckPackageId ||
      handle.readScope !== 'shelf_acceptance_primary_probe_decode' ||
      handle.expiresAtMs !== readSet.expiresAtMs ||
      handle.fingerprintVerifiedAtMs !== readSet.issuedAtMs ||
      !normalizedLocation(handle.location)) {
    invalid('Shelf Acceptance Physical Material Handle is outside its exact Package authority.', {
      materialKey:item.materialKey,
      readRole:role,
    });
  }
  const expectedId = canonicalDigest({
    schema: 'libra.shelf-acceptance-primary-read-handle-id@1',
    onDeckPackageId: packageValue.onDeckPackageId,
    libraRunId: packageValue.libraRunId,
    readRole: role,
    materialKey: handle.identity.materialKey,
    bindingRevision: handle.bindingRevision,
    productMemberDigest: item.productMemberDigest,
    acceptanceSpecRecordDigest: packageValue.acceptanceSpecRef.recordDigest,
  });
  const handleBody = Object.fromEntries(Object.entries(handle)
    .filter(([name]) => name !== 'fenceDigest'));
  const expectedFence = canonicalDigest({
    schema: 'libra.shelf-acceptance-primary-read-handle-fence@1',
    ...handleBody,
    libraRunId: packageValue.libraRunId,
    runExecutionBasisDigest: packageValue.runExecutionBasisDigest,
    acceptanceSpecId: packageValue.acceptanceSpecRef.id,
    acceptanceSpecRecordDigest: packageValue.acceptanceSpecRef.recordDigest,
    productMemberDigest: item.productMemberDigest,
    readRole: role,
  });
  if (handle.handleId !== expectedId || handle.fenceDigest !== expectedFence) {
    invalid('Shelf Acceptance Physical Material Handle identity or fence is invalid.', {
      materialKey:item.materialKey,
      readRole:role,
    });
  }
}

function validateReadSet(packageValue, requirement) {
  const readSet = packageValue?.productionProvenance?.shelfAcceptancePrimaryReadSet;
  const productMembers = (packageValue?.productMaterialManifest?.members || [])
    .filter((item) => item.role === 'primary_payload')
    .sort((left, right) => Buffer.compare(
      Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
  if (!readSet || readSet.schemaRef !== READ_SET_SCHEMA || readSet.schemaVersion !== 1 ||
      readSet.onDeckPackageId !== packageValue.onDeckPackageId ||
      readSet.libraRunId !== packageValue.libraRunId ||
      readSet.runExecutionBasisDigest !== packageValue.runExecutionBasisDigest ||
      readSet.acceptanceSpecId !== packageValue.acceptanceSpecRef?.id ||
      readSet.acceptanceSpecRecordDigest !== packageValue.acceptanceSpecRef?.recordDigest ||
      readSet.expiresAtMs !== readSet.issuedAtMs + DAY_MS ||
      !Array.isArray(readSet.primaryInputs) ||
      readSet.primaryInputs.length !== productMembers.length ||
      readSet.primaryInputSetDigest !== canonicalDigest({
        schema: 'libra.shelf-acceptance-primary-input-set@1',
        items: readSet.primaryInputs,
      })) {
    invalid('Shelf Acceptance Primary Read Set is not bound to the exact Package basis.');
  }
  const readBody = Object.fromEntries(Object.entries(readSet)
    .filter(([name]) => name !== 'readAuthorityDigest'));
  if (readSet.readAuthorityDigest !== canonicalDigest({
    schema: 'libra.shelf-acceptance-primary-read-authority@1',
    ...readBody,
  })) invalid('Shelf Acceptance Primary Read Set authority digest is invalid.');
  if (!requirement || requirement.schemaRef !== REQUIREMENT_SCHEMA ||
      requirement.schemaVersion !== 1 || !exactDigest(requirement, 'digest') ||
      requirement.shelfId !== packageValue.shelfId ||
      canonicalJson(requirement.acceptedOutputDynamicRangeKinds) !==
        canonicalJson(ACCEPTED_OUTPUT_DYNAMIC_RANGE_KINDS)) {
    invalid('Mandatory Requirement is not an exact executable Shelf contract.');
  }
  readSet.primaryInputs.forEach((item, index) => {
    const member = productMembers[index];
    const itemBody = Object.fromEntries(Object.entries(item)
      .filter(([name]) => name !== 'itemDigest'));
    if (item.ordinal !== index || item.materialKey !== member?.materialKey ||
        item.productMemberDigest !== member?.memberDigest ||
        item.itemDigest !== canonicalDigest(itemBody) ||
        item.productMediaVerificationDigest !==
          canonicalDigest(item.productMediaVerification) ||
        item.productMediaVerification?.libraRunId !== packageValue.libraRunId ||
        packageValue.productionProvenance?.productVerificationRefs?.filter((ref) =>
          ref.verificationId === item.productMediaVerification?.verificationId &&
          ref.verificationDigest === item.productMediaVerificationDigest).length !== 1 ||
        item.sourceReadHandleDigest !== canonicalDigest(item.sourceReadHandle) ||
        item.productReadHandleDigest !== canonicalDigest(item.productReadHandle)) {
      invalid('Shelf Acceptance Primary Read Set item does not match the Product Primary.', {
        ordinal:index,
      });
    }
    validateHandle(item.sourceReadHandle, item, readSet, packageValue, false);
    validateHandle(item.productReadHandle, item, readSet, packageValue, true);
    const product = item.productReadHandle;
    if (product.identity.materialKey !== member.materialKey ||
        !sameIdentity(product.identity, member.physicalIdentity) ||
        product.bindingRevision !== member.bindingRevision ||
        product.endpointId !== member.location.endpointId ||
        product.expectedSizeBytes !== member.sizeBytes) {
      invalid('Product read Handle does not match Package Binding and Physical Identity.', {
        materialKey:item.materialKey,
      });
    }
    if (member.location.locationKind === 'domain_binding' &&
        normalizedLocation(member.location.location) !==
          normalizedLocation(product.location)) {
      invalid('Product read Handle is outside the Package domain Binding containment.', {
        materialKey:item.materialKey,
      });
    }
    if (item.samePhysicalMaterial !==
          sameIdentity(item.sourceReadHandle.identity, product.identity) ||
        (item.samePhysicalMaterial && canonicalJson(item.sourceReadHandle) !==
          canonicalJson(product))) {
      invalid('Source/Product Physical Material variant is inconsistent.', {
        materialKey:item.materialKey,
      });
    }
    const verification = item.productMediaVerification;
    const conversionOperation =
      verification?.dynamicRangeSummary?.conversionOperation;
    if ((item.samePhysicalMaterial &&
          (verification?.candidateKind !== 'direct_input' ||
           conversionOperation !== 'none')) ||
        (!item.samePhysicalMaterial &&
          (verification?.candidateKind !== 'workspace_output' ||
           !['none', 'preserve', 'tone_map_to_sdr_bt709']
             .includes(conversionOperation)))) {
      invalid('Product media operation does not match the Source/Product Handle variant.', {
        materialKey:item.materialKey,
      });
    }
  });
  if (!acceptsProductionAttestation(packageValue.productionAttestation, packageValue)) {
    invalid('Production Attestation is not closed over the exact Package context.');
  }
  return Object.freeze({ readSet, productMembers });
}

function realityMatches(handle, bounded) {
  const stat = bounded?.stat;
  return stat &&
    Number(stat.size) === handle.expectedSizeBytes &&
    Number(stat.size) === handle.identity.sizeBytes &&
    String(stat.ino) === handle.identity.inode &&
    Number(stat.mtimeNs / 1_000_000n) === handle.expectedMtimeNs &&
    Number(stat.ctimeNs / 1_000_000n) === handle.expectedCtimeNs &&
    bounded.fingerprintAlgorithm === handle.identity.fingerprintAlgorithm &&
    bounded.fingerprintVersion === handle.identity.fingerprintVersion &&
    bounded.contentFingerprint === handle.identity.contentFingerprint;
}

function requirementGaps(requirement, item, sourceProbe, productProbe,
  sourceDecode, productDecode, observedSizeBytes) {
  const gaps = [];
  const outputVideo = primaryVideo(productProbe);
  const outputRaster = rasterClass(productProbe);
  const sourceRaster = rasterClass(sourceProbe);
  const outputDynamic = dynamicRangeKind(productProbe);
  const sourceDynamic = dynamicRangeKind(sourceProbe);
  const outputColor = colorProfile(outputVideo);
  const dovi = primaryStreams(productProbe?.videoStreams)
    .some((stream) => stream.dynamicRangeKind === 'dolby_vision' || stream.dolbyVision);
  const extension = path.extname(item.productReadHandle.location).slice(1).toLowerCase() || 'none';
  const container = String(productProbe?.container || 'none').toLowerCase();
  const codec = videoCodec(productProbe);
  const audio = audioClasses(productProbe);
  if (requirement.mediaForm === 'stream_file' &&
      (productProbe?.resultKind !== 'probed' || productProbe?.discTopology)) {
    gaps.push('media_form_unmet');
  }
  if (requirement.videoCodec !== 'any' && codec !== requirement.videoCodec) {
    gaps.push('video_codec_unmet');
  }
  if (requirement.container !== 'any' && container !== requirement.container) {
    gaps.push('container_unmet');
  }
  if (requirement.fileExtension !== 'any' && extension !== requirement.fileExtension) {
    gaps.push('file_extension_unmet');
  }
  const rasterRank = new Map([
    ['none', 0], ['below_720p', 0], ['720p', 1], ['1080p', 2], ['4k', 3],
  ]);
  if ((rasterRank.get(outputRaster) || 0) <
      (rasterRank.get(requirement.minimumRasterClass) || 0)) {
    gaps.push('minimum_raster_unmet');
  }
  const systemUpscale = outputRaster === '4k' && sourceRaster !== '4k';
  if (requirement.forbidSystemUpscaleFor4k && systemUpscale) {
    gaps.push('system_upscale_forbidden');
  }
  if (requirement.acceptedPrimaryAudioClasses.length &&
      !audio.some((itemValue) =>
        requirement.acceptedPrimaryAudioClasses.includes(itemValue))) {
    gaps.push('primary_audio_unmet');
  }
  const expectedConversion =
    item.productMediaVerification?.dynamicRangeSummary?.conversionOperation || 'none';
  const attestedDynamic = item.productMediaVerification?.dynamicRangeSummary || {};
  if (expectedConversion === 'tone_map_to_sdr_bt709') {
    if (attestedDynamic.sourceDynamicRangeKind !== 'dolby_vision' ||
        attestedDynamic.outputDynamicRangeKind !== 'sdr' ||
        sourceDynamic !== 'dolby_vision' || outputDynamic !== 'sdr') {
      gaps.push('dynamic_range_conversion_unmet');
    }
    if (outputVideo.pixelFormat !== requirement.sdrOutputPixelFormat ||
        canonicalJson(outputColor) !== canonicalJson(requirement.sdrOutputColorProfile)) {
      gaps.push('output_color_profile_unmet');
    }
    if (requirement.forbidDolbyVisionMetadataOnSdr && dovi) {
      gaps.push('dolby_vision_metadata_not_removed');
    }
  } else if (expectedConversion === 'preserve') {
    if (!requirement.acceptedOutputDynamicRangeKinds.includes(outputDynamic) ||
        sourceDynamic !== outputDynamic ||
        sourceDynamic !== attestedDynamic.sourceDynamicRangeKind ||
        outputDynamic !== attestedDynamic.outputDynamicRangeKind) {
      gaps.push('dynamic_range_conversion_unmet');
    }
  } else if (!requirement.acceptedOutputDynamicRangeKinds.includes(outputDynamic) ||
      outputDynamic !== attestedDynamic.outputDynamicRangeKind) {
    gaps.push('dynamic_range_conversion_unmet');
  }
  if (sourceDecode.passedSamplePointsPercent.length !== SAMPLE_POINTS.length ||
      productDecode.passedSamplePointsPercent.length !== SAMPLE_POINTS.length) {
    gaps.push('playback_decode_failed');
  }
  return Object.freeze({
    actualGapCodes: ordered(gaps),
    observedSizeBytes,
    qualitySummary: Object.freeze({
      videoCodec: codec,
      container,
      fileExtension: extension,
      displayRasterClass: outputRaster,
      primaryAudioClasses: audio,
      sourceDisplayRasterClass: sourceRaster,
      systemUpscaleDetected: systemUpscale,
    }),
    dynamicRangeSummary: Object.freeze({
      sourceDynamicRangeKind: sourceDynamic,
      outputDynamicRangeKind: outputDynamic,
      conversionOperation: expectedConversion,
      outputPixelFormat: outputVideo.pixelFormat || 'unknown',
      outputColorProfile: outputColor,
      dolbyVisionMetadataPresent: dovi,
    }),
  });
}

function staleResult() {
  const gaps = Object.freeze([]);
  return Object.freeze({
    evidenceStatus: 'stale_basis',
    actualGapCodes: gaps,
    actualGapSetDigest: gapSetDigest(gaps),
    primaryMediaObservations: Object.freeze([]),
    primaryMediaObservationSetDigest: canonicalDigest({
      schema: 'arca.mandatory-media-primary-observation-set@1',
      items: [],
    }),
  });
}

async function observeMandatoryMedia(value) {
  const { packageValue, requirement, observedAtMs, mediaProbe,
    mediaEffectPort, computeBoundedMaterialFingerprint, shouldContinue } = value;
  const { readSet } = validateReadSet(packageValue, requirement);
  if (readSet.expiresAtMs < observedAtMs) return staleResult();
  if (typeof mediaProbe?.probe !== 'function' ||
      typeof mediaEffectPort?.verifyPlayback !== 'function' ||
      typeof computeBoundedMaterialFingerprint !== 'function') {
    invalid('Mandatory media observation ports are unavailable.');
  }
  const observations = [];
  for (const item of readSet.primaryInputs) {
    if (typeof shouldContinue === 'function' && shouldContinue() === false) {
      throw Object.assign(new Error('Mandatory media observation was cancelled.'), {
        code: 'ARCA_MANDATORY_MEDIA_OBSERVATION_CANCELLED',
      });
    }
    let sourceReality;
    let productReality;
    try {
      sourceReality = await computeBoundedMaterialFingerprint(
        normalizedLocation(item.sourceReadHandle.location));
      productReality = item.samePhysicalMaterial ? sourceReality :
        await computeBoundedMaterialFingerprint(
          normalizedLocation(item.productReadHandle.location));
    } catch (error) {
      if (error?.code === 'PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED' &&
          !['ENOENT', 'ENOTDIR'].includes(error?.details?.causeCode)) throw error;
      return staleResult();
    }
    if (!realityMatches(item.sourceReadHandle, sourceReality) ||
        !realityMatches(item.productReadHandle, productReality)) return staleResult();
    const sourceProbe = await mediaProbe.probe(item.sourceReadHandle);
    const productProbe = await mediaProbe.probe(item.productReadHandle);
    const sourceDecode = decodeSummary(await mediaEffectPort.verifyPlayback({
      physicalMaterialReadHandle: item.sourceReadHandle,
      outputProbeEvidence: sourceProbe,
      deadlineAtMs: value.deadlineAtMs,
      shouldContinue,
    }));
    const productDecode = decodeSummary(await mediaEffectPort.verifyPlayback({
      physicalMaterialReadHandle: item.productReadHandle,
      outputProbeEvidence: productProbe,
      deadlineAtMs: value.deadlineAtMs,
      shouldContinue,
    }));
    const evaluated = requirementGaps(requirement, item, sourceProbe, productProbe,
      sourceDecode, productDecode, Number(productReality.stat.size));
    const body = {
      ordinal: item.ordinal,
      materialKey: item.materialKey,
      sourceReadHandleDigest: item.sourceReadHandleDigest,
      productReadHandleDigest: item.productReadHandleDigest,
      requirementDigest: requirement.digest,
      sourceProbeEvidenceDigest: canonicalDigest(sourceProbe),
      productProbeEvidenceDigest: canonicalDigest(productProbe),
      observedSizeBytes: evaluated.observedSizeBytes,
      qualitySummary: evaluated.qualitySummary,
      dynamicRangeSummary: evaluated.dynamicRangeSummary,
      sourceDecodeSummary: sourceDecode,
      productDecodeSummary: productDecode,
      actualGapCodes: evaluated.actualGapCodes,
      actualGapSetDigest: gapSetDigest(evaluated.actualGapCodes),
      observedAtMs,
    };
    observations.push(Object.freeze({ ...body,
      observationDigest: canonicalDigest(body) }));
  }
  observations.sort((left, right) => Buffer.compare(
    Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
  const gaps = ordered(observations.flatMap((item) => item.actualGapCodes));
  return Object.freeze({
    evidenceStatus: 'complete',
    actualGapCodes: gaps,
    actualGapSetDigest: gapSetDigest(gaps),
    primaryMediaObservations: Object.freeze(observations),
    primaryMediaObservationSetDigest: canonicalDigest({
      schema: 'arca.mandatory-media-primary-observation-set@1',
      items: observations,
    }),
  });
}

module.exports = Object.freeze({
  ACCEPTED_OUTPUT_DYNAMIC_RANGE_KINDS,
  GAP_ORDER,
  MandatoryMediaAcceptanceError,
  gapSetDigest,
  observeMandatoryMedia,
  ordered,
  validateReadSet,
});
