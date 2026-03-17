'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /admin - Admin dashboard
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const trainingCount = db.prepare('SELECT COUNT(*) AS count FROM trainings').get().count;
  const registrationCount = db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE status != 'cancelled'").get().count;
  const pendingCount = db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE status = 'pending'").get().count;

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    stats: { userCount, trainingCount, registrationCount, pendingCount },
  });
});

// GET /admin/users - List all users
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.user_id = u.id AND r.status != 'cancelled') AS registration_count
    FROM users u
    ORDER BY u.created_at DESC
  `).all();

  res.render('admin/users', { title: 'Manage Users', users });
});

// GET /admin/users/:id - User detail and access management
router.get('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  const registrations = db.prepare(`
    SELECT r.*, t.title, t.date, t.time, t.type
    FROM registrations r
    JOIN trainings t ON t.id = r.training_id
    WHERE r.user_id = ?
    ORDER BY t.date DESC
  `).all(req.params.id);

  const allTrainings = db.prepare('SELECT * FROM trainings ORDER BY date ASC').all();
  const userAccessList = db.prepare('SELECT * FROM user_access WHERE user_id = ?').all(req.params.id);
  const accessMap = {};
  for (const a of userAccessList) {
    accessMap[a.training_id] = a.access_granted;
  }

  res.render('admin/user-detail', {
    title: `User: ${user.name}`,
    user,
    registrations,
    allTrainings,
    accessMap,
  });
});

// POST /admin/users/:id/role - Update user role
router.post('/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    req.flash('error', 'Invalid role.');
    return res.redirect(`/admin/users/${req.params.id}`);
  }
  // Prevent removing own admin access
  if (parseInt(req.params.id) === req.session.userId) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect(`/admin/users/${req.params.id}`);
  }
  const db = getDb();
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  req.flash('success', 'User role updated.');
  res.redirect(`/admin/users/${req.params.id}`);
});

// POST /admin/users/:id/delete - Delete user
router.post('/users/:id/delete', requireAuth, requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    req.flash('error', 'You cannot delete your own account.');
    return res.redirect('/admin/users');
  }
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  req.flash('success', 'User deleted.');
  res.redirect('/admin/users');
});

// POST /admin/users/:id/access - Grant/revoke access to training
router.post('/users/:id/access', requireAuth, requireAdmin, (req, res) => {
  const { training_id, access_granted } = req.body;
  if (!training_id) {
    req.flash('error', 'Training ID required.');
    return res.redirect(`/admin/users/${req.params.id}`);
  }

  const db = getDb();
  const granted = access_granted === '1' ? 1 : 0;
  const existing = db.prepare('SELECT id FROM user_access WHERE user_id = ? AND training_id = ?').get(req.params.id, training_id);

  if (existing) {
    db.prepare('UPDATE user_access SET access_granted = ?, granted_by = ?, granted_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(granted, req.session.userId, existing.id);
  } else {
    db.prepare('INSERT INTO user_access (user_id, training_id, access_granted, granted_by) VALUES (?, ?, ?, ?)')
      .run(req.params.id, training_id, granted, req.session.userId);
  }

  req.flash('success', `Access ${granted ? 'granted' : 'revoked'} successfully.`);
  res.redirect(`/admin/users/${req.params.id}`);
});

// GET /admin/registrations - All pending registrations
router.get('/registrations', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { status } = req.query;
  let query = `
    SELECT r.*, u.name AS user_name, u.email AS user_email, t.title AS training_title, t.date, t.time, t.type
    FROM registrations r
    JOIN users u ON u.id = r.user_id
    JOIN trainings t ON t.id = r.training_id
    WHERE 1=1
  `;
  const params = [];
  if (status && ['pending', 'confirmed', 'cancelled'].includes(status)) {
    query += ' AND r.status = ?';
    params.push(status);
  }
  query += ' ORDER BY r.registered_at DESC';
  const registrations = db.prepare(query).all(...params);
  res.render('admin/registrations', {
    title: 'All Registrations',
    registrations,
    statusFilter: status || '',
  });
});

// POST /admin/registrations/:id/status - Update registration status
router.post('/registrations/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
    req.flash('error', 'Invalid status.');
    return res.redirect('/admin/registrations');
  }
  const db = getDb();
  db.prepare('UPDATE registrations SET status = ? WHERE id = ?').run(status, req.params.id);
  req.flash('success', 'Registration status updated.');
  res.redirect('/admin/registrations');
});

module.exports = router;
