'use strict';

const sharp = require('sharp');
const { US_ADULT_PRESENTATION_VERSION } = require('../contracts/us-adult-presentation');

const WIDTH = 1000, HEIGHT = 1500;
const GRID = Object.freeze([{ left: 28, top: 540 }, { left: 514, top: 540 }, { left: 28, top: 1012 }, { left: 514, top: 1012 }]);
const CELL_WIDTH = 458, CELL_HEIGHT = 460;
const escapeXml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

function lines(value, maximum, count) {
  const result = [], characters = Array.from(value);
  while (characters.length && result.length < count) result.push(characters.splice(0, maximum).join(''));
  if (characters.length) result[result.length - 1] = result.at(-1).slice(0, -1) + '…';
  return result;
}

async function image(bytes, width, height, fit) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 16 * 1024 * 1024) {
    throw Object.assign(new TypeError('Poster composition requires bounded image bytes.'), { code: 'US_ADULT_POSTER_IMAGE_INVALID' });
  }
  return sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 }).rotate().resize(width, height, { fit, background: '#111827' }).jpeg({ quality: 92 }).toBuffer();
}

async function renderUsAdultPoster({ actorName, originalTitle, portrait, frames }) {
  if (typeof actorName !== 'string' || !actorName.trim() || typeof originalTitle !== 'string' || !originalTitle.trim() ||
      actorName.length > 1024 || originalTitle.length > 4096 || !Array.isArray(frames) || frames.length !== 4) {
    throw Object.assign(new TypeError('The poster requires an actor, original title, portrait and four frames.'), { code: 'US_ADULT_POSTER_INPUT_INVALID' });
  }
  const portraitBytes = await image(portrait, 250, 330, 'cover');
  const thumbnails = await Promise.all(frames.map(bytes => image(bytes, CELL_WIDTH, CELL_HEIGHT, 'contain')));
  const names = lines(actorName, 19, 2).map((line, i) => `<text x="316" y="${120 + i * 64}" font-size="52" font-weight="700">${escapeXml(line)}</text>`).join('');
  const titles = lines(originalTitle, 44, 3).map((line, i) => `<text x="32" y="${398 + i * 38}" font-size="30" fill="#cbd5e1">${escapeXml(line)}</text>`).join('');
  const text = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><g font-family="sans-serif" fill="#f8fafc">${names}${titles}</g></svg>`);
  const bytes = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#0b1120' } })
    .composite([{ input: portraitBytes, left: 32, top: 28 }, { input: text, left: 0, top: 0 },
      ...thumbnails.map((input, index) => ({ input, ...GRID[index] }))]).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  return Object.freeze({ version: US_ADULT_PRESENTATION_VERSION, width: WIDTH, height: HEIGHT, bytes });
}

module.exports = Object.freeze({ renderUsAdultPoster });
