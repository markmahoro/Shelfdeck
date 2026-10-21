'use strict';

// Construction-only owner-local adapter.  It is deliberately separate from
// the three frozen cross-domain Procurement ports exported by index.js.
const { createProcurementAdminApplication } = require('../application/admin-facade');

function createMaterialExclusionCommandPort({materialFieldStore}) {
  return Object.freeze({excludeSourceMaterials:request=>materialFieldStore.excludeSourceMaterials(request),
    validateSourceExclusions:request=>materialFieldStore.validateSourceExclusions(request)});
}
module.exports = Object.freeze({ createProcurementAdminApplication,createMaterialExclusionCommandPort });
