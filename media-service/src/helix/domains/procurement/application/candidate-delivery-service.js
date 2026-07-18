'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { ACCEPTANCE_BASIS_SCHEMA, OFFER_MESSAGE_SCHEMA, PACKAGE_SCHEMA, buildAcceptanceBasis, buildOffer } =
  require('../model/candidate-publication-contracts');

class CandidateDeliveryServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CandidateDeliveryServiceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CandidateDeliveryServiceError(code, message, details);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  }
  return value;
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function createCandidateDeliveryService(options) {
  if (!options || !options.candidatePackageReader || typeof options.candidatePackageReader.getCandidatePackage !== 'function' ||
      !options.contractValidator || typeof options.contractValidator.validate !== 'function') {
    fail('P7_CANDIDATE_DELIVERY_DEPENDENCIES', 'A read-only Candidate Package reader and contract validator are required.');
  }
  return Object.freeze({
    deliverCandidatePackage(message) {
      options.contractValidator.validate(OFFER_MESSAGE_SCHEMA, message);
      if (!message || message.schemaRef !== OFFER_MESSAGE_SCHEMA || message.schemaVersion !== 1 ||
          message.messageKind !== 'procurement_candidate_offer_available' || message.acceptanceOwnerDomain !== 'libra' ||
          message.targetContext !== 'libra_intake') {
        fail('P7_CANDIDATE_OFFER_INVALID', 'Candidate Delivery accepts only the frozen Libra Intake Offer message.');
      }
      const source = options.candidatePackageReader.getCandidatePackage(Object.freeze({
        candidatePackageId:message.candidatePackageId,
        packageRevision:message.packageRevision,
        packageDigest:message.packageDigest
      }));
      if (!source) fail('P7_CANDIDATE_PACKAGE_NOT_FOUND', 'The immutable Candidate Package was not found.');
      const candidatePackage = freeze(JSON.parse(canonicalJson(source)));
      options.contractValidator.validate(PACKAGE_SCHEMA, candidatePackage);
      const digest = canonicalDigest(Object.fromEntries(Object.entries(candidatePackage)
        .filter(([key]) => !['manifestDigest','packageDigest'].includes(key))));
      if (candidatePackage.schemaRef !== PACKAGE_SCHEMA || candidatePackage.candidatePackageId !== message.candidatePackageId ||
          candidatePackage.packageRevision !== message.packageRevision || candidatePackage.packageDigest !== message.packageDigest ||
          candidatePackage.manifestDigest !== candidatePackage.packageDigest || digest !== candidatePackage.packageDigest) {
        fail('P7_CANDIDATE_PACKAGE_MISMATCH', 'Candidate Package does not match the exact immutable Offer reference.');
      }
      const acceptanceBasis = buildAcceptanceBasis(candidatePackage);
      options.contractValidator.validate(ACCEPTANCE_BASIS_SCHEMA, acceptanceBasis);
      const offer = buildOffer(candidatePackage, acceptanceBasis);
      if (!same(offer.message, message)) {
        fail('P7_CANDIDATE_OFFER_MISMATCH', 'Offer identity or Acceptance Basis does not derive from the delivered Package.');
      }
      return candidatePackage;
    }
  });
}

module.exports = Object.freeze({ CandidateDeliveryServiceError, createCandidateDeliveryService });
