import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';

const router = express.Router();

// helper to generate token
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id },                 
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// POST 
router.post('/register', async (req, res, next) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return next({ status: 400, message: 'All fields required' });
  }

  try {
    const emailNormalized = email.toLowerCase();

    const hash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, emailNormalized, hash]
    );

    const user = result.rows[0];
    const token = generateToken(user);

    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === '23505') {
      return next({
        status: 409,
        message: 'Email or username already exists'
      });
    }
    next(err);
  }
});

// POST 
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next({
      status: 400,
      message: 'Email and password required'
    });
  }

  try {
    const result = await db.query(
      `SELECT id, username, email, password_hash
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    const user = result.rows[0];

    if (!user) {
      return next({ status: 401, message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return next({ status: 401, message: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token
    });
  } catch (err) {
    next(err);
  }
});

export default router;