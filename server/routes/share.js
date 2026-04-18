import express from 'express';
import db from '../db/index.js';

const router = express.Router();

// POST /api/share
router.post('/', async (req, res, next) => {
  const { queryId, userId } = req.body;

  if (!queryId) {
    return res.status(400).json({ error: 'queryId required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO shared_reports (query_id, created_by)
       VALUES ($1, $2)
       RETURNING share_token, expires_at`,
      [queryId, userId || null]
    );

    const { share_token, expires_at } = result.rows[0];

    res.json({
      shareUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/share/${share_token}`,
      shareToken: share_token,
      expiresAt: expires_at,
    });

  } catch (err) {
    next(err);
  }
});

// GET /api/share/
router.get('/:token', async (req, res, next) => {
  try {
    const report = await db.query(
      `SELECT sr.*, qh.raw_query, qh.cost_score, qh.execution_plan, qh.execution_time_ms
       FROM shared_reports sr
       JOIN query_history qh ON qh.id = sr.query_id
       WHERE sr.share_token = $1
         AND sr.is_public = true
         AND sr.expires_at > NOW()`,
      [req.params.token]
    );

    if (!report.rows[0]) {
      return res.status(404).json({ error: 'Report not found or expired' });
    }

    // increment view count
    await db.query(
      `UPDATE shared_reports
       SET view_count = view_count + 1
       WHERE share_token = $1`,
      [req.params.token]
    );

    const nodes = await db.query(
      `SELECT * FROM execution_plan_nodes WHERE query_id = $1`,
      [report.rows[0].query_id]
    );

    res.json({
      report: report.rows[0],
      planNodes: nodes.rows,
    });

  } catch (err) {
    next(err);
  }
});

export default router;