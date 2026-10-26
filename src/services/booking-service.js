
const crypto = require('crypto');
const { DateTime } = require('luxon');
const db = require('../db');

function validateBookingInput(input) {
  const resourceId = Number(input.resourceId);
  const purpose =
    typeof input.purpose === 'string' ? input.purpose.trim() : '';

  if (!Number.isSafeInteger(resourceId) || resourceId < 1) {
    throw Object.assign(new Error('Некорректный ресурс'), {
      status: 400,
      code: 'invalid_resource'
    });
  }

  if (!purpose || purpose.length > 500) {
    throw Object.assign(new Error('Укажи цель бронирования до 500 символов'), {
      status: 400,
      code: 'invalid_purpose'
    });
  }

  const start = DateTime.fromISO(input.startAt, { setZone: true });
  const end = DateTime.fromISO(input.endAt, { setZone: true });

  if (
    !start.isValid ||
    !end.isValid ||
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(input.startAt || '') ||
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(input.endAt || '')
  ) {
    throw Object.assign(
      new Error('Укажи корректные дату и время с часовым смещением'),
      { status: 400, code: 'invalid_datetime' }
    );
  }

  const startUtc = start.toUTC();
  const endUtc = end.toUTC();
  const durationMinutes = endUtc.diff(startUtc, 'minutes').minutes;

  if (durationMinutes < 30 || durationMinutes > 240) {
    throw Object.assign(
      new Error('Длительность должна быть от 30 минут до 4 часов'),
      { status: 400, code: 'invalid_duration' }
    );
  }

  const startMoscow = startUtc.setZone('Europe/Moscow');
  const endMoscow = endUtc.setZone('Europe/Moscow');
  const now = DateTime.utc();

  if (startUtc <= now || startUtc > now.plus({ days: 30 })) {
    throw Object.assign(
      new Error('Начало должно быть в будущем, не позднее 30 суток'),
      { status: 400, code: 'invalid_start_time' }
    );
  }

  if (
    startMoscow.toISODate() !== endMoscow.toISODate() ||
    startMoscow.hour < 8 ||
    endMoscow.hour > 22 ||
    (endMoscow.hour === 22 && endMoscow.minute > 0) ||
    startMoscow.hour > 22 ||
    (startMoscow.hour === 22 && startMoscow.minute > 0)
  ) {
    throw Object.assign(
      new Error('Бронь должна целиком помещаться в день с 08:00 до 22:00 по Москве'),
      { status: 400, code: 'outside_working_hours' }
    );
  }

  if (
    startMoscow.minute % 30 !== 0 ||
    startMoscow.second !== 0 ||
    startMoscow.millisecond !== 0 ||
    endMoscow.minute % 30 !== 0 ||
    endMoscow.second !== 0 ||
    endMoscow.millisecond !== 0
  ) {
    throw Object.assign(
      new Error('Начало и окончание должны быть на границе 30-минутного шага'),
      { status: 400, code: 'invalid_time_step' }
    );
  }

  return {
    resourceId,
    purpose,
    startAt: startUtc.toISO(),
    endAt: endUtc.toISO()
  };
}

function hashPayload(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

async function createBooking({ userId, input, idempotencyKey, traceId }) {
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 128
  ) {
    throw Object.assign(
      new Error('Требуется заголовок Idempotency-Key длиной 8–128 символов'),
      { status: 400, code: 'invalid_idempotency_key' }
    );
  }

  const payload = validateBookingInput(input);
  const requestHash = hashPayload(payload);
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const keyInsert = await client.query(
      `INSERT INTO idempotency_keys
         (user_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [userId, idempotencyKey, requestHash]
    );

    if (keyInsert.rowCount === 0) {
      const saved = await client.query(
        `SELECT request_hash, booking_id
         FROM idempotency_keys
         WHERE user_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [userId, idempotencyKey]
      );

      const previous = saved.rows[0];

      if (!previous || previous.request_hash !== requestHash) {
        await client.query('ROLLBACK');
        throw Object.assign(
          new Error('Этот ключ уже использован с другими данными'),
          { status: 409, code: 'idempotency_key_conflict' }
        );
      }

      if (!previous.booking_id) {
        await client.query('ROLLBACK');
        throw Object.assign(
          new Error('Не удалось получить результат предыдущего запроса'),
          { status: 409, code: 'idempotency_result_unavailable' }
        );
      }

      const existing = await client.query(
        'SELECT * FROM bookings WHERE id = $1',
        [previous.booking_id]
      );

      await client.query('COMMIT');

      return { booking: existing.rows[0], replayed: true };
    }

    const resource = await client.query(
      `SELECT id, is_active
       FROM resources
       WHERE id = $1
       FOR UPDATE`,
      [payload.resourceId]
    );

    if (!resource.rowCount) {
      throw Object.assign(new Error('Ресурс не найден'), {
        status: 404,
        code: 'resource_not_found'
      });
    }

    if (!resource.rows[0].is_active) {
      throw Object.assign(new Error('Ресурс отключён'), {
        status: 409,
        code: 'resource_disabled'
      });
    }

    const result = await client.query(
      `INSERT INTO bookings
         (resource_id, user_id, start_at, end_at, purpose)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        payload.resourceId,
        userId,
        payload.startAt,
        payload.endAt,
        payload.purpose
      ]
    );

    const booking = result.rows[0];

    await client.query(
      `UPDATE idempotency_keys
       SET booking_id = $3
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey, booking.id]
    );

    await client.query(
      `INSERT INTO audit_events
         (actor_id, action, object_type, object_id, result, trace_id)
       VALUES ($1, 'booking.created', 'booking', $2, 'success', $3)`,
      [userId, String(booking.id), traceId]
    );

    await client.query('COMMIT');

    return { booking, replayed: false };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    if (error.code === '23P01') {
      throw Object.assign(
        new Error('Это время уже занято для выбранного ресурса'),
        { status: 409, code: 'booking_conflict' }
      );
    }

    if (error.code === '23503') {
      throw Object.assign(new Error('Связанный пользователь или ресурс не найден'), {
        status: 409,
        code: 'reference_conflict'
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createBooking };
