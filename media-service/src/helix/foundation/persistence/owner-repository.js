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
  if (statement.kind === 'delete') {
    if (table.immutable) fail('P3_REPOSITORY_UNSUPPORTED_STATEMENT',
      'Immutable owner tables cannot register delete statements.', { statementId, tableId:table.tableId });
    requireColumns(table, statement.keyColumns, statementId);
    return {
      statementId, kind: statement.kind, tableId: table.tableId, parameters: [...statement.keyColumns],
      sql: 'DELETE FROM ' + tableName + ' WHERE ' + statement.keyColumns.map((column) => quote(column) + '=@' + column).join(' AND ')
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
  if(statement.kind==='select-page-after'){
    requireColumns(table,statement.columns,statementId);requireColumns(table,[statement.keyColumn],statementId);
    const fixedKeyColumns=statement.fixedKeyColumns||[];if(fixedKeyColumns.length>0)requireColumns(table,fixedKeyColumns,statementId);
    if(!Number.isSafeInteger(statement.maxItems)||statement.maxItems<1||statement.maxItems>500){
      fail('P3_REPOSITORY_INVALID_COLUMNS','select-page-after requires a bounded maxItems.',{statementId});
    }
    return {statementId,kind:statement.kind,tableId:table.tableId,parameters:[...fixedKeyColumns,'cursor','limit'],
      safeIntegers:statement.safeIntegers===true,maxItems:statement.maxItems,
      sql:'SELECT '+statement.columns.map(quote).join(', ')+' FROM '+tableName+' WHERE '+
        (fixedKeyColumns.length?fixedKeyColumns.map((column)=>quote(column)+'=@'+column).join(' AND ')+' AND ':'')+
        '(@cursor IS NULL OR '+quote(statement.keyColumn)+'>@cursor) ORDER BY '+quote(statement.keyColumn)+' LIMIT @limit'};
  }
  if(statement.kind==='select-range'){
    requireColumns(table, statement.columns, statementId);
    requireColumns(table, [statement.keyColumn], statementId);
    const fixedKeyColumns = statement.fixedKeyColumns || [];
    if(fixedKeyColumns.length > 0) requireColumns(table, fixedKeyColumns, statementId);
    if(!Number.isSafeInteger(statement.maxItems) || statement.maxItems < 1 || statement.maxItems > 500){
      fail('P3_REPOSITORY_INVALID_COLUMNS','select-range requires a bounded maxItems.',{statementId});
    }
    return { statementId, kind:'select-range', tableId:table.tableId,
      parameters:[...fixedKeyColumns,'rangeStart','rangeEnd','cursor','limit'], safeIntegers:statement.safeIntegers === true,
      maxItems:statement.maxItems,
      sql:'SELECT '+statement.columns.map(quote).join(', ')+' FROM '+tableName+' WHERE '+
        (fixedKeyColumns.length?fixedKeyColumns.map((column)=>quote(column)+'=@'+column).join(' AND ')+' AND ':'')+
        quote(statement.keyColumn)+'>=@rangeStart AND '+quote(statement.keyColumn)+'<@rangeEnd AND '+
        '(@cursor IS NULL OR '+quote(statement.keyColumn)+'>@cursor) ORDER BY '+quote(statement.keyColumn)+' LIMIT @limit'};
  }
  if(statement.kind==='select-before-page'){
    requireColumns(table,statement.columns,statementId);
    requireColumns(table,[statement.upperBoundColumn],statementId);
    const orderBy=statement.orderBy||[];
    if(!Array.isArray(orderBy)||orderBy.length<1||orderBy.length>6){
      fail('P3_REPOSITORY_INVALID_COLUMNS','select-before-page requires a bounded ordering.',{statementId});
    }
    for(const column of orderBy)requireColumns(table,[column],statementId);
    if(!Number.isSafeInteger(statement.maxItems)||statement.maxItems<1||statement.maxItems>1000){
      fail('P3_REPOSITORY_INVALID_COLUMNS','select-before-page requires a bounded maxItems.',{statementId});
    }
    return {statementId,kind:statement.kind,tableId:table.tableId,parameters:['upperBound','offset','limit'],
      safeIntegers:statement.safeIntegers===true,maxItems:statement.maxItems,
      sql:'SELECT '+statement.columns.map(quote).join(', ')+' FROM '+tableName+' WHERE '+
        quote(statement.upperBoundColumn)+'<@upperBound ORDER BY '+orderBy.map(quote).join(', ')+' LIMIT @limit OFFSET @offset'};
  }
  if (statement.kind === 'select-filtered-page') {
    requireColumns(table, statement.columns, statementId);
    const fixedKeyColumns = statement.fixedKeyColumns || [];
    const excludedKeyColumns = statement.excludedKeyColumns || [];
    const orderBy = statement.orderBy || [];
    if (fixedKeyColumns.length > 0) requireColumns(table, fixedKeyColumns, statementId);
    if (excludedKeyColumns.length > 0) requireColumns(table, excludedKeyColumns, statementId);
    if (!Array.isArray(orderBy) || orderBy.length < 1 || orderBy.length > 6) {
      fail('P3_REPOSITORY_INVALID_COLUMNS', 'select-filtered-page requires a bounded ordering.', { statementId });
    }
    for (const ordering of orderBy) {
      requireColumns(table, [ordering.column], statementId);
      if (!['asc', 'desc'].includes(ordering.direction)) fail('P3_REPOSITORY_INVALID_COLUMNS', 'select-filtered-page order direction is invalid.', { statementId });
    }
    if (!Number.isSafeInteger(statement.maxItems) || statement.maxItems < 1 || statement.maxItems > 500) {
      fail('P3_REPOSITORY_INVALID_COLUMNS', 'select-filtered-page requires a bounded maxItems.', { statementId });
    }
    return { statementId, kind: statement.kind, tableId: table.tableId,
      parameters: [...fixedKeyColumns, ...excludedKeyColumns.map((column) => 'excluded_' + column), 'offset', 'limit'], safeIntegers: statement.safeIntegers === true,
      maxItems: statement.maxItems,
      sql: 'SELECT ' + statement.columns.map(quote).join(', ') + ' FROM ' + tableName +
        (fixedKeyColumns.length || excludedKeyColumns.length ? ' WHERE ' + [
          ...fixedKeyColumns.map((column) => quote(column) + '=@' + column),
          ...excludedKeyColumns.map((column) => quote(column) + '<>@excluded_' + column)
        ].join(' AND ') : '') +
        ' ORDER BY ' + orderBy.map((ordering) => quote(ordering.column) + ' ' + ordering.direction.toUpperCase()).join(', ') +
        ' LIMIT @limit OFFSET @offset' };
  }
  if (statement.kind === 'count-grouped') {
    requireColumns(table, [statement.groupColumn], statementId);
    return { statementId, kind: statement.kind, tableId: table.tableId, parameters: [], safeIntegers: true,
      sql: 'SELECT ' + quote(statement.groupColumn) + ' AS "group_value", COUNT(*) AS "row_count" FROM ' + tableName +
        ' GROUP BY ' + quote(statement.groupColumn) };
  }
  if(statement.kind==='delete-one'){
    if(table.immutable&&table.deletion?.retentionGcAllowed!==true){
      fail('P3_REPOSITORY_IMMUTABLE_DELETE','Immutable table contracts require an explicit Retention GC deletion contract.',{
        statementId,tableId:table.tableId
      });
    }
    requireColumns(table,statement.keyColumns,statementId);
    return {statementId,kind:statement.kind,tableId:table.tableId,parameters:[...statement.keyColumns],
      sql:'DELETE FROM '+tableName+' WHERE '+statement.keyColumns.map((column)=>quote(column)+'=@'+column).join(' AND ')};
  }
  fail('P3_REPOSITORY_UNSUPPORTED_STATEMENT', 'Repository statement kind is unsupported.', { statementId, kind: statement && statement.kind });
}

function compileJoinedPage(statementId, statement, table, tables, owner) {
  if(statement.sql!==undefined)fail('P3_REPOSITORY_RAW_SQL_FORBIDDEN','Joined reads cannot provide SQL.',{statementId});
  const aliases=new Map([['base',table]]),tableIds=[table.tableId],joins=[];
  function ref(alias,column){const target=aliases.get(alias);if(!target)fail('P3_REPOSITORY_UNKNOWN_TABLE','Unknown join alias.',{statementId});
    requireColumns(target,[column],statementId);return quote(alias)+'.'+quote(column);}
  if(!Array.isArray(statement.joins)||statement.joins.length>3)fail('P3_REPOSITORY_INVALID_DEFINITION','Joined read scope is invalid.',{statementId});
  for(const join of statement.joins){
    const target=tables.get(join.tableId);
    if(!target||target.owner!==owner)fail('P3_REPOSITORY_OWNER_MISMATCH','Joined read cannot access another Owner.',{statementId});
    if(aliases.has(join.alias)||!IDENTIFIER.test(join.alias)||!Array.isArray(join.on)||!join.on.length)
      fail('P3_REPOSITORY_INVALID_DEFINITION','Joined read identity is invalid.',{statementId});
    aliases.set(join.alias,target);tableIds.push(target.tableId);
    joins.push('LEFT JOIN '+quote(target.tableId)+' '+quote(join.alias)+' ON '+join.on.map(key=>
      ref(join.alias,key.column)+'='+ref(key.otherAlias,key.otherColumn)).join(' AND '));
  }
  requireColumns(table,statement.columns,statementId);
  const parameters=['offset','limit'],where=[];
  for(const filter of statement.filters||[]){
    if(filter.kind==='is_null') {
      if(filter.parameter!==undefined||filter.optional)fail('P3_REPOSITORY_INVALID_DEFINITION','Null predicate cannot take a parameter.',{statementId});
      where.push(ref(filter.alias||'base',filter.column)+' IS NULL');continue;
    }
    if(!IDENTIFIER.test(filter.parameter))fail('P3_REPOSITORY_INVALID_IDENTIFIER','Invalid filter parameter.',{statementId});
    parameters.push(filter.parameter);
    const source=ref(filter.alias||'base',filter.column),parameter='@'+filter.parameter;
    let predicate;
    if(filter.kind==='equals')predicate=source+'='+parameter;
    else if(filter.kind==='not_equals')predicate=source+'<>'+parameter;
    else if(filter.kind==='greater_than')predicate=source+'>'+parameter;
    else if(filter.kind==='contains')predicate='instr(lower('+source+'),lower('+parameter+'))>0';
    else if(filter.kind==='json_entry_text'){
      if(!/^\$\.[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(filter.path)||
        !Array.isArray(filter.keys)||!filter.keys.length||filter.keys.some(key=>!IDENTIFIER.test(key)))
        fail('P3_REPOSITORY_INVALID_DEFINITION','Invalid JSON entry filter.',{statementId});
      predicate="EXISTS (SELECT 1 FROM json_each("+source+", '"+filter.path+"') j WHERE json_extract(j.value,'$.key') IN ("+
        filter.keys.map(key=>"'"+key+"'").join(',')+") AND instr(lower(CAST(json_extract(j.value,'$.value') AS TEXT)),lower("+parameter+"))>0)";
    }else fail('P3_REPOSITORY_INVALID_DEFINITION','Unknown joined filter.',{statementId});
    where.push(filter.optional?'('+parameter+"='' OR "+predicate+')':predicate);
  }
  if(!Array.isArray(statement.orderBy)||!statement.orderBy.length||statement.orderBy.length>6||
    !Number.isSafeInteger(statement.maxItems)||statement.maxItems<1||statement.maxItems>101)
    fail('P3_REPOSITORY_INVALID_PAGE_LIMIT','Joined read bounds are invalid.',{statementId});
  const order=statement.orderBy.map(item=>{if(!['asc','desc'].includes(item.direction))fail('P3_REPOSITORY_INVALID_DEFINITION','Invalid joined order.',{statementId});
    return ref('base',item.column)+' '+item.direction.toUpperCase();});
  return {statementId,kind:'select-joined-page',tableId:table.tableId,tableIds,parameters:[...new Set(parameters)],maxItems:statement.maxItems,
    safeIntegers:statement.safeIntegers===true,sql:'SELECT DISTINCT '+statement.columns.map(column=>ref('base',column)).join(',')+
      ' FROM '+quote(table.tableId)+' '+quote('base')+' '+joins.join(' ')+(where.length?' WHERE '+where.join(' AND '):'')+
      ' ORDER BY '+order.join(',')+' LIMIT @limit OFFSET @offset'};
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
    const compiledStatement=statement.kind==='select-joined-page'?compileJoinedPage(statementId,statement,table,tables,options.owner):compileStatement(statementId, statement, table);
    compiled.set(statementId,compiledStatement);
    for(const id of compiledStatement.tableIds||[])tableIds.add(id);
    tableIds.add(table.tableId);
  }
  if (compiled.size === 0) fail('P3_REPOSITORY_EMPTY_DEFINITION', 'Repository requires at least one registered statement.');
  const definition = Object.freeze({
    repositoryId: options.repositoryId,
    owner: options.owner,
    readOnly: [...compiled.values()].every((statement) =>
      statement.kind === 'select-one' || statement.kind === 'select-all' || statement.kind === 'select-in'||statement.kind==='select-page-after'||statement.kind==='select-range'||statement.kind==='select-before-page'||statement.kind==='select-filtered-page'||statement.kind==='count-grouped'||statement.kind==='select-joined-page'),
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
      if(statement.kind==='select-page-after'&&(!Number.isSafeInteger(parameters.limit)||parameters.limit<1||parameters.limit>statement.maxItems)){
        fail('P3_REPOSITORY_INVALID_PAGE_LIMIT','select-page-after limit exceeds its declared bound.',{statementId});
      }
      if(statement.kind==='select-range'&&(!Number.isSafeInteger(parameters.limit)||parameters.limit<1||parameters.limit>statement.maxItems)){
        fail('P3_REPOSITORY_INVALID_PAGE_LIMIT','select-range limit exceeds its declared bound.',{statementId});
      }
      if(statement.kind==='select-before-page'&&(!Number.isSafeInteger(parameters.limit)||parameters.limit<1||parameters.limit>statement.maxItems||
        !Number.isSafeInteger(parameters.offset)||parameters.offset<0)){
        fail('P3_REPOSITORY_INVALID_PAGE_LIMIT','select-before-page bounds are invalid.',{statementId});
      }
      if(['select-filtered-page','select-joined-page'].includes(statement.kind)&&(!Number.isSafeInteger(parameters.limit)||parameters.limit<1||parameters.limit>statement.maxItems||
        !Number.isSafeInteger(parameters.offset)||parameters.offset<0)){
        fail('P3_REPOSITORY_INVALID_PAGE_LIMIT','select-filtered-page bounds are invalid.',{statementId});
      }
      if (!prepared.has(statementId)) prepared.set(statementId, transaction.prepare(statement.sql));
      const executable = prepared.get(statementId);
      if (statement.safeIntegers) executable.safeIntegers(true);
      if (statement.kind === 'select-one') return executable.get(values);
      if (statement.kind === 'select-all'||statement.kind==='select-page-after'||statement.kind==='select-range'||statement.kind==='select-before-page'||statement.kind==='select-filtered-page'||statement.kind==='count-grouped'||statement.kind==='select-joined-page') return executable.all(values);
      return executable.run(values);
    }
  });
}

module.exports = Object.freeze({ RepositoryBoundaryError, bindRepository, createRepositoryDefinition });
