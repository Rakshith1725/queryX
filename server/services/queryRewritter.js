export function rewriteQuery(sql, ast) {
  const results = [];
  let rewritten = sql;

  // Rule 1 — SELECT *
  if (/SELECT\s+\*/i.test(sql)) {
    results.push({
      rule: 'select_star',
      description: 'Replace SELECT * with explicit column names',
      severity: 'LOW',
      before: 'SELECT *',
      after: 'SELECT col1, col2, ...',
    });
  }

  // Rule 2 — redundant DISTINCT
  if (/SELECT\s+DISTINCT/i.test(sql) && !/(GROUP\s+BY|UNION)/i.test(sql)) {
    results.push({
      rule: 'redundant_distinct',
      description: 'DISTINCT without GROUP BY is often redundant and adds a sort step',
      severity: 'MEDIUM',
      before: 'SELECT DISTINCT ...',
      after: 'Consider GROUP BY or verify DISTINCT is necessary',
    });
  }

  // Rule 3 — OR → IN
  const orSameCol = sql.match(/WHERE\s+(\w+)\s*=\s*\S+\s+OR\s+\1\s*=\s*\S+/i);
  if (orSameCol) {
    results.push({
      rule: 'or_to_in',
      description: `OR conditions on same column "${orSameCol[1]}" — use IN() instead`,
      severity: 'MEDIUM',
      before: `WHERE ${orSameCol[1]} = x OR ${orSameCol[1]} = y`,
      after: `WHERE ${orSameCol[1]} IN (x, y)`,
    });

    rewritten = rewritten.replace(
      /WHERE\s+(\w+)\s*=\s*(\S+)\s+OR\s+\1\s*=\s*(\S+)/i,
      'WHERE $1 IN ($2, $3)'
    );
  }

  // Rule 4 — implicit cast
  const implicitCast = sql.match(/WHERE\s+\w+\s*=\s*'(\d+)'/i);
  if (implicitCast) {
    results.push({
      rule: 'implicit_cast',
      description: `Numeric value '${implicitCast[1]}' wrapped in quotes causes implicit cast — index may be skipped`,
      severity: 'HIGH',
      before: `= '${implicitCast[1]}'`,
      after: `= ${implicitCast[1]}`,
    });

    rewritten = rewritten.replace(`'${implicitCast[1]}'`, implicitCast[1]);
  }

  // Rule 5 — NOT IN subquery
  if (/NOT\s+IN\s*\(\s*SELECT/i.test(sql)) {
    results.push({
      rule: 'not_in_subquery',
      description: 'NOT IN with subquery is slow and fails on NULLs — rewrite as NOT EXISTS or LEFT JOIN',
      severity: 'HIGH',
      before: 'WHERE id NOT IN (SELECT id FROM ...)',
      after: 'WHERE NOT EXISTS (SELECT 1 FROM ... WHERE ...)',
    });
  }

  // Rule 6 — leading wildcard
  if (/%\w/.test(sql) && /LIKE\s+'%/i.test(sql)) {
    results.push({
      rule: 'leading_wildcard',
      description: "LIKE '%value' cannot use index — causes full scan",
      severity: 'HIGH',
      before: "LIKE '%value'",
      after: "Use full-text search or alternative indexing",
    });
  }

  return {
    rewrittenSQL: rewritten,
    rewrites: results,
  };
}