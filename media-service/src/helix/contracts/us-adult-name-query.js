'use strict';

// Canonical public query identity shared by People and its callers. Actual
// name matching and Person selection remain People-owned decisions.
const POLICY = 'people.us-adult-name-resolution@1';
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function normalizeName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    throw Object.assign(new Error('A bounded non-empty actor name is required.'), { code:'PEOPLE_NAME_QUERY_INVALID' });
  const normalized = value.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!normalized) throw Object.assign(new Error('Actor names must contain letters or numbers.'), { code:'PEOPLE_NAME_QUERY_INVALID' });
  return normalized;
}
function queryNames(name, aliases) { return [...new Set([name, ...aliases].map(normalizeName))].sort(compare); }
module.exports = Object.freeze({ POLICY, compare, normalizeName, queryNames });
