'use strict';

const FALSE_PREFIXES = new Set(['CD', 'DVD', 'MP', 'MKV', 'AVI', 'MOV', 'WMV', 'FLV', 'PART']);

function extractAdultId(value) {
  const normalized = String(value || '').normalize('NFKC').toUpperCase();
  const fc2 = normalized.match(/\bFC2(?:[-_\s]?PPV)?[-_\s]?(\d{3,})\b/);
  if (fc2) return `FC2-${fc2[1]}`;
  const match = normalized.match(/\b([A-Z]{2,10})[-_\s]?(\d{2,6})\b/);
  if (!match || FALSE_PREFIXES.has(match[1])) return '';
  return `${match[1]}-${match[2]}`;
}

module.exports = { extractAdultId };
