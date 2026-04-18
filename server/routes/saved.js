import express from 'express';
import db from '../db/index.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

// POST /api/saved — bookmark a query
router.post('/', async (req, res, next) => {
  const { queryId, title, notes, folder = 'General' } = req.body;
  const userId = req.user.id;

  if (!queryId || !title) {
    return res.status(400).json({ error: 'queryId and title required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO saved_queries (user_id, query_id, title, notes, folder)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, query_id) DO UPDATE
         SET title = EXCLUDED.title, notes = EXCLUDED.notes
       RETURNING *`,
      [userId, queryId, title, notes, folder]
    );

    res.status(201).json({ saved: result.rows[0] });

  } catch (err) {
    next(err);
  }
});

// GET /api/saved — list saved queries
router.get('/', async (req, res, next) => {
  const { folder } = req.query;
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT sq.*, qh.raw_query, qh.cost_score, qh.created_at AS run_at
       FROM saved_queries sq
       JOIN query_history qh ON qh.id = sq.query_id
       WHERE sq.user_id = $1
         AND ($2::text IS NULL OR sq.folder = $2)
       ORDER BY sq.pinned DESC, sq.created_at DESC`,
      [userId, folder || null]
    );

    res.json({ saved: result.rows });

  } catch (err) {
    next(err);
  }
});

// DELETE /api/saved/:id — remove bookmark
router.delete('/:id', async (req, res, next) => {
  const userId = req.user.id;

  try {
    await db.query(
      `DELETE FROM saved_queries
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );

    res.json({ success: true });

  } catch (err) {
    next(err);
  }
});

export default router;