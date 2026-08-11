'use strict';

const crypto = require('crypto');

const EXPECTED_COUNTS = Object.freeze({
  capabilities: 112,
  resultFamilies: 98,
  tables: 180,
  transactions: 43
});

const RETIRED_RESULT_FAMILIES = new Set(['FieldObservationPage', 'ObservationCommitResult', 'LayoutEvidence']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function splitMarkdownRow(line) {
  if (!line.startsWith('|') || !line.endsWith('|')) return [];
  const cells = [];
  let current = '';
  let inCode = false;
  for (let index = 1; index < line.length - 1; index += 1) {
    const character = line[index];
    if (character === '`') inCode = !inCode;
    if (character === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else current += character;
  }
  cells.push(current.trim());
  return cells;
}

function codeTokens(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function requireRange(lines, startHeading, endHeading) {
  const starts = lines.map((line, index) => line === startHeading ? index : -1).filter((index) => index >= 0);
  if (starts.length !== 1) throw new Error(`Expected exactly one heading: ${startHeading}`);
  const start = starts[0];
  const end = lines.findIndex((line, index) => index > start && line === endHeading);
  if (end < 0) throw new Error(`Missing end heading after ${startHeading}: ${endHeading}`);
  return { start, end, lines: lines.slice(start, end) };
}

function locator(section, absoluteLineIndex, rawLine) {
  return {
    section,
    line: absoluteLineIndex + 1,
    lineDigest: sha256(rawLine)
  };
}

function ownerForCapability(capabilityRef) {
  const prefix = capabilityRef.split('.')[0];
  const owners = {
    shared: 'execution-foundation',
    procurement: 'procurement',
    libra: 'libra',
    arca: 'arca',
    perception: 'perception',
    people: 'people'
  };
  if (!owners[prefix]) throw new Error(`Unknown Capability owner prefix: ${capabilityRef}`);
  return owners[prefix];
}

function ownerForTable(tableName) {
  if (tableName.startsWith('fx_material_control')) return 'material-control-authority';
  if (tableName.startsWith('fx_')) return 'execution-foundation';
  if (tableName.startsWith('proc_')) return 'procurement';
  if (tableName.startsWith('libra_')) return 'libra';
  if (tableName.startsWith('arca_')) return 'arca';
  if (tableName.startsWith('perception_')) return 'perception';
  if (tableName.startsWith('people_')) return 'people';
  if (tableName.startsWith('platform_')) return 'platform-settings';
  throw new Error(`Unknown table owner prefix: ${tableName}`);
}

function transactionOwner(name) {
  if (name === 'Domain Fact Commit') return 'polymorphic-domain-owner';
  if (name === 'Field Observation Page Commit' || name === 'Field Eligibility Reconcile Commit') return 'procurement';
  if (name === 'Perception Acquisition Page Commit' || name === 'Perception Resolution Commit') return 'perception';
  if (name.startsWith('People Candidate ') || name === 'Direct Person Registration' || name === 'People Reference Image Commit') return 'people';
  if (name.startsWith('Procurement ')) return 'procurement';
  if (name === 'Field Routing Policy Publish' || name.startsWith('Handoff A') || name.startsWith('Libra ')) return 'libra';
  return 'arca';
}

function sectionForLine(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const match = lines[cursor].match(/^#### (8\.[0-9]+\.[0-9]+) /);
    if (match) return match[1];
  }
  throw new Error(`Cannot resolve section for line ${index + 1}`);
}

function parseCapabilities(lines) {
  const range = requireRange(lines, '#### 8.6.3 Shared Foundation Capability', '#### 8.6.15 Catalog合并与边界校验');
  const entries = [];
  for (let offset = 0; offset < range.lines.length; offset += 1) {
    const rawLine = range.lines[offset];
    const cells = splitMarkdownRow(rawLine);
    if (cells.length !== 3) continue;
    const refs = codeTokens(cells[0]);
    const effects = codeTokens(cells[2]);
    if (refs.length !== 1 || !refs[0].endsWith('@1')) continue;
    if (effects.length !== 1) throw new Error(`Ambiguous Effect Class at line ${range.start + offset + 1}`);
    const summaries = codeTokens(cells[1]).filter((value) => value.includes('→'));
    if (summaries.length !== 1) {
      throw new Error(`Capability summary must contain one code-form arrow at line ${range.start + offset + 1}`);
    }
    const [inputSummary, outputFamily] = summaries[0].split('→').map((value) => value.trim());
    if (!inputSummary || !outputFamily) throw new Error(`Invalid Capability summary at line ${range.start + offset + 1}`);
    const capabilityRef = refs[0];
    entries.push({
      id: capabilityRef,
      contractVersion: 1,
      owner: ownerForCapability(capabilityRef),
      inputSummary,
      outputFamily,
      effectClass: effects[0],
      source: locator(sectionForLine(lines, range.start + offset), range.start + offset, rawLine)
    });
  }
  return entries;
}

function buildResultFamilies(lines, capabilities) {
  const registryRange = requireRange(lines, '#### 8.6.19 Domain nominal type registry', '#### 8.6.20 Input schema、parameter与semantic validator边界');
  const handleRange = requireRange(lines, '#### 8.6.18 Shared handle、formal input DTO与envelope字段合同', '#### 8.6.19 Domain nominal type registry');
  const outcomeRange = requireRange(lines, '#### 8.6.17 ExecutionContext与Outcome envelope', '#### 8.6.18 Shared handle、formal input DTO与envelope字段合同');
  const definitionLocators = new Map();

  for (const range of [handleRange, registryRange]) {
    for (let offset = 0; offset < range.lines.length; offset += 1) {
      const rawLine = range.lines[offset];
      const cells = splitMarkdownRow(rawLine);
      if (cells.length < 2) continue;
      for (const name of codeTokens(cells[0])) {
        if (RETIRED_RESULT_FAMILIES.has(name)) continue;
        if (!definitionLocators.has(name)) {
          definitionLocators.set(name, locator(sectionForLine(lines, range.start + offset), range.start + offset, rawLine));
        }
      }
    }
  }

  const byName = new Map();
  for (const capability of capabilities) {
    const name = capability.outputFamily;
    const entry = byName.get(name) || {
      id: name,
      kind: definitionLocators.has(name) && definitionLocators.get(name).section === '8.6.18' ? 'direct-handle-result' : 'nominal-result',
      producedBy: [],
      source: definitionLocators.get(name) || capability.source
    };
    entry.producedBy.push(capability.id);
    byName.set(name, entry);
  }

  // Receipt-only nominal types are not capability outputs, but remain part of the
  // active Result-family catalog because canonical transactions persist them.
  const receiptName = 'ObservationPageCommitReceipt';
  if (!byName.has(receiptName)) {
    const locatorEntry = definitionLocators.get(receiptName);
    if (!locatorEntry) throw new Error(`Missing active Result family definition: ${receiptName}`);
    byName.set(receiptName, {
      id: receiptName,
      kind: locatorEntry.section === '8.6.18' ? 'direct-handle-result' : 'nominal-result',
      producedBy: [],
      source: locatorEntry
    });
  }

  const outcomeLineOffset = outcomeRange.lines.findIndex((line) => line.startsWith('| `succeeded`'));
  if (outcomeLineOffset < 0) throw new Error('Missing Capability Outcome variants');
  byName.set('CapabilityOutcome', {
    id: 'CapabilityOutcome',
    kind: 'outcome-envelope',
    producedBy: [],
    source: locator('8.6.17', outcomeRange.start + outcomeLineOffset, outcomeRange.lines[outcomeLineOffset])
  });
  return [...byName.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function parseTables(lines) {
  const range = requireRange(lines, '#### 8.5.10 Foundation逐表合同', '### 8.6 Clean Capability Catalog与nominal type');
  const entries = [];
  for (let offset = 0; offset < range.lines.length; offset += 1) {
    const rawLine = range.lines[offset];
    const cells = splitMarkdownRow(rawLine);
    if (cells.length !== 3) continue;
    const names = codeTokens(cells[0]);
    if (names.length !== 1 || !/^[a-z][a-z0-9_]+$/.test(names[0])) continue;
    entries.push({
      id: names[0],
      owner: ownerForTable(names[0]),
      columnsContract: cells[1],
      constraintsContract: cells[2],
      source: locator(sectionForLine(lines, range.start + offset), range.start + offset, rawLine)
    });
  }
  return entries;
}

function parseTransactions(lines) {
  const range = requireRange(lines, '#### 8.5.4 Canonical transaction boundaries', '#### 8.5.5 跨Domain提交仍不写上游Store');
  const entries = [];
  for (let offset = 0; offset < range.lines.length; offset += 1) {
    const rawLine = range.lines[offset];
    const cells = splitMarkdownRow(rawLine);
    if (cells.length !== 2 || cells[0] === 'Commit' || cells[0].startsWith('---')) continue;
    if (!cells[0] || !cells[1]) continue;
    entries.push({
      id: cells[0],
      owner: transactionOwner(cells[0]),
      atomicFactSet: cells[1],
      source: locator('8.5.4', range.start + offset, rawLine)
    });
  }
  return entries;
}

function assertUniqueAndCount(name, entries, expectedCount) {
  const ids = entries.map((entry) => entry.id);
  if (ids.length !== expectedCount) throw new Error(`${name} count drift: expected ${expectedCount}, got ${ids.length}`);
  if (new Set(ids).size !== ids.length) throw new Error(`${name} contains duplicate IDs`);
}

function extractSsotContracts(content, options = {}) {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const capabilities = parseCapabilities(lines);
  const resultFamilies = buildResultFamilies(lines, capabilities);
  const tables = parseTables(lines);
  const transactions = parseTransactions(lines);

  assertUniqueAndCount('Capability', capabilities, EXPECTED_COUNTS.capabilities);
  assertUniqueAndCount('Result family', resultFamilies, EXPECTED_COUNTS.resultFamilies);
  assertUniqueAndCount('Table', tables, EXPECTED_COUNTS.tables);
  assertUniqueAndCount('Transaction', transactions, EXPECTED_COUNTS.transactions);

  const categories = { capabilities, resultFamilies, tables, transactions };
  return {
    schemaVersion: 1,
    sourcePath: options.sourcePath || 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
    sourceDocumentDigest: sha256(normalized),
    counts: {
      capabilities: capabilities.length,
      resultFamilies: resultFamilies.length,
      tables: tables.length,
      transactions: transactions.length
    },
    categoryDigests: Object.fromEntries(Object.entries(categories).map(([name, entries]) => [name, canonicalDigest(entries)])),
    aggregateDigest: canonicalDigest(categories),
    ...categories
  };
}

module.exports = Object.freeze({ EXPECTED_COUNTS, canonicalDigest, extractSsotContracts, splitMarkdownRow });
