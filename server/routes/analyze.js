import express from 'express';
import db from '../db/index.js';
import { parseSQL } from '../services/parser.js';
import { suggestIndexes } from '../services/indexSuggester.js';
import { scoreAndAnnotate } from '../services/costScorer.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  const { sql, dialect = 'postgresql', userId = null } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'SQL is required' });
  }

  try {
    const { ast, error: parseError } = parseSQL(sql, 'PostgreSQL');
    if (parseError) {
      return res.status(400).json({ error: `Parse error: ${parseError}` });
    }

    let planJson = null;
    let executionTimeMs = null;

    try {
      const start = Date.now();

      const planResult = await db.query(
        `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${sql}`
      );

      executionTimeMs = Date.now() - start;
      planJson = planResult.rows[0]['QUERY PLAN'][0];

    } catch (explainErr) {
      console.warn('EXPLAIN failed:', explainErr.message);
    }

    const { costScore, nodes } = planJson
      ? scoreAndAnnotate(planJson)
      : { costScore: null, nodes: [] };

    const indexSuggestions = suggestIndexes(ast, sql);

    const histResult = await db.query(
      `INSERT INTO query_history
       (user_id, raw_query, dialect, cost_score, execution_time_ms, execution_plan)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, query_hash`,
      [userId, sql, dialect, costScore, executionTimeMs, planJson]
    );

    const { id: queryId, query_hash } = histResult.rows[0];

    if (nodes.length > 0) {
      for (const node of nodes) {
        await db.query(
          `INSERT INTO execution_plan_nodes
           (id, query_id, parent_node_id, node_type, relation_name,
            total_cost, startup_cost, actual_rows, plan_rows,
            actual_loops, heat_score, node_details)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            node.id,
            queryId,
            node.parent_node_id,
            node.node_type,
            node.relation_name,
            node.total_cost,
            node.startup_cost,
            node.actual_rows,
            node.plan_rows,
            node.actual_loops,
            node.heat_score,
            node.node_details,
          ]
        );
      }
    }

    for (const s of indexSuggestions) {
      await db.query(
        `INSERT INTO index_suggestions
         (query_id, table_name, column_name, index_type, severity, reason, create_statement)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          queryId,
          s.table_name,
          s.column_name,
          s.index_type,
          s.severity,
          s.reason,
          s.create_statement,
        ]
      );
    }

    res.json({
      queryId,
      queryHash: query_hash,
      costScore,
      executionTimeMs,
      planNodes: nodes,
      indexSuggestions,
    });

  } catch (err) {
    next(err);
  }
});

export default router;