'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('../contracts/us-adult-face-model-pack.json');

function fail(code, message, details) { throw Object.assign(new Error(message), { code, details }); }

function verifyModelPack(modelRoot, licenseRoot = path.resolve(__dirname, '../../../resources/face-models')) {
  for (const license of manifest.licenses) {
    const file = path.join(licenseRoot, license.file), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== license.sha256) {
      fail('FACE_MODEL_LICENSE_INVALID', 'The local face model license does not match the pinned distribution.');
    }
  }
  return Object.fromEntries(manifest.models.map(model => {
    const file = path.join(modelRoot, model.file);
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) {
      if (error.code === 'ENOENT') fail('FACE_MODEL_PACK_MISSING', 'The pinned local face model pack is not installed.', { model: model.role });
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== model.size ||
        createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== model.sha256) {
      fail('FACE_MODEL_PACK_INVALID', 'The local face model does not match its pinned checksum.', { model: model.role });
    }
    return [model.role, file];
  }));
}

module.exports = Object.freeze({ verifyModelPack });
