const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Не задана переменная DATABASE_URL');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

pool.on('error', (error) => {
  console.error('Ошибка свободного соединения PostgreSQL:', error.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
