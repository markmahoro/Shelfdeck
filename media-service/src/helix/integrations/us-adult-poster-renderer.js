'use strict';

const sharp = require('sharp');
const { US_ADULT_PRESENTATION_VERSION } = require('../contracts/us-adult-presentation');

const WIDTH = 1000, HEIGHT = 1500;
const GRID = Object.freeze([{ left: 28, top: 540 }, { left: 514, top: 540 }, { left: 28, top: 1012 }, { left: 514, top: 1012 }]);
const CELL_WIDTH = 458, CELL_HEIGHT = 460;
const escapeXml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

async function fitPosterText(value, { width, height, font, color }) {
  const characters = Array.from(value.replace(/\s+/gu, ' ').trim());
  async function render(text) {
    const { data, info } = await sharp({ text: {
      text: '<span foreground="'+color+'">'+escapeXml(text)+'</span>',
      font, dpi: 72, width, wrap: 'word-char', rgba: true
    } }).png().toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height, text };
  }
  const full = await render(characters.join(''));
  if (full.width <= width && full.height <= height) return Object.freeze({ ...full, truncated: false });
  let low = 0, high = characters.length - 1, fitted = await render('…');
  while (low <= high) {
    const middle = Math.floor((low + high) / 2), candidate = await render(characters.slice(0, middle).join('').trimEnd()+'…');
    if (candidate.width <= width && candidate.height <= height) { fitted = candidate; low = middle + 1; }
    else high = middle - 1;
  }
  if (fitted.width > width || fitted.height > height) throw Object.assign(new Error('Poster text cannot fit its declared bounds.'), { code: 'US_ADULT_POSTER_TEXT_INVALID' });
  return Object.freeze({ ...fitted, truncated: true });
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
  const [names, titles] = await Promise.all([
    fitPosterText(actorName, { width: 656, height: 128, font: 'sans bold 52', color: '#f8fafc' }),
    fitPosterText(originalTitle, { width: 936, height: 114, font: 'sans 30', color: '#cbd5e1' })
  ]);
  const bytes = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#0b1120' } })
    .composite([{ input: portraitBytes, left: 32, top: 28 }, { input: names.bytes, left: 316, top: 72 }, { input: titles.bytes, left: 32, top: 372 },
      ...thumbnails.map((input, index) => ({ input, ...GRID[index] }))]).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  return Object.freeze({ version: US_ADULT_PRESENTATION_VERSION, width: WIDTH, height: HEIGHT, bytes });
}

module.exports = Object.freeze({ renderUsAdultPoster, fitPosterText });
