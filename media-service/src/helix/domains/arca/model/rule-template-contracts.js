'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const RULES_SCHEMA_REF = 'helix://contracts/policies/ArcaRuleTemplateRules/v1';
const SYSTEM_TEMPLATE_ID = 'system-beta-recommended';
const PROFILE_ORDER = Object.freeze(['jav', 'movie', 'series', 'western_adult']);
const PROFILE_SET = new Set(PROFILE_ORDER);
const PROFILE_KEYS = Object.freeze([
  'contentProfile',
  'decisionInputKinds',
  'baseRequirements',
  'decisionBranches',
  'profileRuleSetDigest',
]);
const RULE_KEYS = Object.freeze(['profileRuleSets']);
const BRANCH_NO_RATING_KEYS = Object.freeze(['conditionKind', 'requirements']);
const BRANCH_RATING_KEYS = Object.freeze(['conditionKind', 'rating', 'requirements']);
const HIGH_QUALITY_AUDIO = Object.freeze([
  'dts_hd_ma',
  'dts_x',
  'eac3_atmos',
  'truehd',
  'truehd_atmos',
]);
const REQUIREMENT_KEYS = Object.freeze([
  'identity',
  'structure',
  'metadata',
  'mandatoryMedia',
  'space',
  'inventory',
]);
const IDENTITY_KINDS = new Set([
  'tmdb_movie',
  'tmdb_series_season',
  'jav_code',
  'internal_identity',
]);
const FIELD_CODES = new Set([
  'tmdb_movie_id',
  'tmdb_series_id',
  'title',
  'series_title',
  'year_or_release_date',
  'release_date',
  'plot',
  'genre',
  'actor',
  'director',
  'season_number',
  'episode_number',
  'episode_title',
  'episode_plot',
  'jav_code',
  'studio',
  'internal_identity',
]);
const ARTIFACT_KINDS = new Set(['nfo', 'poster', 'fanart']);
const AUDIO_CLASSES = new Set(HIGH_QUALITY_AUDIO);
const MEDIA_FORMS = new Set(['any', 'stream_file']);
const VIDEO_CODECS = new Set(['any', 'hevc']);
const CONTAINERS = new Set(['any', 'matroska']);
const EXTENSIONS = new Set(['any', 'mkv']);
const RASTER_CLASSES = new Set(['none', '4k']);

class ArcaRuleTemplateContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArcaRuleTemplateContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ArcaRuleTemplateContractError(code, message, details);
}

function exact(value, keys, code, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, 'Rule Template value does not match its closed contract.', { path });
  }
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sortedUnique(values, allowed, path) {
  if (!Array.isArray(values) || values.length > 256 ||
      values.some((value) => typeof value !== 'string' || !allowed.has(value)) ||
      new Set(values).size !== values.length ||
      canonicalJson([...values].sort(utf8Compare)) !== canonicalJson(values)) {
    fail('P14_RULE_TEMPLATE_REQUIREMENT_ARRAY', 'Requirement list is invalid.', { path });
  }
}

