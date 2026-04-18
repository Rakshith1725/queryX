import express from 'express';
import db from '../db/index.js';

const router = express.Router();

// GET 
router.get('/', async (req, res, next) => {
  const { userId, limit = 20, offset = 0 } = req.query;

  try {
    const result = await db.query(
      `SELECT
         qh.id, qh.raw_query, qh.dialect, qh.cost_score,
         qh.execution_time_ms, qh.query_hash, qh.created_at,
         COUNT(qs.id) AS suggestion_count
       FROM query_history qh
       LEFT JOIN optimization_suggestions qs ON qs.query_id = qh.id
       WHERE ($1::uuid IS NULL OR qh.user_id = $1)
       GROUP BY qh.id
       ORDER BY qh.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId || null, Number(limit), Number(offset)]
    );

    res.json({ queries: result.rows });

  } catch (err) {
    next(err);
  }
});

// GET 
router.get('/:id', async (req, res, next) => {
  try {
    const [query, nodes, indexSuggestions, optimizations] = await Promise.all([
      db.query(`SELECT * FROM query_history WHERE id = $1`, [req.params.id]),
      db.query(`SELECT * FROM execution_plan_nodes WHERE query_id = $1 ORDER BY created_at`, [req.params.id]),
      db.query(`SELECT * FROM index_suggestions WHERE query_id = $1`, [req.params.id]),
      db.query(`SELECT * FROM optimization_suggestions WHERE query_id = $1`, [req.params.id]),
    ]);

    if (!query.rows[0]) {
      return res.status(404).json({ error: 'Query not found' });
    }

    res.json({
      query: query.rows[0],
      planNodes: nodes.rows,
      indexSuggestions: indexSuggestions.rows,
      optimizations: optimizations.rows,
    });

  } catch (err) {
    next(err);
  }
});

export default router;