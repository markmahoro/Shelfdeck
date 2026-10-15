'use strict';
function createReadonlyProofProjectionRegistry(load) {
  const roots='src/helix/domains/',registrations=[],deny=()=>{throw new Error('Readonly Catalog proof cannot execute a projection or Owner IO.');},
    options={materialControlProjectionPort:{getMaterialControlProjections:deny},
      movieProductionReader:{readRun:deny,readRunSnapshot:deny},productProductionPort:{issuePhysicalReadHandle:deny},
      controlScopeDigest:load('src/helix/foundation/persistence/material-control.js').controlScopeDigest};
  for(const [file,names] of [
    ['arca/planning/on-deck-projections.js',['createOnDeckProjections']],
    ['arca/planning/aftercare-projections.js',['createAftercareProjections']],
    ['arca/planning/offdeck-automation-projections.js',['createOffdeckAutomationProjections']],
    ['arca/planning/offdeck-projections.js',['createOffdeckProjections']],
    ['arca/planning/shelf-deregistration-projections.js',['createShelfDeregistrationProjections']],
    ['libra/planning/intake-planners.js',['createIntakeProjections']],
    ['libra/planning/routing-planners.js',['createRoutingProjections']],
    ['libra/planning/acceptance-spec-planner.js',['createAcceptanceSpecProjections']],
    ['libra/planning/libra-production-planners.js',['createProductIdentityProjections','createProductMetadataObservationProjections','createArtifactProductionProjections','createProductFactAssemblyProjections']],
    ['libra/planning/media-production-planner.js',['createWorkspaceMediaProductionProjections']],
    ['libra/planning/external-material-planner.js',['createExternalMaterialProjections']],
    ['libra/planning/product-delivery-planner.js',['createProductDeliveryProjections']],
    ['perception/planning/perception-planners.js',['createPerceptionProjections']],
  ])for(const name of names)registrations.push(...load(roots+file)[name](options));
  const evidence=load(roots+'procurement/planning/evidence-assessment-planner.js'),candidate=load(roots+'procurement/planning/candidate-assembly-planner.js');
  for(const [module,ref,factory] of [
    [evidence,'PROBE_BATCH_PROJECTION','createProbeBatchProjection'],[evidence,'BDMV_ASSESS_INPUT_PROJECTION','createBdmvAssessmentInputProjection'],
    [evidence,'STRUCTURE_INPUT_PROJECTION','createStructureInputProjection'],[candidate,'IDENTITY_INPUT_PROJECTION','createCandidateIdentityInputProjection'],
    [candidate,'MANIFEST_INPUT_PROJECTION','createCandidateManifestInputProjection'],[candidate,'DRAFT_PROJECTION','createCandidateDraftProjection'],
    [candidate,'COMMIT_HANDLE_PROJECTION','createCandidateCommitHandleProjection'],
  ])registrations.push({projectionRef:module[ref],projection:module[factory]({})});
  const actual=load('src/helix/foundation/execution/input-binding-projection-registry.js').createInputBindingProjectionRegistry({registrations});
  // Resolve only. No historical input projection may execute against live data.
  return {registry:Object.freeze({resolve(ref){actual.resolve(ref);return Object.freeze({});}}),registrationCount:registrations.length};
}
module.exports={createReadonlyProofProjectionRegistry};
