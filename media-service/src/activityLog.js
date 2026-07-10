'use strict';

/**
 * ActivityLog — in-memory ring buffer for engine lifecycle events.
 *
 * Written by Helix Automation components so Admin Web
 * can surface natural-language status messages to the user.
 */

const MAX_ENTRIES = 100;
const buffer = [];

function addActivity(source, message, detail) {
  const entry = {
    ts: new Date().toISOString(),
    source,
    message,
  };
  if (detail !== undefined) entry.detail = detail;
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

function getRecent(count) {
  const n = Math.min(count || 20, buffer.length);
  return buffer.slice(-n).reverse();
}

module.exports = { addActivity, getRecent };
