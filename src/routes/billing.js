'use strict';

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /billing - Show billing information
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const billing = db.prepare('SELECT * FROM billing_info WHERE user_id = ?').get(req.session.userId);
  res.render('billing/index', { title: 'Billing Information', billing });
});

// GET /billing/edit - Show billing form
router.get('/edit', requireAuth, (req, res) => {
  const db = getDb();
  const billing = db.prepare('SELECT * FROM billing_info WHERE user_id = ?').get(req.session.userId);
  res.render('billing/edit', { title: 'Edit Billing Information', billing });
});

// POST /billing - Save billing information
router.post('/', requireAuth, [
  body('full_name').trim().notEmpty().withMessage('Full name required'),
  body('address').trim().notEmpty().withMessage('Address required'),
  body('city').trim().notEmpty().withMessage('City required'),
  body('zip_code').trim().notEmpty().withMessage('ZIP code required'),
  body('country').trim().notEmpty().withMessage('Country required'),
  body('payment_method').isIn(['invoice', 'bank_transfer', 'credit_card']).withMessage('Invalid payment method'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map(e => e.msg).join(', '));
    return res.redirect('/billing/edit');
  }

  const { full_name, company, address, city, zip_code, country, payment_method, iban } = req.body;
  const db = getDb();
  const userId = req.session.userId;

  const existing = db.prepare('SELECT id FROM billing_info WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(`
      UPDATE billing_info SET full_name=?, company=?, address=?, city=?, zip_code=?, country=?, payment_method=?, iban=?, updated_at=CURRENT_TIMESTAMP
      WHERE user_id=?
    `).run(full_name, company || '', address, city, zip_code, country, payment_method, iban || '', userId);
  } else {
    db.prepare(`
      INSERT INTO billing_info (user_id, full_name, company, address, city, zip_code, country, payment_method, iban)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, full_name, company || '', address, city, zip_code, country, payment_method, iban || '');
  }

  req.flash('success', 'Billing information saved successfully.');
  res.redirect('/billing');
});

module.exports = router;
