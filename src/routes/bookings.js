
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { createBooking } = require('../services/booking-service');

const router = express.Router();

router.use(authenticate);

router.post('/', async (req, res, next) => {
  try {
    const result = await createBooking({
      userId: req.user.id,
      input: req.body,
      idempotencyKey: req.get('Idempotency-Key'),
      traceId: req.traceId
    });

    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/my', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT b.id, b.resource_id, r.name AS resource_name,
              b.start_at, b.end_at, b.purpose, b.status,
              b.created_at, b.cancelled_at
       FROM bookings b
       JOIN resources r ON r.id = b.resource_id
       WHERE b.user_id = $1
       ORDER BY b.start_at DESC`,
      [req.user.id]
    );

    res.json({ bookings: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'invalid_booking_id',
        message: 'Некорректный идентификатор бронирования'
      });
    }

    const result = await db.query(
      `SELECT b.*, r.name AS resource_name
       FROM bookings b
       JOIN resources r ON r.id = b.resource_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [id, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'booking_not_found',
        message: 'Бронирование не найдено'
      });
    }

    res.json({ booking: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'invalid_booking_id',
        message: 'Некорректный идентификатор бронирования'
      });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `SELECT *
       FROM bookings
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, req.user.id]
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'booking_not_found',
        message: 'Бронирование не найдено'
      });
    }

    const booking = result.rows[0];

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
      [id, req.user.id, 'Отмена пользователем']
    );

    await client.query(
      `INSERT INTO audit_events
         (actor_id, action, object_type, object_id, result, trace_id)
       VALUES ($1, 'booking.cancelled', 'booking', $2, 'success', $3)`,
      [req.user.id, String(id), req.traceId]
    );

    await client.query('COMMIT');

    res.json({ booking: updated.rows[0] });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
