'use strict';

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const definitions = new WeakMap();

class RepositoryBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RepositoryBoundaryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new RepositoryBoundaryError(code, message, details);
}

function quote(value) {
  if (!IDENTIFIER.test(value)) fail('P3_REPOSITORY_INVALID_IDENTIFIER', 'Repository identifier is invalid.', { value });
  return '"' + value + '"';
}

function requireColumns(table, columns, statementId) {
  if (!Array.isArray(columns) || columns.length === 0 || new Set(columns).size !== columns.length) {
    fail('P3_REPOSITORY_INVALID_COLUMNS', 'Statement columns must be non-empty and unique.', { statementId });
  }
  const available = new Set(table.columns);
  for (const column of columns) {
    if (!available.has(column)) fail('P3_REPOSITORY_UNKNOWN_COLUMN', 'Statement references a column outside its table contract.', {
      statementId, tableId: table.tableId, column
    });
  }
}

function compileStatement(statementId, statement, table) {
  if (!statement || statement.sql !== undefined) fail('P3_REPOSITORY_RAW_SQL_FORBIDDEN', 'Repository definitions cannot provide raw SQL.', { statementId });
  const tableName = quote(table.tableId);
  if (statement.kind === 'insert') {
    requireColumns(table, statement.columns, statementId);
    return {
      statementId, kind: statement.kind, tableId: table.tableId, parameters: [...statement.columns],
      sql: 'INSERT INTO ' + tableName + ' (' + statement.columns.map(quote).join(', ') + ') VALUES (' +
        statement.columns.map((column) => '@' + column).join(', ') + ')'
    };
  }
  if (statement.kind === 'update') {
    if (table.immutable) fail('P3_REPOSITORY_IMMUTABLE_UPDATE', 'Immutable table contracts cannot register UPDATE statements.', {
      statementId, tableId: table.tableId
    });
    requireColumns(table, statement.setColumns, statementId);
    requireColumns(table, statement.keyColumns, statementId);
    const comparisons = statement.compareColumns || [];
    for (const comparison of comparisons) {
      if (!comparison || !IDENTIFIER.test(comparison.parameter || '')) fail('P3_REPOSITORY_INVALID_COMPARISON', 'CAS comparison requires a valid parameter.', { statementId });
      requireColumns(table, [comparison.column], statementId);
      if (comparison.nullSafe !== undefined && comparison.nullSafe !== true) fail('P3_REPOSITORY_INVALID_COMPARISON', 'nullSafe must be true when declared.', { statementId });
    }
    const parameters = [...statement.setColumns, ...statement.keyColumns, ...comparisons.map((comparison) => comparison.parameter)];
    if (new Set(parameters).size !== parameters.length) fail('P3_REPOSITORY_OVERLAPPING_COLUMNS', 'SET and key columns cannot overlap.', { statementId });
    return {
      statementId, kind: statement.kind, tableId: table.tableId, parameters,
      sql: 'UPDATE ' + tableName + ' SET ' + statement.setColumns.map((column) => quote(column) + '=@' + column).join(', ') +
        ' WHERE ' + [...statement.keyColumns.map((column) => quote(column) + '=@' + column),
          ...comparisons.map((comparison) => comparison.nullSafe
            ? '(' + quote(comparison.column) + '=@' + comparison.parameter + ' OR (' + quote(comparison.column) + ' IS NULL AND @' + comparison.parameter + ' IS NULL))'
            : quote(comparison.column) + '=@' + comparison.parameter)].join(' AND ')
    };
  }
  if (statement.kind === 'select-one' || statement.kind === 'select-all') {
    requireColumns(table, statement.columns, statementId);
    const keyColumns = statement.keyColumns || [];
    if (keyColumns.length > 0) requireColumns(table, keyColumns, statementId);
    return {
      statementId, kind: statement.kind, tableId: table.tableId, parameters: [...keyColumns], safeIntegers: statement.safeIntegers === true,
      sql: 'SELECT ' + statement.columns.map(quote).join(', ') + ' FROM ' + tableName +
        (keyColumns.length ? ' WHERE ' + keyColumns.map((column) => quote(column) + '=@' + column).join(' AND ') : '')
    };
  }
  if (statement.kind === 'select-in') {
    requireColumns(table, statement.columns, statementId);
    requireColumns(table, [statement.keyColumn], statementId);
    const fixedKeyColumns = statement.fixedKeyColumns || [];
    if (fixedKeyColumns.length > 0) requireColumns(table, fixedKeyColumns, statementId);
    if (!Number.isSafeInteger(statement.maxItems) || statement.maxItems < 1 || statement.maxItems > 500) fail('P3_REPOSITORY_INVALID_COLUMNS', 'select-in requires a bounded maxItems.', { statementId });
    return { statementId, kind:statement.kind, tableId:table.tableId, parameters:[...fixedKeyColumns, 'values'], safeIntegers:statement.safeIntegers === true,
      maxItems:statement.maxItems, sqlPrefix:'SELECT ' + statement.columns.map(quote).join(', ') + ' FROM ' + tableName +
        ' WHERE ' + (fixedKeyColumns.length ? fixedKeyColumns.map((column) => quote(column) + '=@' + column).join(' AND ') + ' AND ' : '') +
        quote(statement.keyColumn) + ' IN (', orderBy:quote(statement.keyColumn) };
  }
  fail('P3_REPOSITORY_UNSUPPORTED_STATEMENT', 'Repository statement kind is unsupported.', { statementId, kind: statement && statement.kind });
}

