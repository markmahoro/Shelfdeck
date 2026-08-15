'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { computeBoundedMaterialFingerprintSync } = require('./helix/integrations/bounded-material-fingerprint');

class CleanOffdeckDeletionPortError extends Error {
  constructor(code, message) { super(message); this.name = 'CleanOffdeckDeletionPortError'; this.code = code; }
}
const fail = (code, message) => { throw new CleanOffdeckDeletionPortError(code, message); };

function createCleanOffdeckDeletionPort(options = {}) {
  const afterPhysicalEffect = options.afterPhysicalEffect || (() => {});
  function resolve(request) {
    const root = path.resolve(request.shelfTargetRoot || '');
    const target = path.resolve(root, request.materialHandle.location);
    const relative = path.relative(root, target);
    if (!root || relative.startsWith('..') || path.isAbsolute(relative)) {
      fail('ARCA_OFFDECK_DELETE_CONTAINMENT_INVALID', 'Authorized material escaped its Shelf Target.');
    }
    return { root, target };
  }
  function inspect(request) {
    const handle = request?.materialHandle;
    if (!handle || handle.schemaRef !== 'helix://contracts/types/PhysicalMaterialReadHandle/v1') {
      fail('ARCA_OFFDECK_SCOPE_HANDLE_INVALID', 'Off-deck scope inspection requires the exact material handle.');
    }
    const { root, target } = resolve(request);
    let rootStat;
    try {
      rootStat = fs.statSync(root);
      fs.accessSync(root, fs.constants.R_OK);
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM', 'ENOTCONN', 'EIO'].includes(error?.code)) {
        return Object.freeze({ disposition:'endpoint_unavailable', reasonCode:'endpoint_unavailable' });
      }
      throw error;
    }
    if (!rootStat.isDirectory()) {
      return Object.freeze({ disposition:'endpoint_unavailable', reasonCode:'endpoint_unavailable' });
    }
    let targetStat;
    try {
      targetStat = fs.lstatSync(target);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return Object.freeze({ disposition:'authorized_identity_already_absent', reasonCode:null });
      }
      if (['EACCES', 'EPERM', 'ENOTCONN', 'EIO'].includes(error?.code)) {
        return Object.freeze({ disposition:'endpoint_unavailable', reasonCode:'endpoint_unavailable' });
      }
      throw error;
    }
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      return Object.freeze({ disposition:'authorized_identity_replaced', reasonCode:'authorized_identity_replaced' });
    }
    let observed;
    try {
      observed = computeBoundedMaterialFingerprintSync(target);
    } catch (error) {
      if (['EACCES', 'EPERM', 'ENOTCONN', 'EIO'].includes(error?.code)) {
        return Object.freeze({ disposition:'endpoint_unavailable', reasonCode:'endpoint_unavailable' });
      }
      if (error?.code === 'ENOENT') {
        return Object.freeze({ disposition:'authorized_identity_already_absent', reasonCode:null });
      }
      throw error;
    }
    const matches = String(observed.stat.ino) === String(handle.identity.inode) &&
      Number(observed.stat.size) === Number(handle.identity.sizeBytes) &&
      observed.contentFingerprint === handle.identity.contentFingerprint;
    return Object.freeze(matches
      ? { disposition:'authorized_identity_present', reasonCode:null }
      : { disposition:'authorized_identity_replaced', reasonCode:'authorized_identity_replaced' });
  }
  function execute(request) {
    const handle = request?.materialHandle, authorization = request?.authorization;
    if (!handle || handle.schemaRef !== 'helix://contracts/types/PhysicalMaterialReadHandle/v1' ||
        !authorization || authorization.schemaRef !== 'helix://contracts/types/AuthorizationHandle/v1' ||
        authorization.authorizationKind !== 'offdeck_destruction' || authorization.ownerDomain !== 'arca') {
      fail('ARCA_OFFDECK_DELETE_AUTHORIZATION_INVALID', 'Off-deck deletion requires the exact material and Authorization handles.');
    }
    const { target } = resolve(request), identityDigest = canonicalDigest(handle.identity), inspection = inspect(request);
    if (inspection.disposition === 'endpoint_unavailable') {
      fail('ARCA_OFFDECK_ENDPOINT_UNAVAILABLE', 'The authorized Shelf Target is temporarily unavailable.');
    }
    if (inspection.disposition === 'authorized_identity_already_absent') {
      return Object.freeze({ disposition:'authorized_identity_already_absent', preDeleteIdentityDigest:identityDigest,
        postDeleteReality:Object.freeze({ absent:true, replacementIdentityPresent:false, location:handle.location }) });
    }
    if (inspection.disposition !== 'authorized_identity_present') {
      fail('ARCA_OFFDECK_AUTHORIZED_IDENTITY_REPLACED', 'The authorized identity is absent but the path now contains a different material.');
    }
    fs.rmSync(target, { force:false });
    afterPhysicalEffect(Object.freeze({ target, materialKey:handle.identity.materialKey, authorizationId:authorization.authorizationId }));
    if (fs.existsSync(target)) fail('ARCA_OFFDECK_DELETE_FAILED', 'Authorized material still exists after deletion.');
    return Object.freeze({ disposition:'deleted', preDeleteIdentityDigest:identityDigest,
      postDeleteReality:Object.freeze({ absent:true, replacementIdentityPresent:false, location:handle.location }) });
  }
  return Object.freeze({ inspect, execute });
}

module.exports = Object.freeze({ CleanOffdeckDeletionPortError, createCleanOffdeckDeletionPort });