function validateRequirements(value, profile, structureKind) {
  exact(value, REQUIREMENT_KEYS, 'P14_RULE_TEMPLATE_REQUIREMENTS', 'requirements');
  const identityKeys = value.identity?.requiredProvider === undefined
    ? ['identityKind', 'requireSeasonNumber']
    : ['identityKind', 'requiredProvider', 'requireSeasonNumber'];
  exact(value.identity, identityKeys, 'P14_RULE_TEMPLATE_IDENTITY', 'requirements.identity');
  exact(
    value.structure,
    ['structureKind', 'primaryModel', 'requireOnePrimaryPerEpisode'],
    'P14_RULE_TEMPLATE_STRUCTURE',
    'requirements.structure',
  );
  exact(
    value.metadata,
    [
      'requiredFieldCodes',
      'requiredArtifactKinds',
      'requireRenderableSidecar',
      'requireDecodableImages',
    ],
    'P14_RULE_TEMPLATE_METADATA',
    'requirements.metadata',
  );
  exact(
    value.mandatoryMedia,
    [
      'mediaForm',
      'videoCodec',
      'container',
      'fileExtension',
      'minimumRasterClass',
      'acceptedPrimaryAudioClasses',
      'forbidSystemUpscaleFor4k',
    ],
    'P14_RULE_TEMPLATE_MEDIA',
    'requirements.mandatoryMedia',
  );
  exact(
    value.space,
    ['unit', 'maxSizeGiB', 'maxSizeBytes'],
    'P14_RULE_TEMPLATE_SPACE',
    'requirements.space',
  );
  exact(
    value.inventory,
    [
      'requireDomainBinding',
      'requireChecksum',
      'requiredMaterializedArtifactKinds',
      'layoutModel',
    ],
    'P14_RULE_TEMPLATE_INVENTORY',
    'requirements.inventory',
  );
  if (!IDENTITY_KINDS.has(value.identity.identityKind) ||
      typeof value.identity.requireSeasonNumber !== 'boolean' ||
      value.identity.requiredProvider !== undefined && value.identity.requiredProvider !== 'tmdb') {
    fail('P14_RULE_TEMPLATE_IDENTITY', 'Identity Requirement is invalid.');
  }
  if (profile === 'movie' &&
      (value.identity.identityKind !== 'tmdb_movie' ||
       value.identity.requiredProvider !== 'tmdb' ||
       value.identity.requireSeasonNumber) ||
      profile === 'series' &&
      (value.identity.identityKind !== 'tmdb_series_season' ||
       value.identity.requiredProvider !== 'tmdb' ||
       !value.identity.requireSeasonNumber) ||
      profile === 'jav' &&
      (value.identity.identityKind !== 'jav_code' ||
       value.identity.requireSeasonNumber) ||
      profile === 'western_adult' &&
      (value.identity.identityKind !== 'internal_identity' ||
       value.identity.requireSeasonNumber)) {
    fail('P14_RULE_TEMPLATE_IDENTITY', 'Identity Requirement conflicts with content profile.');
  }
  const expectedPrimary = structureKind === 'season' ? 'episode_primary' : 'single_primary';
  if (value.structure.structureKind !== structureKind ||
      value.structure.primaryModel !== expectedPrimary ||
      value.structure.requireOnePrimaryPerEpisode !== (structureKind === 'season')) {
    fail('P14_RULE_TEMPLATE_STRUCTURE', 'Structure Requirement conflicts with content profile.');
  }
  sortedUnique(value.metadata.requiredFieldCodes, FIELD_CODES, 'requiredFieldCodes');
  sortedUnique(value.metadata.requiredArtifactKinds, ARTIFACT_KINDS, 'requiredArtifactKinds');
  if (typeof value.metadata.requireRenderableSidecar !== 'boolean' ||
      typeof value.metadata.requireDecodableImages !== 'boolean') {
    fail('P14_RULE_TEMPLATE_METADATA', 'Metadata Requirement flags are invalid.');
  }
  if (!MEDIA_FORMS.has(value.mandatoryMedia.mediaForm) ||
      !VIDEO_CODECS.has(value.mandatoryMedia.videoCodec) ||
      !CONTAINERS.has(value.mandatoryMedia.container) ||
      !EXTENSIONS.has(value.mandatoryMedia.fileExtension) ||
      !RASTER_CLASSES.has(value.mandatoryMedia.minimumRasterClass) ||
      typeof value.mandatoryMedia.forbidSystemUpscaleFor4k !== 'boolean') {
    fail('P14_RULE_TEMPLATE_MEDIA', 'Mandatory Media Requirement is invalid.');
  }
  sortedUnique(
    value.mandatoryMedia.acceptedPrimaryAudioClasses,
    AUDIO_CLASSES,
    'acceptedPrimaryAudioClasses',
  );
  if (!['product', 'episode'].includes(value.space.unit) ||
      value.space.unit !== (profile === 'series' ? 'episode' : 'product')) {
    fail('P14_RULE_TEMPLATE_SPACE', 'Space Requirement unit is invalid.');
  }
  const hasLimit = value.space.maxSizeGiB !== null || value.space.maxSizeBytes !== null;
  if (hasLimit && (
      typeof value.space.maxSizeGiB !== 'number' ||
      !Number.isFinite(value.space.maxSizeGiB) ||
      value.space.maxSizeGiB <= 0 ||
      !Number.isSafeInteger(value.space.maxSizeBytes) ||
      value.space.maxSizeBytes !== value.space.maxSizeGiB * 1073741824
  )) {
    fail('P14_RULE_TEMPLATE_SPACE', 'Space Requirement byte value is invalid.');
  }
  if (!hasLimit &&
      (value.space.maxSizeGiB !== null || value.space.maxSizeBytes !== null)) {
    fail('P14_RULE_TEMPLATE_SPACE', 'Space Requirement nullable pair is invalid.');
  }
  sortedUnique(
    value.inventory.requiredMaterializedArtifactKinds,
    ARTIFACT_KINDS,
    'requiredMaterializedArtifactKinds',
  );
  if (value.inventory.requireDomainBinding !== true ||
      value.inventory.requireChecksum !== true ||
      value.inventory.layoutModel !== (profile === 'series' ? 'season_episode' : 'single')) {
    fail('P14_RULE_TEMPLATE_INVENTORY', 'Inventory Requirement is invalid.');
  }
}