function createRepositoryDefinition(options) {
  if (!options || !IDENTIFIER.test(options.repositoryId || '') || typeof options.owner !== 'string' ||
      !options.schemaManifest || !options.statements || typeof options.statements !== 'object') {
    fail('P3_REPOSITORY_INVALID_DEFINITION', 'Repository ID, Owner, schema manifest, and statements are required.');
  }
  const tables = new Map(options.schemaManifest.tables.map((table) => [table.tableId, table]));
  const compiled = new Map();
  const tableIds = new Set();
  for (const [statementId, statement] of Object.entries(options.statements)) {
    if (!IDENTIFIER.test(statementId)) fail('P3_REPOSITORY_INVALID_IDENTIFIER', 'Statement ID is invalid.', { statementId });
    const table = tables.get(statement && statement.tableId);
    if (!table) fail('P3_REPOSITORY_UNKNOWN_TABLE', 'Statement table is absent from the clean schema.', { statementId });
    if (table.owner !== options.owner) fail('P3_REPOSITORY_OWNER_MISMATCH', 'Repository cannot register another Owner table.', {
      repositoryId: options.repositoryId, owner: options.owner, tableId: table.tableId, tableOwner: table.owner
    });
    compiled.set(statementId, compileStatement(statementId, statement, table));
    tableIds.add(table.tableId);
  }
  if (compiled.size === 0) fail('P3_REPOSITORY_EMPTY_DEFINITION', 'Repository requires at least one registered statement.');
  const definition = Object.freeze({
    repositoryId: options.repositoryId,
    owner: options.owner,
    readOnly: [...compiled.values()].every((statement) =>
      statement.kind === 'select-one' || statement.kind === 'select-all' || statement.kind === 'select-in'),
    statementIds: Object.freeze([...compiled.keys()].sort()),
    tableIds: Object.freeze([...tableIds].sort())
  });
  definitions.set(definition, compiled);
  return definition;
}

function bindRepository(definition, transaction, isActive) {
  const compiled = definitions.get(definition);
  if (!compiled) fail('P3_REPOSITORY_UNKNOWN_DEFINITION', 'Repository definition was not created by the clean registry.');
  const prepared = new Map();
  return Object.freeze({
    repositoryId: definition.repositoryId,
    owner: definition.owner,
    invoke(statementId, parameters = {}) {
      if (!isActive()) fail('P3_REPOSITORY_CONTEXT_EXPIRED', 'Repository context cannot escape its participant callback.');
      const statement = compiled.get(statementId);
      if (!statement) fail('P3_REPOSITORY_UNDECLARED_STATEMENT', 'Statement is not registered in this Repository.', {
        repositoryId: definition.repositoryId, statementId
      });
      const values = {};
      for (const parameter of statement.parameters) {
        if (!Object.prototype.hasOwnProperty.call(parameters, parameter) || parameters[parameter] === undefined) {
          fail('P3_REPOSITORY_MISSING_PARAMETER', 'Registered statement parameter is missing.', { statementId, parameter });
        }
        values[parameter] = parameters[parameter];
      }
      if (statement.kind === 'select-in') {
        const inValues = parameters.values;
        if (!Array.isArray(inValues) || inValues.length < 1 || inValues.length > statement.maxItems) fail('P3_REPOSITORY_INVALID_IN_SET', 'select-in values exceed their declared bound.', { statementId });
        const cacheKey = statementId + ':' + inValues.length;
        if (!prepared.has(cacheKey)) prepared.set(cacheKey, transaction.prepare(statement.sqlPrefix + inValues.map((unused, index) => '@in_' + index).join(',') + ') ORDER BY ' + statement.orderBy));
        const bindings = { ...values }; delete bindings.values;
        inValues.forEach((value, index) => { bindings['in_' + index] = value; });
        const executable = prepared.get(cacheKey); if (statement.safeIntegers) executable.safeIntegers(true); return executable.all(bindings);
      }
      if (!prepared.has(statementId)) prepared.set(statementId, transaction.prepare(statement.sql));
      const executable = prepared.get(statementId);
      if (statement.safeIntegers) executable.safeIntegers(true);
      if (statement.kind === 'select-one') return executable.get(values);
      if (statement.kind === 'select-all') return executable.all(values);
      return executable.run(values);
    }
  });
}

module.exports = Object.freeze({ RepositoryBoundaryError, bindRepository, createRepositoryDefinition });
