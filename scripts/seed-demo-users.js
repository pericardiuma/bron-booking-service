
require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('../src/db');

async function main() {
  const users = [
    {
      id: 'a1000000-0000-4000-8000-000000000001',
      displayName: 'Демонстрационный пользователь',
      login: 'user.demo',
      password: 'UserDemo2026!',
      role: 'user'
    },
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      displayName: 'Демонстрационный администратор',
      login: 'admin.demo',
      password: 'AdminDemo2026!',
      role: 'admin'
    }
  ];

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 12);

    await db.query(
      `INSERT INTO app_users
         (id, display_name, role, login, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         login = EXCLUDED.login,
         password_hash = EXCLUDED.password_hash`,
      [
        user.id,
        user.displayName,
        user.role,
        user.login,
        passwordHash
      ]
    );

    console.log(`Создана/обновлена учётная запись: ${user.login}`);
  }

  console.log('Демонстрационные пользователи готовы.');
}

main()
  .catch((error) => {
    console.error('Не удалось создать пользователей:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
