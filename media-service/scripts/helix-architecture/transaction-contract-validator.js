'use strict';

const fs = require('fs');
const path = require('path');
const { buildTransactionContracts, digestValue, tableOwner } = require('./transaction-contract-builder');
const { readTransactionSourceEntries } = require('./transaction-contract-materializer');

const normalize = (value) => value.split(path.sep).join('/');
const finding = (code, message, details = {}) => ({ code, message, ...details });

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_TRANSACTION_CONTRACT_JSON', `Cannot read JSON: ${error.message}`, { file: normalize(filePath) }));
    return null;
  }
}

function validateTransactionContracts(options) {
  const contractsRoot = path.resolve(options.contractsRoot);
  const findings = [];
  const expected = buildTransactionContracts(readTransactionSourceEntries(contractsRoot));
  const expectedById = new Map(expected.map((contract) => [contract.transactionId, contract]));
  const ownerRegistry = readJson(path.join(contractsRoot, 'manifests', 'owner-registry.json'), findings);
  const owners = new Set(ownerRegistry && ownerRegistry.owners.map((owner) => owner.id));
  const tableIds = new Set(fs.readdirSync(path.join(contractsRoot, 'table-contracts')));
  const manifest = readJson(path.join(contractsRoot, 'manifests', 'transaction-inventory.json'), findings);
  if (!manifest || manifest.status !== 'active' || manifest.targetCount !== 43 || manifest.entryFiles.length !== 1) findings.push(finding(
    'INVALID_TRANSACTION_INVENTORY_MANIFEST', 'Canonical transaction inventory must be active with 43 entries.'
  ));
  const shard = manifest && readJson(path.join(contractsRoot, 'manifests', manifest.entryFiles[0]), findings);
  const entries = shard && shard.entries || [];
  const ids = new Set();

  for (const entry of entries) {
    if (!entry || ids.has(entry.id)) {
      findings.push(finding('DUPLICATE_TRANSACTION_CONTRACT', 'Transaction IDs must be unique.', { transactionId: entry && entry.id }));
      continue;
    }
    ids.add(entry.id);
    if (!owners.has(entry.owner)) findings.push(finding('UNKNOWN_TRANSACTION_OWNER', 'Transaction Owner is absent from Owner registry.', {
      transactionId: entry.id, owner: entry.owner
    }));
    const document = readJson(path.join(contractsRoot, entry.targetLocator && entry.targetLocator.path || ''), findings);
    if (!document || !document.contract) continue;
    const contract = document.contract;
    if (document.schemaVersion !== 1 || document.contractVersion !== 1 || document.contractId !== entry.contract.contractRef) findings.push(finding(
      'INVALID_TRANSACTION_IDENTITY', 'Transaction contract identity/version is invalid.', { transactionId: entry.id }
    ));
    if (!expectedById.has(entry.id) || digestValue(contract) !== digestValue(expectedById.get(entry.id)) ||
        entry.contract.contractDigest !== digestValue(contract) || entry.contractDigest.value !== digestValue(entry.contract)) findings.push(finding(
      'TRANSACTION_CONTRACT_DRIFT', 'Committed transaction differs from the SSOT-derived contract.', { transactionId: entry.id }
    ));

    const variants = contract.variants || [];
    const variantIds = new Set();
    const variantSelectors = new Set();
    const allWriteTables = [...new Set([...(contract.writeTables || []), ...variants.flatMap((variant) => variant.writeTables || [])])];
    const allReadTables = [...new Set([...(contract.readTables || []), ...variants.flatMap((variant) => variant.readTables || [])])];
    const participantTables = new Set([
      ...contract.participants.flatMap((participant) => participant.tables),
      ...variants.flatMap((variant) => (variant.participants || []).flatMap((participant) => participant.tables))
    ]);
    for (const table of [...allWriteTables, ...allReadTables]) {
      if (!tableIds.has(table)) findings.push(finding('UNRESOLVED_TRANSACTION_TABLE', 'Transaction references an unknown P2 table.', {
        transactionId: entry.id, table
      }));
    }
    for (const table of allWriteTables) {
      if (!participantTables.has(table)) findings.push(finding('UNOWNED_TRANSACTION_WRITE', 'Write table is not covered by a CommitParticipant.', {
        transactionId: entry.id, table
      }));
      const owner = tableOwner(table);
      const exactVariantOwnsTable = variants.some((variant) => variant.selector && (variant.writeTables || []).includes(table) &&
        (variant.participants || []).some((participant) => participant.owner === owner && participant.tables.includes(table)));
      const permitted = contract.ownerScope === 'polymorphic-domain-owner'
        ? ['execution-foundation', 'material-control-authority'].includes(owner) || exactVariantOwnsTable
        : owner === contract.ownerScope || ['execution-foundation', 'material-control-authority'].includes(owner);
      if (!permitted) findings.push(finding('ILLEGAL_TRANSACTION_WRITE_OWNER', 'Transaction writes a table outside its Owner/Control/Foundation scope.', {
        transactionId: entry.id, table, tableOwner: owner
      }));
    }
    for (const variant of variants) {
      if (!variant.variantId || variantIds.has(variant.variantId)) findings.push(finding(
        'DUPLICATE_TRANSACTION_VARIANT', 'Variant IDs must be present and unique within the parent transaction.',
        { transactionId: entry.id, variantId: variant.variantId }
      ));
      variantIds.add(variant.variantId);
      if (!variant.selector) continue;
      const selector = variant.selector;
      const selectorKey = [selector.factType, selector.factSchemaRef, selector.resultSchemaRef].join('|');
      if (selector.selectorKind !== 'domain_fact_handle_exact' || !selector.factType || !selector.factSchemaRef ||
          !selector.resultSchemaRef || variantSelectors.has(selectorKey)) findings.push(finding(
        'INVALID_TRANSACTION_VARIANT_SELECTOR', 'Exact Domain Fact selectors must be complete and unique.',
        { transactionId: entry.id, variantId: variant.variantId }
      ));
      variantSelectors.add(selectorKey);
      const variantParticipantTables = new Set((variant.participants || []).flatMap((participant) => participant.tables || []));
      for (const table of variant.writeTables || []) if (!variantParticipantTables.has(table)) findings.push(finding(
        'UNOWNED_TRANSACTION_VARIANT_WRITE', 'Variant write table is not covered by its exact participant set.',
        { transactionId: entry.id, variantId: variant.variantId, table }
      ));
      if (!variant.fenceContract || variant.fenceContract.outboxRequired !== variant.writeTables.includes('fx_outbox') ||
          variant.fenceContract.commitMarkerRequired !== variant.writeTables.includes('fx_commit_markers')) findings.push(finding(
        'TRANSACTION_VARIANT_FENCE_MISMATCH', 'Variant fence and exact write tables disagree.',
        { transactionId: entry.id, variantId: variant.variantId }
      ));
      if (!variant.rollbackInvariant || !Array.isArray(variant.crashFixtures) || !variant.crashFixtures.length ||
          variant.crashFixtures.some((fixture) => !fixture.faultInjectionPoints || !fixture.requiredInvariant)) findings.push(finding(
        'MISSING_TRANSACTION_VARIANT_CRASH_FIXTURE', 'Exact variant requires rollback and crash-window contracts.',
        { transactionId: entry.id, variantId: variant.variantId }
      ));
    }
    for (const forbidden of contract.forbiddenWriteTables) {
      if (allWriteTables.includes(forbidden)) findings.push(finding('FORBIDDEN_TRANSACTION_WRITE', 'Transaction includes an explicitly forbidden write.', {
        transactionId: entry.id, table: forbidden
      }));
    }
    for (const prefix of contract.forbiddenWritePrefixes) {
      const violation = allWriteTables.find((table) => table.startsWith(prefix));
      if (violation) findings.push(finding('UPSTREAM_STORE_WRITE', 'Handoff transaction writes its Delivery Owner Store.', {
        transactionId: entry.id, table: violation
      }));
    }
    const hasControlTables = contract.writeTables.includes('fx_material_controls') && contract.writeTables.includes('fx_material_control_revisions');
    if (contract.fenceContract.materialControlCasRequired !== hasControlTables) findings.push(finding(
      'MATERIAL_CONTROL_PARTICIPANT_MISMATCH', 'Responsibility Control transaction and CAS tables must agree.', { transactionId: entry.id }
    ));
    if (contract.fenceContract.commitMarkerRequired !== contract.writeTables.includes('fx_commit_markers')) findings.push(finding(
      'TRANSACTION_COMMIT_MARKER_MISMATCH', 'Commit marker requirement and write set must agree.', { transactionId: entry.id }
    ));
    if (contract.fenceContract.outboxRequired !== contract.writeTables.includes('fx_outbox')) findings.push(finding(
      'TRANSACTION_OUTBOX_MISMATCH', 'Outbox requirement and write set disagree.', { transactionId: entry.id }
    ));
    if (!contract.crashFixtures.length || contract.crashFixtures.some((fixture) => !fixture.faultInjectionPoints || !fixture.requiredInvariant)) findings.push(finding(
      'MISSING_TRANSACTION_CRASH_FIXTURE', 'Every canonical transaction requires a bounded crash-window contract.', { transactionId: entry.id }
    ));
    if (contract.displayName === 'Domain Fact Commit') {
      if (!contract.participants.some((participant) => participant.dynamicTableSelector)) findings.push(finding(
        'MISSING_POLYMORPHIC_DOMAIN_PARTICIPANT', 'Domain Fact Commit requires a handle-selected Owner participant.', { transactionId: entry.id }
      ));
      if (variants.filter((variant) => variant.selector).length !== 2 || variants.some((variant) => variant.selector &&
          (variant.dynamicTableRequirements.length !== 0 || variant.writeTables.includes('fx_outbox') ||
           variant.fenceContract.outboxRequired !== false))) findings.push(finding(
        'INVALID_PRODUCT_FACT_VARIANT_OVERRIDE', 'Product Fact variants must be two exact static no-Outbox overrides.', { transactionId: entry.id }
      ));
    }
    if (contract.displayName === 'Shelf Deregistration Commit' && contract.forbiddenCapabilities.length !== 2) findings.push(finding(
      'DEREGISTRATION_DELETE_PATH_PRESENT', 'Shelf Deregistration must explicitly forbid both destructive delete capabilities.', { transactionId: entry.id }
    ));
  }
  for (const id of expectedById.keys()) if (!ids.has(id)) findings.push(finding('MISSING_TRANSACTION_CONTRACT', 'SSOT transaction is absent.', { transactionId: id }));
  for (const id of ids) if (!expectedById.has(id)) findings.push(finding('UNREGISTERED_TRANSACTION_CONTRACT', 'Transaction is outside SSOT.', { transactionId: id }));

  return {
    ok: findings.length === 0,
    transactionCount: ids.size,
    responsibilityControlCount: expected.filter((contract) => contract.commitClass === 'responsibility_control_commit').length,
    crashFixtureBindingCount: expected.reduce((sum, contract) => sum + contract.crashFixtures.length, 0),
    inventoryDigest: digestValue(entries),
    findings
  };
}

module.exports = Object.freeze({ validateTransactionContracts });
