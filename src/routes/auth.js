
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { login, password } = req.body || {};

    if (
      typeof login !== 'string' ||
      typeof password !== 'string' ||
      !login.trim() ||
      !password
    ) {
      return res.status(400).json({
        error: 'invalid_credentials',
        message: 'Введи логин и пароль'
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error('Не задан JWT_SECRET');

      return res.status(500).json({
        error: 'auth_not_configured',
        message: 'Авторизация не настроена'
      });
    }

    const result = await db.query(
      `SELECT id, display_name, role, password_hash
       FROM app_users
       WHERE login = $1`,
      [login.trim().toLowerCase()]
    );

    if (!result.rowCount) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Неверный логин или пароль'
      });
    }

    const user = result.rows[0];

    if (
      typeof user.password_hash !== 'string' ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Неверный логин или пароль'
      });
    }

    const accessToken = jwt.sign(
      {
        name: user.display_name
      },
      process.env.JWT_SECRET,
      {
        algorithm: 'HS256',
        subject: String(user.id),
        expiresIn: '2h'
      }
    );

    return res.json({
      accessToken,
      user: {
        id: user.id,
        display_name: user.display_name,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
