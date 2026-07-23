'use strict';
const { createArcaShelfAdminApplication } = require('../application/shelf-admin-facade');
const {
  createArcaRuleTemplateAdminApplication,
} = require('../application/rule-template-admin-facade');

module.exports = Object.freeze({
  createArcaRuleTemplateAdminApplication,
  createArcaShelfAdminApplication,
});
