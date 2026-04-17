import { Parser } from 'node-sql-parser';

const parser = new Parser();

export const parseSQL = (sql, dialect = 'PostgreSQL') => {
  try {
    const ast = parser.astify(sql, { database: dialect });
    return { ast, error: null };
  } catch (err) {
    return { ast: null, error: err.message };
  }
};