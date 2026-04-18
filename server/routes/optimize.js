import express from 'express';
import db from '../db/index.js';
import { detectRegression } from '../services/regressionDetector.js';
import { scoreAndAnnotate } from '../services/costScorer.js';
import { parseSQL } from '../services/parser.js';

const router = express.Router();

// POST 
router.post('/', async (req, res, next) => {
  const { sql, dialect = 'postgresql', issues = [], queryId } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'SQL is required' });
  }

  try {
    // Basic validation
    validateSQL(sql);

    const prompt = buildPrompt(sql, dialect, issues);

    // AI call
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      throw new Error(`AI API failed: ${aiRes.status}`);
    }

    const aiData  = await aiRes.json();
    const rawText = aiData.content?.[0]?.text || '';
    const parsed  = parseAIResponse(rawText);

    let regressionResult = null;

    // Validate AI SQL before execution
    if (parsed.optimizedSQL) {
      validateSQL(parsed.optimizedSQL);
    }

    // Start transaction
    await db.query('BEGIN');

    if (parsed.optimizedSQL && queryId) {
      try {
        // Get original cost
        const orig = await db.query(
          `SELECT cost_score FROM query_history WHERE id = $1`,
          [queryId]
        );
        const originalCost = orig.rows[0]?.cost_score;

        // Safe execution settings
        await db.query(`SET LOCAL statement_timeout = 5000`);

        const rewrittenPlan = await db.query(
          `EXPLAIN (FORMAT JSON) ${parsed.optimizedSQL}`
        );

        const rewrittenPlanJson = rewrittenPlan.rows[0]['QUERY PLAN'][0];
        const { costScore: rewrittenCost } = scoreAndAnnotate(rewrittenPlanJson);

        regressionResult = detectRegression(originalCost, rewrittenCost);

      } catch (rErr) {
        console.warn('Regression check skipped:', rErr.message);
      }
    }

    // Save suggestion
    if (queryId) {
      await db.query(
        `INSERT INTO optimization_suggestions
         (query_id, original_snippet, rewritten_snippet, explanation,
          estimated_improvement, actual_improvement_pct, regression_flag, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ai')`,
        [
          queryId,
          sql,
          parsed.optimizedSQL,
          parsed.explanation,
          parsed.estimatedGain,
          regressionResult?.deltaPct ?? null,
          regressionResult?.verdict === 'regression',
        ]
      );
    }

    await db.query('COMMIT');

    res.json({ ...parsed, regression: regressionResult });

  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    next(err);
  }
});


//  SQL Validation 

function validateSQL(sql) {
  // Block multiple statements
  if (sql.includes(';')) {
    throw new Error('Multiple statements not allowed');
  }

 
  const forbidden = ['drop', 'truncate', 'alter', 'grant', 'revoke'];
  const lower = sql.toLowerCase();

  if (forbidden.some(k => lower.includes(k))) {
    throw new Error('Dangerous query detected');
  }

  // AST validation
  const { error } = parseSQL(sql, 'PostgreSQL');
  if (error) {
    throw new Error('Invalid SQL');
  }
}


//Helpers

function buildPrompt(sql, dialect, issues) {
  return `You are a PostgreSQL expert. Analyze and rewrite this SQL query.

Dialect: ${dialect}
Detected issues: ${issues.length ? issues.join(', ') : 'none pre-detected'}

Rules:
- Do NOT change query semantics
- Avoid destructive queries (DELETE, DROP, etc.)
- Prefer index usage
- Keep output deterministic

Original SQL:
${sql}

Return ONLY valid JSON:
{
  "optimizedSQL": "...",
  "explanation": "...",
  "improvements": ["..."],
  "estimatedGain": "..."
}`;
}

function parseAIResponse(text) {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      optimizedSQL: null,
      explanation: text,
      improvements: [],
      estimatedGain: null,
    };
  }
}

export default router;