function requirements({
  identity,
  structureKind,
  primaryModel,
  requireOnePrimaryPerEpisode,
  requiredFieldCodes,
  requiredArtifactKinds,
  mandatoryMedia,
  space,
  layoutModel,
}) {
  return Object.freeze({
    identity: Object.freeze(identity),
    structure: Object.freeze({
      structureKind,
      primaryModel,
      requireOnePrimaryPerEpisode,
    }),
    metadata: Object.freeze({
      requiredFieldCodes: Object.freeze([...requiredFieldCodes].sort(utf8Compare)),
      requiredArtifactKinds: Object.freeze([...requiredArtifactKinds].sort(utf8Compare)),
      requireRenderableSidecar: true,
      requireDecodableImages: true,
    }),
    mandatoryMedia: Object.freeze({
      mediaForm: mandatoryMedia.mediaForm,
      videoCodec: mandatoryMedia.videoCodec,
      container: mandatoryMedia.container,
      fileExtension: mandatoryMedia.fileExtension,
      minimumRasterClass: mandatoryMedia.minimumRasterClass,
      acceptedPrimaryAudioClasses: Object.freeze(
        [...mandatoryMedia.acceptedPrimaryAudioClasses].sort(utf8Compare),
      ),
      forbidSystemUpscaleFor4k: true,
    }),
    space: Object.freeze(space.maxSizeGiB === null
      ? { unit: space.unit, maxSizeGiB: null, maxSizeBytes: null }
      : {
          unit: space.unit,
          maxSizeGiB: space.maxSizeGiB,
          maxSizeBytes: space.maxSizeGiB * 1073741824,
        }),
    inventory: Object.freeze({
      requireDomainBinding: true,
      requireChecksum: true,
      requiredMaterializedArtifactKinds: Object.freeze(
        [...requiredArtifactKinds].sort(utf8Compare),
      ),
      layoutModel,
    }),
  });
}

function media({
  mediaForm = 'any',
  videoCodec = 'any',
  container = 'any',
  fileExtension = 'any',
  minimumRasterClass = 'none',
  acceptedPrimaryAudioClasses = [],
} = {}) {
  return Object.freeze({
    mediaForm,
    videoCodec,
    container,
    fileExtension,
    minimumRasterClass,
    acceptedPrimaryAudioClasses,
  });
}

function profile(base) {
  return Object.freeze({
    ...base,
    profileRuleSetDigest: canonicalDigest(base),
  });
}

function branch(rating, build) {
  return Object.freeze(rating === null
    ? { conditionKind: 'no_rating', requirements: build(null) }
    : { conditionKind: 'rating_equals', rating, requirements: build(rating) });
}

function ratingProfile({
  contentProfile,
  identity,
  structureKind,
  primaryModel,
  requireOnePrimaryPerEpisode,
  requiredFieldCodes,
  requiredArtifactKinds,
  layoutModel,
  noRatingMedia,
  ratedMedia,
  ratingSizes,
  spaceUnit,
}) {
  const make = (rating) => requirements({
    identity,
    structureKind,
    primaryModel,
    requireOnePrimaryPerEpisode,
    requiredFieldCodes,
    requiredArtifactKinds,
    mandatoryMedia: rating === null ? noRatingMedia : ratedMedia(rating),
    space: {
      unit: spaceUnit,
      maxSizeGiB: rating === null ? null : ratingSizes[rating - 1],
    },
    layoutModel,
  });
  return profile({
    contentProfile,
    decisionInputKinds: Object.freeze(['rating']),
    baseRequirements: make(null),
    decisionBranches: Object.freeze([
      branch(null, make),
      ...[1, 2, 3, 4, 5].map((rating) => branch(rating, make)),
    ]),
  });
}

function staticProfile({
  contentProfile,
  identity,
  requiredFieldCodes,
  requiredArtifactKinds,
  maxSizeGiB,
}) {
  return profile({
    contentProfile,
    decisionInputKinds: Object.freeze([]),
    baseRequirements: requirements({
      identity,
      structureKind: 'single',
      primaryModel: 'single_primary',
      requireOnePrimaryPerEpisode: false,
      requiredFieldCodes,
      requiredArtifactKinds,
      mandatoryMedia: media({
        videoCodec: 'hevc',
        container: 'matroska',
        fileExtension: 'mkv',
      }),
      space: { unit: 'product', maxSizeGiB },
      layoutModel: 'single',
    }),
    decisionBranches: Object.freeze([]),
  });
}

