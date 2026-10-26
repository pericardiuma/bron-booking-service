
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, name, description, location, is_active
      FROM resources
      WHERE is_active = TRUE
      ORDER BY name
    `);

    res.json({ resources: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'invalid_resource_id',
        message: 'Некорректный идентификатор ресурса'
      });
    }

    const result = await db.query(
      `SELECT id, name, description, location, is_active
       FROM resources
       WHERE id = $1`,
      [id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'resource_not_found',
        message: 'Ресурс не найден'
      });
    }

    res.json({ resource: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
