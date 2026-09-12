'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

// This is the immutable Handoff B requirement snapshot, not a replay of today's
// rating branches. Arca binds the historical read to its accepted Custody.
function acceptedProductRequirements(reference, delivery, manifest) {
  if (!reference || !delivery || delivery.resultKind !== 'found') return null;
  const snapshot = delivery.acceptanceRequirementSnapshot;
  const body = snapshot && Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'snapshotDigest'));
  if (delivery.onDeckPackageId !== reference.onDeckPackageId ||
      delivery.packageDigest !== reference.expectedPackageDigest ||
      delivery.shelfId !== reference.shelfId || delivery.libraRunId !== manifest?.libraRunId ||
      delivery.authorizedDefectManifestDigest !== manifest?.manifestDigest ||
      snapshot?.schemaRef !== 'helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1' ||
      snapshot.schemaVersion !== 1 || snapshot.snapshotDigest !== canonicalDigest(body) ||
      snapshot.targetShelfId !== reference.shelfId || !snapshot.requirements) {
    throw Object.assign(new Error('Accepted Product requirements do not match the exact Arca Custody.'),
      { code: 'ARCA_ACCEPTED_REQUIREMENTS_INVALID' });
  }
  return Object.freeze(snapshot.requirements);
}

module.exports = Object.freeze({ acceptedProductRequirements });
