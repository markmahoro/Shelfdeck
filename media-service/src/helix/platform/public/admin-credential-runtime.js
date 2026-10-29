'use strict';

const {
  createAdminCredentialRuntime,
} = require('../application/admin-credential-runtime');

module.exports = Object.freeze({ createAdminCredentialRuntime,
  captureResetManagementCredential: require('../application/reset-management-credential').captureResetManagementCredential,
  captureColdResetManagementCredential: require('../application/admin-credential-runtime').captureColdResetManagementCredential,
  createResetManagementCredentialReader: require('../application/reset-management-credential').createResetManagementCredentialReader });
