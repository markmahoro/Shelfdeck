'use strict';

const crypto = require('node:crypto');
const {
  requireIntegrationProfile,
} = require('../application/integration-profile-catalog');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomUUID() {
  return crypto.randomUUID();
}

module.exports = Object.freeze({
  randomUUID,
  requireIntegrationProfile,
  sha256,
});
