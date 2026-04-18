import { Parser } from 'node-sql-parser';

const parser = new Parser();

// Generate query fingerprint
export function getFingerprint(sql) {
  try {
    // Replace string literals
    let fp = sql.replace(/'[^']*'/g, '?');

    // Replace numeric literals
    fp = fp.replace(/\b\d+(\.\d+)?\b/g, '?');

    // Normalize whitespace + lowercase
    fp = fp.replace(/\s+/g, ' ').trim().toLowerCase();

    return fp;
  } catch {
    return sql.trim().toLowerCase();
  }
}

export async function findSimilarQueries(db, sql, currentQueryId) {
  const fp = getFingerprint(sql);

  const result = await db.query(
    `SELECT id, raw_query, cost_score, created_at
     FROM query_history
     WHERE id != $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [currentQueryId]
  );

  const similar = result.rows.filter(
    row => getFingerprint(row.raw_query) === fp
  );

  return {
    fingerprint: fp,
    similarQueries: similar,
    avgCostScore: similar.length
      ? parseFloat(
          (
            similar.reduce((s, r) => s + (r.cost_score || 0), 0) /
            similar.length
          ).toFixed(2)
        )
      : null,
  };
}