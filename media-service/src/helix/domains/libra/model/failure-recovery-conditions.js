'use strict';

function relevantRecoveryConditions(reasons) {
  const kinds=new Set();
  for(const reason of reasons||[]) {
    const capability=reason.capabilityRef;
    if(['libra.product_metadata.observe@1','libra.product_metadata.fetch@1','libra.product_artifact.acquire@1'].includes(capability))kinds.add('tmdb');
    if(['libra.external_material.search@1','libra.external_material.acquire.request@1','libra.external_material.acquire.observe@1',
      'libra.external_material.package.verify@1','libra.external_material.candidate.select@1'].includes(capability)) {
      kinds.add('moviepilot');kinds.add('media_compute');
    }
    if(['libra.media.transcode@1','libra.product_media.verify@1','libra.product_output.select@1'].includes(capability)&&
        !['playback_decode_failed','probe_not_media','source_unreadable'].includes(reason.failureCode))kinds.add('media_compute');
  }
  return Object.freeze([...kinds].sort());
}
module.exports=Object.freeze({relevantRecoveryConditions});
