
const express = require('express');
const db = require('../db');
const {
  authenticate,
  requireAdmin
} = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireAdmin);

// Все ресурсы, включая отключённые.
router.get('/resources', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, name, description, location, is_active, created_at
      FROM resources
      ORDER BY name, id
    `);

    res.json({ resources: result.rows });
  } catch (error) {
    next(error);
  }
});

// Создание ресурса.
router.post('/resources', async (req, res, next) => {
  try {
    const name =
      typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const description =
      typeof req.body.description === 'string'
        ? req.body.description.trim()
        : '';
    const location =
      typeof req.body.location === 'string'
        ? req.body.location.trim()
        : '';

    if (!name || name.length > 200) {
      return res.status(400).json({
        error: 'invalid_name',
        message: 'Название обязательно и не должно превышать 200 символов'
      });
    }

    if (description.length > 1000 || location.length > 300) {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'Слишком длинное описание или местоположение'
      });
    }

    // Не создаём активный ресурс с уже существующим названием.
    const existing = await db.query(
      `SELECT id FROM resources
       WHERE lower(trim(name)) = lower($1)
       LIMIT 1`,
      [name]
    );

    if (existing.rowCount) {
      return res.status(409).json({
        error: 'resource_exists',
        message: 'Ресурс с таким названием уже существует'
      });
    }

    const result = await db.query(
      `INSERT INTO resources (name, description, location)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, description, location]
    );

    await db.query(
      `INSERT INTO audit_events
         (actor_id, action, object_type, object_id, result, trace_id)
       VALUES ($1, 'resource.created', 'resource', $2, 'success', $3)`,
      [req.user.id, String(result.rows[0].id), req.traceId || null]
    );

    res.status(201).json({ resource: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Включение или отключение ресурса.
router.patch('/resources/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { isActive } = req.body;

    if (!Number.isSafeInteger(id) || id < 1 ||
        typeof isActive !== 'boolean') {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'Нужен корректный ID и булево поле isActive'
      });
    }

    const result = await db.query(
      `UPDATE resources
       SET is_active = $2
       WHERE id = $1
       RETURNING *`,
      [id, isActive]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'resource_not_found',
        message: 'Ресурс не найден'
      });
    }

    await db.query(
      `INSERT INTO audit_events
         (actor_id, action, object_type, object_id, result, trace_id)
       VALUES ($1, $2, 'resource', $3, 'success', $4)`,
      [
        req.user.id,
        isActive ? 'resource.enabled' : 'resource.disabled',
        String(id),
        req.traceId || null
      ]
    );

    res.json({ resource: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Все бронирования с необязательными фильтрами.
router.get('/bookings', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];

    if (req.query.status &&
        ['active', 'cancelled'].includes(req.query.status)) {
      params.push(req.query.status);
      conditions.push(`b.status = $${params.length}`);
    }

    if (req.query.resourceId) {
      const resourceId = Number(req.query.resourceId);

      if (!Number.isSafeInteger(resourceId) || resourceId < 1) {
        return res.status(400).json({
          error: 'invalid_resource_id',
          message: 'Некорректный ID ресурса'
        });
      }

      params.push(resourceId);
      conditions.push(`b.resource_id = $${params.length}`);
    }

    if (req.query.dateFrom) {
      params.push(req.query.dateFrom);
      conditions.push(`b.start_at >= $${params.length}::date`);
    }

    if (req.query.dateTo) {
      params.push(req.query.dateTo);
      conditions.push(`b.start_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const result = await db.query(
      `SELECT
         b.id, b.resource_id, r.name AS resource_name,
         b.user_id, u.display_name AS user_name,
         b.start_at, b.end_at, b.purpose, b.status,
         b.created_at, b.cancelled_at, b.cancelled_by,
         b.cancellation_reason
       FROM bookings b
       JOIN resources r ON r.id = b.resource_id
       LEFT JOIN app_users u ON u.id = b.user_id
       ${where}
       ORDER BY b.start_at DESC
       LIMIT 500`,
      params
    );

    res.json({ bookings: result.rows });
  } catch (error) {
    next(error);
  }
});

// Администратор отменяет будущее бронирование с обязательной причиной.
router.post('/bookings/:id/cancel', async (req, res, next) => {
  let client;

  try {
    const id = Number(req.params.id);
    const reason =
      typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'invalid_booking_id',
        message: 'Некорректный ID бронирования'
      });
    }

    if (reason.length < 5 || reason.length > 300) {
      return res.status(400).json({
        error: 'invalid_reason',
        message: 'Укажи причину отмены длиной от 5 до 300 символов'
      });
    }

    client = await db.pool.connect();
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT *
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'booking_not_found',
        message: 'Бронирование не найдено'
      });
    }

    const booking = found.rows[0];

    if (booking.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'booking_not_active',
        message: 'Бронирование уже отменено'
      });
    }

    if (new Date(booking.start_at) <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'booking_already_started',
        message: 'Начавшееся бронирование отменить нельзя'
      });
    }

    const updated = await client.query(
      `UPDATE bookings
       SET status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = $2,
           cancellation_reason = $3
       WHERE id = $1
       RETURNING *`,
      [id, req.user.id, reason]
    );

    await client.query(
      `INSERT INTO audit_events
         (actor_id, action, object_type, object_id, result, trace_id)
       VALUES ($1, 'booking.cancelled_by_admin', 'booking', $2, 'success', $3)`,
      [req.user.id, String(id), req.traceId || null]
    );

    await client.query('COMMIT');

    res.json({ booking: updated.rows[0] });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

// Журнал аудита.
router.get('/audit', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, occurred_at, actor_id, action,
              object_type, object_id, result, trace_id
       FROM audit_events
       ORDER BY occurred_at DESC
       LIMIT 200`
    );

    res.json({ events: result.rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
