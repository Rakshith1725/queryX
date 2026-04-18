function suggestIndexes(ast, sql) {
  const suggestions = [];

  if (!ast || !Array.isArray(ast)) {
    ast = [ast];
  }

  for (const node of ast) {
    if (!node) continue;

    const aliasMap = buildAliasMap(node);

    // ── Rule 1: WHERE 
    if (node.where) {
      const whereCols = extractWhereColumns(node.where);

      whereCols.forEach(({ table, column }) => {
        const realTable = aliasMap[table] || table;
        if (!realTable || !column)
            return;

        suggestions.push({
          table_name: realTable,
          column_name: column,
          index_type: 'btree',
          severity: 'HIGH',
          reason: `Column "${column}" used in WHERE — avoids full scan`,
          create_statement: `CREATE INDEX idx_${realTable}_${column} ON ${realTable} (${column});`,
        });
      });

     
      if (whereCols.length > 1) {
        const firstTableAlias = whereCols[0].table;
        const table = aliasMap[firstTableAlias] || firstTableAlias;

        const cols = whereCols.map(c => c.column);

        if (table && cols.length > 1) {
          suggestions.push({
            table_name: table,
            column_name: cols.join(','),
            index_type: 'btree',
            severity: 'HIGH',
            reason: 'Composite index improves multi-column filtering',
            create_statement: `CREATE INDEX idx_${table}_${cols.join('_')} ON ${table} (${cols.join(', ')});`,
          });
        }
      }
    }

    // ── Rule 2: JOIN 
    if (node.join) {
      node.join.forEach(j => {
        const joinCols = extractJoinColumns(j.on);

        joinCols.forEach(({ table, col }) => {
          const realTable = aliasMap[table] || table;
          if (!realTable || !col) return;

          suggestions.push({
            table_name: realTable,
            column_name: col,
            index_type: 'btree',
            severity: 'HIGH',
            reason: `JOIN key "${col}" — improves join performance`,
            create_statement: `CREATE INDEX idx_${realTable}_${col} ON ${realTable} (${col});`,
          });
        });
      });
    }

    // ── Rule 3: ORDER BY
    if (node.orderby) {
      const mainAlias = node.from?.[0]?.as;
      const tableName =
        aliasMap[mainAlias] || extractFirstTable(node.from);

      node.orderby.forEach(o => {
        const col = o.expr?.column;
        const dir = o.type || 'ASC';

        if (!tableName || !col) return;

        suggestions.push({
          table_name: tableName,
          column_name: col,
          index_type: 'btree',
          severity: 'MEDIUM',
          reason: `ORDER BY "${col}" — avoids filesort`,
          create_statement: `CREATE INDEX idx_${tableName}_${col}_${dir.toLowerCase()} ON ${tableName} (${col} ${dir});`,
        });
      });
    }

    // ── Rule 4: SELECT *
    if (node.columns === '*') {
      const tableName = extractFirstTable(node.from);

      suggestions.push({
        table_name: tableName || 'unknown',
        column_name: '*',
        index_type: null,
        severity: 'LOW',
        reason: 'SELECT * prevents covering indexes and increases I/O',
        create_statement: '-- Replace SELECT * with explicit columns',
      });
    }
  }

  return dedup(suggestions);
}

// ── Helpers 
function extractWhereColumns(where, cols = []) {
  if (!where) return cols;

  if (where.left?.type === 'column_ref') {
    cols.push({
      table: where.left.table,
      column: where.left.column,
    });
  }

  if (where.right?.type === 'column_ref') {
    cols.push({
      table: where.right.table,
      column: where.right.column,
    });
  }

  extractWhereColumns(where.left, cols);
  extractWhereColumns(where.right, cols);

  return cols;
}


function extractJoinColumns(on, pairs = []) {
  if (!on) return pairs;

  if (on.left?.type === 'column_ref' && on.right?.type === 'column_ref') {
    pairs.push({ table: on.left.table, col: on.left.column });
    pairs.push({ table: on.right.table, col: on.right.column });
  }

  extractJoinColumns(on.left, pairs);
  extractJoinColumns(on.right, pairs);

  return pairs;
}


function extractFirstTable(from) {
  if (!from || !from[0]) return null;
  return from[0].table || from[0].name || null;
}

function buildAliasMap(node) {
  const map = {};

  node.from?.forEach(t => {
    if (t.as) map[t.as] = t.table;
    else map[t.table] = t.table;
  });

  node.join?.forEach(j => {
    const t = j.table;
    if (t?.as) map[t.as] = t.table;
    else if (t?.table) map[t.table] = t.table;
  });

  return map;
}


function dedup(suggestions) {
  const seen = new Set();

  return suggestions.filter(s => {
    const key = `${s.table_name}:${s.column_name}:${s.index_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { suggestIndexes };

