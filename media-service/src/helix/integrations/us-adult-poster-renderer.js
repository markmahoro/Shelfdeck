'use strict';

const sharp = require('sharp');
const { US_ADULT_PRESENTATION_VERSION } = require('../contracts/us-adult-presentation');

const WIDTH = 1000, HEIGHT = 1500;
const BACKGROUND = '#f3f0e9';
const GRID = Object.freeze([{ left: 40, top: 210 }, { left: 510, top: 210 }, { left: 40, top: 750 }, { left: 510, top: 750 }]);
const CELL_WIDTH = 450, CELL_HEIGHT = 510;
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

async function image(bytes, width, height) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 16 * 1024 * 1024) {
    throw Object.assign(new TypeError('Poster composition requires bounded image bytes.'), { code: 'US_ADULT_POSTER_IMAGE_INVALID' });
  }
  return sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 }).rotate()
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .flatten({ background: BACKGROUND }).png({ compressionLevel: 1 }).toBuffer();
}

async function renderUsAdultPoster({ actorName, originalTitle, portrait, frames }) {
  if (typeof actorName !== 'string' || !actorName.trim() || typeof originalTitle !== 'string' || !originalTitle.trim() ||
      actorName.length > 1024 || originalTitle.length > 4096 || !Array.isArray(frames) || frames.length !== 4) {
    throw Object.assign(new TypeError('The poster requires an actor, original title, portrait and four frames.'), { code: 'US_ADULT_POSTER_INPUT_INVALID' });
  }
  const [portraitBytes, thumbnails, names, titles, divider] = await Promise.all([
    image(portrait, 76, 100),
    Promise.all(frames.map(bytes => image(bytes, CELL_WIDTH, CELL_HEIGHT))),
    fitPosterText(actorName, { width: 920, height: 124, font: 'sans bold 64', color: '#292b29' }),
    fitPosterText(originalTitle, { width: 800, height: 108, font: 'sans 27', color: '#706d65' }),
    sharp({ create: { width: 920, height: 1, channels: 3, background: '#d4d0c7' } }).png().toBuffer()
  ]);
  const bytes = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: BACKGROUND } })
    .composite([{ input: names.bytes, left: 40, top: 46 },
      ...thumbnails.map((input, index) => ({ input, ...GRID[index] })),
      { input: divider, left: 40, top: 1308 }, { input: titles.bytes, left: 40, top: 1340 },
      { input: portraitBytes, left: 884, top: 1340 }]).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  return Object.freeze({ version: US_ADULT_PRESENTATION_VERSION, width: WIDTH, height: HEIGHT, bytes });
}

module.exports = Object.freeze({ renderUsAdultPoster, fitPosterText });
