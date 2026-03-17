'use strict';

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /trainings - Overview of all trainings
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { type, search } = req.query;

  let query = `
    SELECT t.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.training_id = t.id AND r.status != 'cancelled') AS registered_count
    FROM trainings t
    WHERE 1=1
  `;
  const params = [];

  if (type && ['training', 'webinar'].includes(type)) {
    query += ' AND t.type = ?';
    params.push(type);
  }
  if (search) {
    query += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.trainer LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  query += ' ORDER BY t.date ASC, t.time ASC';

  const trainings = db.prepare(query).all(...params);

  // For each training, check if current user is registered
  const userId = req.session.userId;
  const userRegistrations = db.prepare(
    'SELECT training_id, status FROM registrations WHERE user_id = ?'
  ).all(userId);
  const registrationMap = {};
  for (const reg of userRegistrations) {
    registrationMap[reg.training_id] = reg.status;
  }

  res.render('trainings/index', {
    title: 'Trainings Overview',
    trainings,
    registrationMap,
    type: type || '',
    search: search || '',
  });
});

// GET /trainings/new - Create new training (admin)
router.get('/new', requireAuth, requireAdmin, (req, res) => {
  res.render('trainings/form', { title: 'New Training', training: null });
});

// POST /trainings - Store new training (admin)
router.post('/', requireAuth, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('type').isIn(['training', 'webinar']).withMessage('Invalid type'),
  body('date').isDate().withMessage('Valid date required'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('Valid time required (HH:MM)'),
  body('max_participants').isInt({ min: 1 }).withMessage('Max participants must be a positive integer'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
  body('duration_minutes').isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map(e => e.msg).join(', '));
    return res.redirect('/trainings/new');
  }

  const { title, description, trainer, type, date, time, duration_minutes, location, max_participants, price, currency } = req.body;
  const db = getDb();

  db.prepare(`
    INSERT INTO trainings (title, description, trainer, type, date, time, duration_minutes, location, max_participants, price, currency, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description || '', trainer || '', type, date, time, parseInt(duration_minutes), location || '', parseInt(max_participants), parseFloat(price), currency || 'EUR', req.session.userId);

  req.flash('success', 'Training created successfully.');
  res.redirect('/trainings');
});

// GET /trainings/:id - Detail view
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const training = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.training_id = t.id AND r.status != 'cancelled') AS registered_count
    FROM trainings t WHERE t.id = ?
  `).get(req.params.id);

  if (!training) {
    req.flash('error', 'Training not found.');
    return res.redirect('/trainings');
  }

  const userRegistration = db.prepare(
    'SELECT * FROM registrations WHERE user_id = ? AND training_id = ?'
  ).get(req.session.userId, training.id);

  const userAccess = db.prepare(
    'SELECT * FROM user_access WHERE user_id = ? AND training_id = ?'
  ).get(req.session.userId, training.id);

  // Admin: get list of registrations
  let registrations = [];
  if (req.session.userRole === 'admin') {
    registrations = db.prepare(`
      SELECT r.*, u.name, u.email FROM registrations r
      JOIN users u ON u.id = r.user_id
      WHERE r.training_id = ?
      ORDER BY r.registered_at
    `).all(training.id);
  }

  res.render('trainings/detail', {
    title: training.title,
    training,
    userRegistration,
    userAccess,
    registrations,
  });
});

// GET /trainings/:id/edit - Edit training (admin)
router.get('/:id/edit', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const training = db.prepare('SELECT * FROM trainings WHERE id = ?').get(req.params.id);
  if (!training) {
    req.flash('error', 'Training not found.');
    return res.redirect('/trainings');
  }
  res.render('trainings/form', { title: 'Edit Training', training });
});

// POST /trainings/:id - Update training (admin)
router.post('/:id', requireAuth, requireAdmin, [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('type').isIn(['training', 'webinar']).withMessage('Invalid type'),
  body('date').isDate().withMessage('Valid date required'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('Valid time required (HH:MM)'),
  body('max_participants').isInt({ min: 1 }).withMessage('Max participants must be a positive integer'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
  body('duration_minutes').isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map(e => e.msg).join(', '));
    return res.redirect(`/trainings/${req.params.id}/edit`);
  }

  const { title, description, trainer, type, date, time, duration_minutes, location, max_participants, price, currency } = req.body;
  const db = getDb();

  const result = db.prepare(`
    UPDATE trainings SET title=?, description=?, trainer=?, type=?, date=?, time=?, duration_minutes=?, location=?, max_participants=?, price=?, currency=?
    WHERE id=?
  `).run(title, description || '', trainer || '', type, date, time, parseInt(duration_minutes), location || '', parseInt(max_participants), parseFloat(price), currency || 'EUR', req.params.id);

  if (result.changes === 0) {
    req.flash('error', 'Training not found.');
    return res.redirect('/trainings');
  }

  req.flash('success', 'Training updated successfully.');
  res.redirect(`/trainings/${req.params.id}`);
});

// POST /trainings/:id/delete - Delete training (admin)
router.post('/:id/delete', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM trainings WHERE id = ?').run(req.params.id);
  req.flash('success', 'Training deleted.');
  res.redirect('/trainings');
});

// POST /trainings/:id/register - Register current user for training
router.post('/:id/register', requireAuth, (req, res) => {
  const db = getDb();
  const training = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.training_id = t.id AND r.status != 'cancelled') AS registered_count
    FROM trainings t WHERE t.id = ?
  `).get(req.params.id);

  if (!training) {
    req.flash('error', 'Training not found.');
    return res.redirect('/trainings');
  }

  if (training.registered_count >= training.max_participants) {
    req.flash('error', 'This training is fully booked.');
    return res.redirect(`/trainings/${req.params.id}`);
  }

  const existing = db.prepare(
    'SELECT * FROM registrations WHERE user_id = ? AND training_id = ?'
  ).get(req.session.userId, training.id);

  if (existing && existing.status !== 'cancelled') {
    req.flash('error', 'You are already registered for this training.');
    return res.redirect(`/trainings/${req.params.id}`);
  }

  if (existing && existing.status === 'cancelled') {
    db.prepare("UPDATE registrations SET status = 'pending', registered_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
  } else {
    db.prepare(
      "INSERT INTO registrations (user_id, training_id, status) VALUES (?, ?, 'pending')"
    ).run(req.session.userId, training.id);
  }

  req.flash('success', 'Successfully registered for the training!');
  res.redirect(`/trainings/${req.params.id}`);
});

// POST /trainings/:id/cancel - Cancel registration
router.post('/:id/cancel', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare(
    "UPDATE registrations SET status = 'cancelled' WHERE user_id = ? AND training_id = ?"
  ).run(req.session.userId, req.params.id);
  req.flash('success', 'Registration cancelled.');
  res.redirect(`/trainings/${req.params.id}`);
});

// POST /trainings/:id/registration/:regId/status - Update registration status (admin)
router.post('/:id/registration/:regId/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
    req.flash('error', 'Invalid status.');
    return res.redirect(`/trainings/${req.params.id}`);
  }
  const db = getDb();
  db.prepare('UPDATE registrations SET status = ? WHERE id = ? AND training_id = ?').run(status, req.params.regId, req.params.id);
  req.flash('success', 'Registration status updated.');
  res.redirect(`/trainings/${req.params.id}`);
});

module.exports = router;
