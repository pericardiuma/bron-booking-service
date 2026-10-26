
require('dotenv').config();
const logger = require('./logger);
const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const db = require('./db');

const authRouter = require('./routes/auth');
const resourcesRouter = require('./routes/resources');
const bookingsRouter = require('./routes/bookings');
const adminRouter = require('./routes/admin');
const { authenticate } = require('./middleware/auth');

const app = express();

app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  req.traceId = randomUUID();
  res.setHeader('X-Trace-Id', req.traceId);
  next();
});

// Сначала явно задаём стартовую страницу и страницу приложения.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(express.static(path.join(__dirname, '../public')));

app.get('/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready', database: 'connected' });
  } catch (error) {
    console.error('Проверка готовности не пройдена:', error.message);

    res.status(503).json({
      status: 'not_ready',
      message: 'База данных временно недоступна'
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/admin', adminRouter);

app.get('/api', (req, res) => {
  res.json({
    name: 'Бронь без конфликтов',
    version: '1.0.0'
  });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'route_not_found',
    message: 'Маршрут не найден',
    traceId: req.traceId
  });
});

app.use((error, req, res, next) => {
   logger.error({
    traceId: req.traceId,
    message: error.message,
    code: error.code,
    stack: error.stack
  });

  const status = Number.isInteger(error.status) ? error.status : 500;

  res.status(status).json({
    error: error.code || 'internal_error',
    message: status === 500
      ? 'Внутренняя ошибка сервера'
      : error.message,
    traceId: req.traceId
  });
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Сервер запущен: http://localhost:${port}`);
});
