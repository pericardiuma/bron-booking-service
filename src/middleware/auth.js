
const jwt = require('jsonwebtoken');
const db = require('../db');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const match = header && header.match(/^Bearer\s+(.+)$/);

  if (!match) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Войдите в аккаунт'
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error('Не задан JWT_SECRET');

    return res.status(500).json({
      error: 'auth_not_configured',
      message: 'Авторизация не настроена'
    });
  }

  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ['HS256']
    });

    if (typeof payload.sub !== 'string' || !payload.sub) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Некорректный токен'
      });
    }

    const result = await db.query(
      `SELECT id, display_name, role
       FROM app_users
       WHERE id = $1`,
      [payload.sub]
    );

    if (!result.rowCount) {
      return res.status(401).json({
        error: 'user_not_found',
        message: 'Пользователь не найден. Войдите снова.'
      });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (
      error.name === 'TokenExpiredError' ||
      error.name === 'JsonWebTokenError' ||
      error.name === 'NotBeforeError'
    ) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Срок действия токена истёк или токен недействителен'
      });
    }

    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Для этого действия нужны права администратора'
    });
  }

  next();
}

module.exports = { authenticate, requireAdmin };
