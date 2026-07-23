'use strict';

// Construction-only owner-local adapter.  It is deliberately separate from
// the three frozen cross-domain Procurement ports exported by index.js.
const { createProcurementAdminApplication } = require('../application/admin-facade');

module.exports = Object.freeze({ createProcurementAdminApplication });
