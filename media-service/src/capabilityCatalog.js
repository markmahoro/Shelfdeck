'use strict';

const TYPES = Object.freeze({
  NONE: 'None', SOURCE_OBSERVATION: 'SourceObservation', LAYOUT_OBSERVATION: 'LayoutObservation',
  VERIFIED_BASEDATA: 'VerifiedBasedata', BASEDATA_PUBLICATION: 'BasedataPublication', METADATA_PUBLICATION: 'MetadataPublication', MEDIA_IDENTITY: 'MediaIdentity',
  METADATA_OBSERVATION: 'MetadataObservation', RESOLVED_METADATA: 'ResolvedMetadata', METADATA_ARTIFACT: 'MetadataArtifact',
  ARTIFACT_MANIFEST: 'ArtifactManifest', STAGED_MEDIA_ASSET: 'StagedMediaAsset', VERIFIED_MEDIA_ASSET: 'VerifiedMediaAsset',
  REPLACEMENT_EVIDENCE: 'MediaReplacementEvidence', SOURCE_MUTATION: 'SourceMutationEffect',
  ARTIFACT_MATERIALIZATION: 'ArtifactMaterialization', LAYOUT_VERIFICATION: 'LayoutVerification',
  UPGRADE_CANDIDATES: 'UpgradeCandidates', UPGRADE_REQUEST: 'UpgradeRequest', DOWNLOAD_OBSERVATION: 'DownloadObservation',
  TRANSFER_OBSERVATION: 'TransferObservation', OPTIMIZE_PUBLICATION: 'OptimizePublication',
  OBJECTIVE_VERIFICATION: 'ObjectiveVerification',
  FRAME_SET: 'FrameSet', FACE_EMBEDDING_SET: 'FaceEmbeddingSet', FACE_CLUSTER_SET: 'FaceClusterSet', PERSON_MATCH_SET: 'PersonMatchSet',
  WESTERN_PRESENTATION: 'WesternPresentation', COMPUTE_ASSET: 'ComputeAsset', UPLOADED_COMPUTE_ASSET: 'UploadedComputeAsset',
  ADULT_ANALYSIS_JOB: 'AdultAnalysisJob', ADULT_ANALYSIS_RESULT: 'AdultAnalysisResult',
  TRANSCODE_PRECHECK: 'TranscodePrecheck', CLEANUP_EVIDENCE: 'CleanupEvidence',
  IDENTITY_INSPECTION: 'IdentityInspection',
  INTEGRATION_EVIDENCE: 'IntegrationEvidence', UPGRADE_IDENTITY: 'UpgradeIdentity',
});

