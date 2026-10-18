'use strict';

const LIBRARY_KINDS = Object.freeze(['normal', 'jav', 'us_adult']);
const PROFILE_LIBRARIES = Object.freeze({ movie: 'normal', series: 'normal', jav: 'jav', western_adult: 'us_adult' });

function requireLibraryKind(value) {
  if (!LIBRARY_KINDS.includes(value)) {
    throw Object.assign(new TypeError('An explicit Person library is required.'), { code: 'PEOPLE_LIBRARY_INVALID' });
  }
  return value;
}

function libraryForProfile(profile) {
  if (!Object.hasOwn(PROFILE_LIBRARIES, profile)) {
    throw Object.assign(new TypeError('A supported content profile is required for Person evidence.'), {
      code: 'PEOPLE_EVIDENCE_PROFILE_INVALID',
    });
  }
  return PROFILE_LIBRARIES[profile];
}

function requireSameLibrary(left, right) {
  if (requireLibraryKind(left.libraryKind) !== requireLibraryKind(right.libraryKind)) {
    throw Object.assign(new Error('Person identities from different libraries cannot be merged.'), {
      code: 'PEOPLE_CROSS_LIBRARY_MERGE_FORBIDDEN',
    });
  }
  if (left.libraryKind === 'us_adult') {
    throw Object.assign(new Error('US Adult Person merge is unavailable.'), { code: 'PEOPLE_US_ADULT_MERGE_FORBIDDEN' });
  }
}

module.exports = Object.freeze({ LIBRARY_KINDS, requireLibraryKind, libraryForProfile, requireSameLibrary });
