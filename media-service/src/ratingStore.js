'use strict';

const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function DATA_DIR() {
  return resolveDataDir();
}

function RATINGS_FILE() {
  return path.join(DATA_DIR(), 'item-ratings.json');
}

function ensureDataDir() {
  const dir = DATA_DIR();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadRatings() {
  ensureDataDir();
  const rfile = RATINGS_FILE();
  if (!fs.existsSync(rfile)) return {};
  try {
    const raw = fs.readFileSync(rfile, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('Failed to load ratings:', err.message);
    return {};
  }
}

function saveRatings(ratings) {
  ensureDataDir();
  fs.writeFileSync(RATINGS_FILE(), JSON.stringify(ratings, null, 2), 'utf8');
}

function getAllRatings() {
  return loadRatings();
}

function getRating(itemId) {
  const all = loadRatings();
  return all[itemId] || null;
}

function isValidRating(r) {
  return r === 1 || r === 2 || r === 3 || r === 4 || r === 5;
}

function setRating(itemId, rating) {
  const all = loadRatings();
  if (rating == null) {
    delete all[itemId];
  } else if (isValidRating(rating)) {
    all[itemId] = { rating, updatedAt: new Date().toISOString() };
  } else {
    throw new Error(`Invalid rating: ${rating}`);
  }
  saveRatings(all);
  return all[itemId] || null;
}

/**
 * 批量更新。patch 为 { [itemId]: rating | null }；值为 null 表示删除该条。
 * 返回受影响的条目数。
 */
function patchRatings(patch) {
  if (!patch || typeof patch !== 'object') return 0;
  const all = loadRatings();
  let count = 0;
  const now = new Date().toISOString();
  for (const [itemId, value] of Object.entries(patch)) {
    if (value == null) {
      if (all[itemId]) {
        delete all[itemId];
        count++;
      }
    } else if (isValidRating(value)) {
      all[itemId] = { rating: value, updatedAt: now };
      count++;
    }
  }
  saveRatings(all);
  return count;
}

module.exports = {
  getAllRatings,
  getRating,
  setRating,
  patchRatings,
};
