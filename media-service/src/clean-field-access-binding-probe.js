'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createPathAuthority } = require('./helix/platform/model/path-authority');

class CleanFieldAccessProbeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanFieldAccessProbeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanFieldAccessProbeError(code, message, details);
}

function text(value, field, maximum = 4096) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail('FIELD_ACCESS_FIELD_REQUIRED', 'Field Access Binding field is invalid.', { field });
  }
  return value;
}

function directoryList(value, field) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail('FIELD_ACCESS_FIELD_REQUIRED', 'Field Access Binding field is invalid.', { field });
  }
  return value;
}

function createCleanFieldAccessBindingProbe(options = {}) {
  const fsApi = options.fsApi || fs;
  const pathApi = options.pathApi || path;
  const authority = createPathAuthority(pathApi);

  function inspect(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      fail('FIELD_ACCESS_PROBE_INPUT', 'Field Access Binding probe input does not match its closed contract.');
    }
    const fieldId = text(request.fieldId, 'fieldId', 256);
    const requestedRoot = text(request.rootLocation, 'rootLocation');
    const includedDirectories = directoryList(request.includedDirectories, 'includedDirectories');
    const excludedDirectories = directoryList(request.excludedDirectories, 'excludedDirectories');
    if (!pathApi.isAbsolute(requestedRoot)) {
      fail(
        'FIELD_ACCESS_ROOT_ABSOLUTE',
        '电影目录必须是本机绝对路径。',
        { fieldId, rootLocation: requestedRoot },
      );
    }

    let resolvedRoot;
    try {
      const realpath = fsApi.realpathSync.native || fsApi.realpathSync;
      resolvedRoot = pathApi.normalize(realpath(requestedRoot));
      const stat = fsApi.statSync(resolvedRoot);
      if (!stat.isDirectory()) {
        fail(
          'FIELD_ACCESS_ROOT_NOT_DIRECTORY',
          '电影目录必须是一个文件夹。',
          { fieldId, rootLocation: requestedRoot },
        );
      }
      fsApi.accessSync(resolvedRoot, fs.constants.R_OK);
    } catch (error) {
      if (error instanceof CleanFieldAccessProbeError) throw error;
      fail(
        'FIELD_ACCESS_ROOT_UNAVAILABLE',
        '电影目录不存在或当前不可读取。',
        { fieldId, rootLocation: requestedRoot, causeCode: error.code || 'FIELD_ACCESS_PROBE_FAILED' },
      );
    }

    try {
      for (const relative of [...includedDirectories, ...excludedDirectories]) {
        authority.resolveContained(resolvedRoot, relative.replace(/\\/g, '/'));
      }
    } catch (error) {
      fail(
        'FIELD_ACCESS_PATH_CONTAINMENT',
        '包含或排除的子目录必须位于电影目录之内。',
        { fieldId, rootLocation: requestedRoot, causeCode: error.code || 'FIELD_ACCESS_CONTAINMENT_FAILED' },
      );
    }

    return Object.freeze({
      fieldId,
      rootLocation: resolvedRoot,
      directoryReadable: true,
    });
  }

  return Object.freeze({ inspect });
}

module.exports = Object.freeze({
  CleanFieldAccessProbeError,
  createCleanFieldAccessBindingProbe,
});
