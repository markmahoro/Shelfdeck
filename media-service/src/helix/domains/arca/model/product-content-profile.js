'use strict';

function packageContentProfile(packageValue) {
  const identity=packageValue?.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||packageValue?.resolvedIdentitySnapshot?.factValue;
  const expected={tmdb_movie:'movie',tmdb_series_season:'series',jav_code:'jav',internal_identity:'western_adult'}[identity?.identityKind];
  if(!expected || identity.contentProfile!==expected || identity.structureKind!==(expected==='series'?'season':'single') ||
      packageValue.productStructureSnapshot?.structureKind!==identity.structureKind)
    throw Object.assign(new TypeError('Package content profile does not conserve its formal Product Identity.'),{code:'ARCA_PACKAGE_CONTENT_PROFILE_INVALID'});
  return expected;
}
function inventoryContentProfile(identity,structureKind) {
  const profile={tmdb_movie:'movie',tmdb_series_season:'series',jav_code:'jav',internal_identity:'western_adult'}[identity?.identity_kind];
  if(!profile || structureKind!==(profile==='series'?'season':'single'))
    throw Object.assign(new TypeError('Inventory content profile requires its canonical identity and structure.'),{code:'ARCA_INVENTORY_CONTENT_PROFILE_INVALID'});
  return profile;
}
module.exports=Object.freeze({packageContentProfile,inventoryContentProfile});
