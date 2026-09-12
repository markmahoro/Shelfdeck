'use strict';

// A Package includes Related Input reads. Only these members transfer
// Material Control into Arca Custody at the Handoff B acceptance boundary.
function handoffBControlMembers(packageValue) {
  return [
    ...packageValue.productMaterialManifest.members.filter(member=>member.controlOperation!=='assert_related_input'),
    ...packageValue.offloadContextManifest.members.filter(member=>member.contextRole!=='related_input'),
  ];
}

module.exports = Object.freeze({ handoffBControlMembers });