const CATALOG = Object.freeze({
  'workflow.blocked': def({}, TYPES.NONE),
  'emby.item.observe': def({}, TYPES.SOURCE_OBSERVATION, 'pure', resource('emby')),
  'filesystem.media.probe': def({}, TYPES.SOURCE_OBSERVATION, 'pure', resource('filesystem')),
  'filesystem.layout.observe': def({}, TYPES.LAYOUT_OBSERVATION, 'pure', resource('filesystem')),
  'basedata.verify': def({ observation: port(TYPES.SOURCE_OBSERVATION), layout: port(TYPES.LAYOUT_OBSERVATION, { optional: true }) }, TYPES.VERIFIED_BASEDATA),
  'basedata.publish': def({ basedata: port(TYPES.VERIFIED_BASEDATA) }, TYPES.BASEDATA_PUBLICATION, 'commit_once'),
  'media.identity.resolve': def({}, TYPES.MEDIA_IDENTITY),
  'metadata.provider.fetch': def({ identity: port(TYPES.MEDIA_IDENTITY) }, TYPES.METADATA_OBSERVATION, 'pure', resource('emby', 'scraper')),
  'media.frames.extract': def({ identity: port(TYPES.MEDIA_IDENTITY) }, TYPES.FRAME_SET, 'staged_write', resource('transcode')),
  'person.faces.embed': def({ frames: port(TYPES.FRAME_SET) }, TYPES.FACE_EMBEDDING_SET, 'pure', resource('ai')),
  'person.faces.cluster': def({ embeddings: port(TYPES.FACE_EMBEDDING_SET) }, TYPES.FACE_CLUSTER_SET),
  'person.faces.match': def({ clusters: port(TYPES.FACE_CLUSTER_SET) }, TYPES.PERSON_MATCH_SET),
  'metadata.poster.compose': def({ people: port(TYPES.PERSON_MATCH_SET) }, TYPES.WESTERN_PRESENTATION, 'staged_write', resource('filesystem')),
  'adult.metadata.compose': def({ presentation: port(TYPES.WESTERN_PRESENTATION) }, TYPES.METADATA_OBSERVATION),
  'compute.asset.register': def({ identity: port(TYPES.MEDIA_IDENTITY) }, TYPES.COMPUTE_ASSET, 'commit_once', resource('worker')),
  'compute.asset.upload': def({ asset: port(TYPES.COMPUTE_ASSET) }, TYPES.UPLOADED_COMPUTE_ASSET, 'staged_write', resource('worker')),
  'adult.analysis.request': def({ asset: port(TYPES.UPLOADED_COMPUTE_ASSET) }, TYPES.ADULT_ANALYSIS_JOB, 'commit_once', resource('worker')),
  'adult.analysis.observe': def({ job: port(TYPES.ADULT_ANALYSIS_JOB) }, TYPES.ADULT_ANALYSIS_RESULT, 'pure', resource('worker')),
  'adult.metadata.normalize': def({ analysis: port(TYPES.ADULT_ANALYSIS_RESULT) }, TYPES.METADATA_OBSERVATION),
  'person.relations.resolve': def({ metadata: port(TYPES.METADATA_OBSERVATION) }, TYPES.RESOLVED_METADATA, 'commit_once'),
  'metadata.sidecar.render': def({ metadata: port(TYPES.RESOLVED_METADATA) }, TYPES.METADATA_ARTIFACT, 'staged_write', resource('filesystem')),
  'metadata.image.acquire': def({ metadata: port(TYPES.RESOLVED_METADATA) }, TYPES.METADATA_ARTIFACT, 'staged_write', { ...resource('filesystem'), parameters: { kind: { type: 'enum', values: ['poster', 'fanart'] } } }),
  'metadata.artifacts.verify': def({ artifacts: port(TYPES.METADATA_ARTIFACT, { many: true }) }, TYPES.ARTIFACT_MANIFEST),
  'metadata.publish': def({ metadata: port(TYPES.RESOLVED_METADATA), artifacts: port(TYPES.ARTIFACT_MANIFEST, { optional: true }) }, TYPES.METADATA_PUBLICATION, 'commit_once'),
  'container.remux': def({}, TYPES.STAGED_MEDIA_ASSET, 'staged_write', resource('transcode')),
  'media.transcode.precheck': def({ sourceAsset: port(TYPES.STAGED_MEDIA_ASSET, { optional: true }) }, TYPES.TRANSCODE_PRECHECK, 'pure', resource('transcode')),
  'transcode.tonemap.accept': def({ precheck: port(TYPES.TRANSCODE_PRECHECK) }, TYPES.TRANSCODE_PRECHECK, 'pure', { approvalActions: ['transcode.dolbyVisionTonemap'] }),
  'media.transcode': def({ precheck: port(TYPES.TRANSCODE_PRECHECK), previousAttempt: port(TYPES.VERIFIED_MEDIA_ASSET, { optional: true }) }, TYPES.STAGED_MEDIA_ASSET, 'staged_write', { ...resource('transcode'), parameters: { strategy: { type: 'enum', values: ['nvenc_vbr', 'qsv_vbr', 'qsv_cbr', 'amf_vbr', 'cpu_two_pass_abr', 'cpu_strict_fallback'] }, encoderKind: { type: 'enum', values: ['nvenc', 'qsv', 'amf', 'cpu'] } } }),
  'output.preview.generate': def({ verifiedAsset: port(TYPES.VERIFIED_MEDIA_ASSET) }, TYPES.VERIFIED_MEDIA_ASSET, 'staged_write', resource('transcode')),
  'integration.moviepilot.check': def({}, TYPES.INTEGRATION_EVIDENCE, 'pure', resource('moviepilot')),
  'media.upgrade.identity.resolve': def({ integration: port(TYPES.INTEGRATION_EVIDENCE) }, TYPES.UPGRADE_IDENTITY, 'pure', resource('moviepilot')),
  'source.upgrade.search': def({ identity: port(TYPES.UPGRADE_IDENTITY) }, TYPES.UPGRADE_CANDIDATES, 'pure', resource('moviepilot')),
  'source.upgrade.request': def({ candidates: port(TYPES.UPGRADE_CANDIDATES) }, TYPES.UPGRADE_REQUEST, 'commit_once', { ...resource('moviepilot'), approvalActions: ['upgrade.candidateSelect'] }),
  'source.upgrade.observe-download': def({ request: port(TYPES.UPGRADE_REQUEST) }, TYPES.DOWNLOAD_OBSERVATION, 'pure', resource('moviepilot')),
  'source.upgrade.observe-transfer': def({ request: port(TYPES.UPGRADE_REQUEST), download: port(TYPES.DOWNLOAD_OBSERVATION) }, TYPES.TRANSFER_OBSERVATION, 'pure', resource('moviepilot')),
  'source.upgrade.output.resolve': def({ transfer: port(TYPES.TRANSFER_OBSERVATION) }, TYPES.STAGED_MEDIA_ASSET, 'pure', resource('filesystem')),
  'source.upgrade.output.settle': def({ stagedAsset: port(TYPES.STAGED_MEDIA_ASSET) }, TYPES.STAGED_MEDIA_ASSET, 'pure', resource('filesystem')),
  'media.identity.inspect': def({ stagedAsset: port(TYPES.STAGED_MEDIA_ASSET) }, TYPES.IDENTITY_INSPECTION, 'pure', resource('filesystem')),
  'media.identity.accept': def({ inspection: port(TYPES.IDENTITY_INSPECTION) }, TYPES.STAGED_MEDIA_ASSET, 'pure', { approvalActions: ['upgrade.identityMismatch'] }),
  'optimization.objective.verify': def({}, TYPES.OBJECTIVE_VERIFICATION),
  'output.media.verify': def({ stagedAsset: port(TYPES.STAGED_MEDIA_ASSET) }, TYPES.VERIFIED_MEDIA_ASSET, 'pure', resource('filesystem')),
  'output.media.select': def({ attempts: port(TYPES.VERIFIED_MEDIA_ASSET, { many: true }) }, TYPES.VERIFIED_MEDIA_ASSET),
  'output.media.disposition': def({ verifiedAsset: port(TYPES.VERIFIED_MEDIA_ASSET) }, TYPES.VERIFIED_MEDIA_ASSET),
  'media.replace': def({ verifiedAsset: port(TYPES.VERIFIED_MEDIA_ASSET) }, TYPES.REPLACEMENT_EVIDENCE, 'commit_once', { ...resource('filesystem'), approvalActions: ['upgrade.beforeReplace', 'transcode.beforeReplace'] }),
  'staged.asset.discard': def({ verifiedAsset: port(TYPES.VERIFIED_MEDIA_ASSET) }, TYPES.REPLACEMENT_EVIDENCE, 'commit_once', resource('filesystem')),
  'workspace.cleanup': def({ replacement: port(TYPES.REPLACEMENT_EVIDENCE) }, TYPES.CLEANUP_EVIDENCE, 'commit_once', resource('filesystem')),
  'optimization.outcome.select': def({ outcomes: port(TYPES.REPLACEMENT_EVIDENCE, { many: true }) }, TYPES.REPLACEMENT_EVIDENCE),
  'source.organize': def({}, TYPES.SOURCE_MUTATION, 'commit_once', { ...resource('filesystem'), approvalActions: ['source.beforeOrganize'] }),
  'metadata.artifacts.materialize': def({}, TYPES.ARTIFACT_MATERIALIZATION, 'commit_once', resource('filesystem')),
  'filesystem.layout.verify': def({ materialization: port(TYPES.ARTIFACT_MATERIALIZATION, { optional: true }) }, TYPES.LAYOUT_VERIFICATION, 'pure', resource('filesystem')),
  'optimization.result.publish': def({ layout: port(TYPES.LAYOUT_VERIFICATION), replacement: port(TYPES.REPLACEMENT_EVIDENCE, { optional: true }) }, TYPES.OPTIMIZE_PUBLICATION, 'commit_once'),
});

function port(type, options = {}) { return { type, version: 1, ...options }; }
function resource(...types) { return { resourceTypes: types }; }
function def(inputContract, outputType, effectKind = 'pure', options = {}) {
  return Object.freeze({
    contractVersion: 1,
    inputContract: Object.freeze(inputContract),
    outputContract: Object.freeze(port(outputType)),
    effectKind,
    resourceContract: Object.freeze({ types: Object.freeze([...(options.resourceTypes || [])]) }),
    approvalContract: Object.freeze({ actions: Object.freeze([...(options.approvalActions || [])]) }),
    fencingContract: Object.freeze({ admission: options.admissionFence !== false }),
    parameterContract: Object.freeze(options.parameters || {}),
  });
}
function get(capability) { return CATALOG[String(capability || '')] || null; }
function apply(definition = {}) {
  const spec = get(definition.capability);
  if (!spec) throw new TypeError(`Capability is missing from the canonical catalog: ${definition.capability || ''}`);
  return { ...definition, ...spec };
}
function list() { return Object.entries(CATALOG).map(([capability, definition]) => ({ capability, ...definition })); }

module.exports = { TYPES, get, apply, list };
