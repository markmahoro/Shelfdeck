'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

function identityCommitFence(workId, eventId) {
  return canonicalDigest({
    schema: 'libra.product-identity-domain-fence@1',
    workId,
    eventId,
  });
}

function factCommitFence(workId, eventId, factKind) {
  return canonicalDigest({
    schema: 'libra.product-fact-event-fence@1',
    workId,
    eventId,
    factKind,
  });
}

module.exports = Object.freeze({ factCommitFence, identityCommitFence });
