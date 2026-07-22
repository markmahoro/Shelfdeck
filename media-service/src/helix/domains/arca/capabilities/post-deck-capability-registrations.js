'use strict';
const CAPABILITIES=Object.freeze([
  'arca.aftercare.case.commit@1','arca.aftercare.conformance.observe@1','arca.aftercare.custody.observe@1','arca.aftercare.presentation.observe@1','arca.aftercare.assessment.commit@1','arca.aftercare.artifact.materialize@1','arca.aftercare.binary_artifact.acquire@1','arca.aftercare.text_artifact.render@1','arca.aftercare.media.verify@1','arca.aftercare.media.remux@1','arca.aftercare.media.transcode@1','arca.aftercare.inventory.commit@1','arca.aftercare.input_settlement.delete@1','arca.aftercare.workspace.reclaim@1',
  'arca.offdeck.duplicate.detect@1','arca.offdeck.duplicate_group.commit@1','arca.offdeck.review_candidate.commit@1','arca.offdeck.destruction_scope.verify@1','arca.offdeck.primary_material.delete@1','arca.offdeck.related_reference.release@1','arca.offdeck.unreferenced_related.delete@1','arca.offdeck.deletion.verify@1','arca.offdeck.terminal.commit@1',
  'arca.shelf_deregistration.release_manifest.verify@1','arca.shelf_deregistration.commit@1'
]);
const registrations=()=>CAPABILITIES.map((capabilityRef)=>Object.freeze({capabilityRef,ownerScope:'arca',inputMode:'typed_only',storeAccess:'owner_repository_only'}));
module.exports=Object.freeze({CAPABILITIES,registrations});

