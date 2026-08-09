'use strict';

const path = require('path');
const { digestValue } = require('./table-contract-builder');
const { validateCapabilityContracts } = require('./capability-contract-validator');
const { validateDomainInputSchemas } = require('./domain-input-schema-validator');
const { validateResultTypeSchemas } = require('./result-type-schema-validator');
const { validateSharedTypeSchemas } = require('./shared-type-schema-validator');
const { validateSsotSourceMap } = require('./ssot-source-map-validator');
const { validateTableContracts } = require('./table-contract-validator');
const { validateTransactionContracts } = require('./transaction-contract-validator');

function validateP2ContractBaseline(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const contractsRoot = path.resolve(options.contractsRoot);
  const sourceMap = validateSsotSourceMap({
    repositoryRoot,
    mapPath: path.join(contractsRoot, 'manifests', 'ssot-source-map.json')
  });
  const sharedTypes = validateSharedTypeSchemas({ contractsRoot });
  const resultTypes = validateResultTypeSchemas({ contractsRoot });
  const domainInputs = validateDomainInputSchemas({ contractsRoot, repositoryRoot });
  const capabilities = validateCapabilityContracts({ contractsRoot, repositoryRoot });
  const tables = validateTableContracts({ contractsRoot });
  const transactions = validateTransactionContracts({ contractsRoot });
  const components = { sourceMap, sharedTypes, resultTypes, domainInputs, capabilities, tables, transactions };
  const findings = [];
  for (const [component, result] of Object.entries(components)) {
    if (!result.ok) findings.push(...result.findings.map((item) => ({ component, ...item })));
  }
  const exactCounts = sourceMap.counts && sourceMap.counts.capabilities === 112 && sourceMap.counts.resultFamilies === 97 &&
    sourceMap.counts.tables === 179 && sourceMap.counts.transactions === 43 && capabilities.packageCount === 112 &&
    resultTypes.catalogResultCount + 1 === 97 && tables.tableCount === 179 && transactions.transactionCount === 43;
  if (!exactCounts) findings.push({ code: 'P2_CARDINALITY_MISMATCH', message: 'P2 baseline must close 112/97/179/43 exactly.' });
  if (capabilities.unresolvedTypeRefCount !== 0) findings.push({
    code: 'P2_UNRESOLVED_TYPE_GRAPH', message: 'P2 Capability type graph must have zero unresolved refs.',
    refs: capabilities.unresolvedTypeRefs
  });

  const digestInputs = {
    ssot: sourceMap.aggregateDigest,
    sharedTypes: sharedTypes.registryDigest,
    resultTypes: resultTypes.registryDigest,
    domainInputs: domainInputs.registryDigest,
    capabilities: capabilities.packageAggregateDigest,
    tables: tables.inventoryDigest,
    transactions: transactions.inventoryDigest
  };
  return {
    ok: findings.length === 0,
    scope: 'P2_LOCAL_ISOLATED_CONTRACT_BASELINE',
    counts: {
      capabilities: capabilities.packageCount,
      resultFamilies: resultTypes.catalogResultCount + 1,
      tables: tables.tableCount,
      transactions: transactions.transactionCount,
      sharedTypes: sharedTypes.typeCount,
      domainInputs: domainInputs.typeCount,
      referencedTypeRefs: capabilities.referencedTypeRefCount,
      unresolvedTypeRefs: capabilities.unresolvedTypeRefCount
    },
    componentDigests: digestInputs,
    aggregateDigest: digestValue(digestInputs),
    components,
    prohibitedActionsRun: [],
    findings
  };
}

module.exports = Object.freeze({ validateP2ContractBaseline });
