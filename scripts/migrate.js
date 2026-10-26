require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function runMigrations() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    console.log('Подключение к БД установлено.');

    // Создаем таблицу для учета миграций
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT now()
      );
    `);

    const sqlDir = path.join(__dirname, '..', 'sql');
    const files = fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const checkRes = await client.query('SELECT id FROM migrations WHERE name = $1', [file]);
      if (checkRes.rowCount > 0) {
        console.log(`Миграция [${file}] уже применена.`);
        continue;
      }

      console.log(`Применяем миграцию [${file}]...`);
      const sqlQuery = fs.readFileSync(path.join(sqlDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sqlQuery);
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Успешно применена: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Ошибка в [${file}]:`, err.message);
        process.exit(1);
      }
    }
    console.log('Все миграции применены');
  } catch (error) {
    console.error('Ошибка:', error.message);
  } finally {
    await client.end();
  }
}

runMigrations();