function createBetaRecommendedRules() {
  const movie = ratingProfile({
    contentProfile: 'movie',
    identity: { identityKind: 'tmdb_movie', requiredProvider: 'tmdb', requireSeasonNumber: false },
    structureKind: 'single',
    primaryModel: 'single_primary',
    requireOnePrimaryPerEpisode: false,
    requiredFieldCodes: ['tmdb_movie_id', 'title', 'year_or_release_date', 'plot', 'genre', 'actor', 'director'],
    requiredArtifactKinds: ['nfo', 'poster'],
    layoutModel: 'single',
    noRatingMedia: media({ mediaForm: 'stream_file' }),
    ratedMedia: (rating) => media({
      mediaForm: 'stream_file',
      videoCodec: 'hevc',
      minimumRasterClass: rating === 5 ? '4k' : 'none',
      acceptedPrimaryAudioClasses: rating === 5 ? HIGH_QUALITY_AUDIO : [],
    }),
    ratingSizes: [2, 4, 8, 14, 50],
    spaceUnit: 'product',
  });
  const series = ratingProfile({
    contentProfile: 'series',
    identity: { identityKind: 'tmdb_series_season', requiredProvider: 'tmdb', requireSeasonNumber: true },
    structureKind: 'season',
    primaryModel: 'episode_primary',
    requireOnePrimaryPerEpisode: true,
    requiredFieldCodes: [
      'tmdb_series_id',
      'series_title',
      'plot',
      'genre',
      'actor',
      'season_number',
      'episode_number',
      'episode_title',
      'episode_plot',
    ],
    requiredArtifactKinds: ['nfo', 'poster'],
    layoutModel: 'season_episode',
    noRatingMedia: media({ videoCodec: 'hevc' }),
    ratedMedia: () => media({ videoCodec: 'hevc' }),
    ratingSizes: [0.75, 1, 1.5, 2, 3],
    spaceUnit: 'episode',
  });
  const jav = staticProfile({
    contentProfile: 'jav',
    identity: { identityKind: 'jav_code', requireSeasonNumber: false },
    requiredFieldCodes: ['jav_code', 'title', 'release_date', 'studio', 'genre'],
    requiredArtifactKinds: ['fanart', 'nfo', 'poster'],
    maxSizeGiB: 2,
  });
  const westernAdult = staticProfile({
    contentProfile: 'western_adult',
    identity: { identityKind: 'internal_identity', requireSeasonNumber: false },
    requiredFieldCodes: ['internal_identity', 'title'],
    requiredArtifactKinds: ['nfo', 'poster'],
    maxSizeGiB: 1,
  });
  return Object.freeze({
    profileRuleSets: Object.freeze([jav, movie, series, westernAdult]),
  });
}

function validateBranch(branchValue, profileValue, index) {
  const path = 'profileRuleSets[' + index + '].decisionBranches';
  if (branchValue.conditionKind === 'no_rating') {
    exact(branchValue, BRANCH_NO_RATING_KEYS, 'P14_RULE_TEMPLATE_BRANCH', path);
  } else if (branchValue.conditionKind === 'rating_equals') {
    exact(branchValue, BRANCH_RATING_KEYS, 'P14_RULE_TEMPLATE_BRANCH', path);
    if (!Number.isSafeInteger(branchValue.rating) || branchValue.rating < 1 || branchValue.rating > 5) {
      fail('P14_RULE_TEMPLATE_BRANCH', 'Rating branch is outside 1..5.', { path });
    }
  } else {
    fail('P14_RULE_TEMPLATE_BRANCH', 'Rule branch discriminator is invalid.', { path });
  }
  validateRequirements(
    branchValue.requirements,
    profileValue.contentProfile,
    profileValue.contentProfile === 'series' ? 'season' : 'single',
  );
}

