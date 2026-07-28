'use strict';

const JAV_CODE = /^[A-Z0-9]{2,16}-[0-9]{2,8}$/;
const JSON_LIMIT = 128 * 1024;

function normalizeThePornDbJavCode(value, fail) {
  const code = String(value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase();
  if (!JAV_CODE.test(code)) {
    fail(
      'P5_PROVIDER_INPUT_INVALID',
      'ThePornDB JAV code is invalid.',
    );
  }
  return code;
}

function createThePornDbRestClient(options) {
  if (typeof options?.fetchImpl !== 'function' ||
      typeof options.fetchJson !== 'function' ||
      typeof options.fail !== 'function' ||
      typeof options.endpoint !== 'string' ||
      typeof options.authorization !== 'string' ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1) {
    throw new TypeError('ThePornDB REST client input is invalid.');
  }
  const fail = options.fail;

  function reject(code, message) {
    fail(code, message);
    throw new Error('ThePornDB failure handler must throw.');
  }

  function object(value, message) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      reject('P5_PROVIDER_RESPONSE_INVALID', message);
    }
    return value;
  }

  function boundedString(value, maximum, optional = false) {
    if (optional && (value === undefined || value === null)) return null;
    if (typeof value !== 'string' ||
        (!optional && value.length < 1) ||
        Buffer.byteLength(value, 'utf8') > maximum) {
      reject(
        'P5_PROVIDER_RESPONSE_INVALID',
        'ThePornDB response string exceeds its bound.',
      );
    }
    return value;
  }

  function normalizedCode(value) {
    return normalizeThePornDbJavCode(value, reject);
  }

  function boundedArray(value, maximum, name) {
    if (!Array.isArray(value) || value.length > maximum) {
      reject(
        'P5_PROVIDER_RESPONSE_INVALID',
        'ThePornDB ' + name + ' exceeds its bound.',
      );
    }
    return value;
  }

  function nestedUrl(value, key) {
    if (typeof value?.[key] === 'string' && value[key]) {
      return value[key];
    }
    return null;
  }

  function projectScene(value) {
    const scene = object(value, 'ThePornDB SceneResource is invalid.');
    const id = boundedString(String(scene.id || ''), 256);
    const sku = normalizedCode(scene.sku);
    const title = boundedString(scene.title, 2048);
    const date = boundedString(scene.date, 64, true);
    const description = boundedString(
      scene.description,
      32 * 1024,
      true,
    );
    const tags = boundedArray(scene.tags || [], 64, 'tag collection')
      .map((item) => {
        object(item, 'ThePornDB tag is invalid.');
        return boundedString(item.name, 512);
      });
    const performers = boundedArray(
      scene.performers || [],
      256,
      'performer collection',
    ).map((item) => {
      object(item, 'ThePornDB performer is invalid.');
      return Object.freeze({
        id: boundedString(String(item.id || item.uuid || ''), 256),
        name: boundedString(item.name, 512),
      });
    });
    let studio = null;
    if (scene.site !== undefined && scene.site !== null) {
      object(scene.site, 'ThePornDB site is invalid.');
      studio = boundedString(scene.site.name, 512);
    }
    const posters = scene.posters === undefined ||
      scene.posters === null
      ? null
      : object(scene.posters, 'ThePornDB poster projection is invalid.');
    const background = scene.background === undefined ||
      scene.background === null
      ? null
      : object(
          scene.background,
          'ThePornDB background projection is invalid.',
        );
    return Object.freeze({
      id,
      sku,
      title,
      date,
      description,
      studio,
      tags: Object.freeze(tags),
      performers: Object.freeze(performers),
      posterUrl: nestedUrl(posters, 'full') ||
        boundedString(scene.poster || scene.poster_image, 4096, true),
      fanartUrl: nestedUrl(background, 'full') ||
        boundedString(scene.back_image || scene.image, 4096, true),
    });
  }

  function endpointUrl(relative) {
    return new URL(
      String(relative).replace(/^\//, ''),
      options.endpoint.replace(/\/+$/, '') + '/',
    );
  }

  async function request(url) {
    return options.fetchJson(
      options.fetchImpl,
      url,
      {
        headers: {
          accept: 'application/json',
          authorization: options.authorization,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs),
      },
      JSON_LIMIT,
    );
  }

  async function searchExactJav(inputCode) {
    const code = normalizedCode(inputCode);
    const url = endpointUrl('jav');
    url.searchParams.set('q', code);
    url.searchParams.set('per_page', '2');
    const root = object(
      await request(url),
      'ThePornDB JAV search response is invalid.',
    );
    const matches = boundedArray(root.data, 2, 'JAV search result')
      .map(projectScene)
      .filter((scene) => scene.sku === code);
    if (matches.length !== 1) {
      reject(
        'P5_PROVIDER_IDENTITY_UNRESOLVED',
        'ThePornDB did not return one exact JAV code match.',
      );
    }
    return matches[0];
  }

  async function readExactJav(inputCode) {
    const code = normalizedCode(inputCode);
    const searched = await searchExactJav(code);
    const root = object(
      await request(
        endpointUrl('jav/' + encodeURIComponent(searched.id)),
      ),
      'ThePornDB JAV metadata response is invalid.',
    );
    const exact = projectScene(root.data);
    if (exact.id !== searched.id || exact.sku !== code) {
      reject(
        'P5_PROVIDER_IDENTITY_MISMATCH',
        'ThePornDB exact result differs from search identity.',
      );
    }
    return exact;
  }

  return Object.freeze({
    normalizedCode,
    readExactJav,
    searchExactJav,
  });
}

module.exports = Object.freeze({
  createThePornDbRestClient,
  normalizeThePornDbJavCode,
});
