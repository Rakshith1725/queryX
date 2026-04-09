
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// When connection is established
pool.on('connect', () => {
  console.log('PostgreSQL connected');
});

// Handle unexpected errors
pool.on('error', (err) => {
  console.error('Unexpected PG error:', err);
});

// Test connection
try {
  await pool.query('SELECT 1');
  console.log('DB connection test successful');
} catch (err) {
  console.error('DB connection failed:', err.message);
}

export default pool;