function validateRuleTemplateRules(schemaRef, value, digest) {
  if (schemaRef !== RULES_SCHEMA_REF) {
    fail('P14_RULE_TEMPLATE_SCHEMA', 'Rule Template rules schema is not registered.');
  }
  exact(value, RULE_KEYS, 'P14_RULE_TEMPLATE_RULES', 'rules');
  if (!Array.isArray(value.profileRuleSets) ||
      value.profileRuleSets.length < 1 ||
      value.profileRuleSets.length > 4) {
    fail('P14_RULE_TEMPLATE_PROFILE_SET', 'Rule Template requires 1..4 Profile Rule Sets.');
  }
  const profiles = value.profileRuleSets.map((profileValue, index) => {
    exact(
      profileValue,
      PROFILE_KEYS,
      'P14_RULE_TEMPLATE_PROFILE',
      'profileRuleSets[' + index + ']',
    );
    if (!PROFILE_SET.has(profileValue.contentProfile)) {
      fail('P14_RULE_TEMPLATE_PROFILE', 'Rule Template content profile is invalid.', { index });
    }
    if (!Array.isArray(profileValue.decisionInputKinds) ||
        profileValue.decisionInputKinds.some((kind) => kind !== 'rating') ||
        new Set(profileValue.decisionInputKinds).size !== profileValue.decisionInputKinds.length ||
        canonicalJson([...profileValue.decisionInputKinds].sort(utf8Compare)) !==
          canonicalJson(profileValue.decisionInputKinds)) {
      fail('P14_RULE_TEMPLATE_INPUT_KIND', 'Only the registered rating Decision Input is allowed.');
    }
    if (!Array.isArray(profileValue.decisionBranches)) {
      fail('P14_RULE_TEMPLATE_BRANCH', 'Rule Template branches must be an array.', { index });
    }
    validateRequirements(
      profileValue.baseRequirements,
      profileValue.contentProfile,
      profileValue.contentProfile === 'series' ? 'season' : 'single',
    );
    if (profileValue.decisionInputKinds.length === 0) {
      if (profileValue.decisionBranches.length !== 0) {
        fail('P14_RULE_TEMPLATE_BRANCH', 'An input-free Profile cannot contain conditional branches.');
      }
    } else {
      if (profileValue.decisionBranches.length !== 6) {
        fail('P14_RULE_TEMPLATE_BRANCH', 'Rating Profile requires no-rating plus 1..5 branches.');
      }
      profileValue.decisionBranches.forEach((item) => validateBranch(item, profileValue, index));
      const signatures = profileValue.decisionBranches.map((item) =>
        item.conditionKind === 'no_rating' ? '0' : String(item.rating));
      if (canonicalJson(signatures) !== canonicalJson(['0', '1', '2', '3', '4', '5'])) {
        fail('P14_RULE_TEMPLATE_BRANCH', 'Rating branches are not in canonical order.');
      }
    }
    const unsigned = Object.fromEntries(
      Object.entries(profileValue).filter(([key]) => key !== 'profileRuleSetDigest'),
    );
    if (profileValue.profileRuleSetDigest !== canonicalDigest(unsigned)) {
      fail('P14_RULE_TEMPLATE_PROFILE_DIGEST', 'Profile Rule Set digest is invalid.', { index });
    }
    return profileValue.contentProfile;
  });
  if (new Set(profiles).size !== profiles.length ||
      canonicalJson([...profiles].sort(utf8Compare)) !== canonicalJson(profiles)) {
    fail('P14_RULE_TEMPLATE_PROFILE_ORDER', 'Profile Rule Sets must be unique and UTF-8 ordered.');
  }
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 65536) {
    fail('P14_RULE_TEMPLATE_SIZE', 'Rule Template rules exceed 64 KiB.');
  }
  if (digest !== canonicalDigest(value)) {
    fail('P14_RULE_TEMPLATE_RULES_DIGEST', 'Rule Template rules digest is invalid.');
  }
  return value;
}

function buildShelfStandard({
  shelfId,
  standardRevision,
  ruleTemplateId,
  ruleTemplateRevision,
  rules,
}) {
  const base = {
    shelfId,
    standardRevision,
    ruleTemplateId,
    ruleTemplateRevision,
    profileRuleSets: rules.profileRuleSets,
  };
  return Object.freeze({
    ...base,
    standardDigest: canonicalDigest(base),
  });
}

const BETA_RECOMMENDED_RULES = createBetaRecommendedRules();
const BETA_RECOMMENDED_RULES_DIGEST = canonicalDigest(BETA_RECOMMENDED_RULES);

validateRuleTemplateRules(
  RULES_SCHEMA_REF,
  BETA_RECOMMENDED_RULES,
  BETA_RECOMMENDED_RULES_DIGEST,
);

module.exports = Object.freeze({
  ArcaRuleTemplateContractError,
  BETA_RECOMMENDED_RULES,
  BETA_RECOMMENDED_RULES_DIGEST,
  RULES_SCHEMA_REF,
  SYSTEM_TEMPLATE_ID,
  buildShelfStandard,
  validateRuleTemplateRules,
});
