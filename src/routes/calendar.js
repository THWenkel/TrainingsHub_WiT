'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /calendar - Show user's training calendar
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { month, year } = req.query;

  const now = new Date();
  const targetYear = parseInt(year) || now.getFullYear();
  const targetMonth = parseInt(month) || now.getMonth() + 1;

  const firstDay = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(targetYear, targetMonth, 0);
  const lastDayStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

  // Registered trainings for the user in this month
  const registrations = db.prepare(`
    SELECT t.*, r.status AS reg_status
    FROM registrations r
    JOIN trainings t ON t.id = r.training_id
    WHERE r.user_id = ? AND r.status != 'cancelled'
      AND t.date >= ? AND t.date <= ?
    ORDER BY t.date ASC, t.time ASC
  `).all(userId, firstDay, lastDayStr);

  // All registrations for list view (not just this month)
  const allRegistrations = db.prepare(`
    SELECT t.*, r.status AS reg_status
    FROM registrations r
    JOIN trainings t ON t.id = r.training_id
    WHERE r.user_id = ? AND r.status != 'cancelled'
    ORDER BY t.date ASC, t.time ASC
  `).all(userId);

  // Build calendar data
  const calendarDays = [];
  const firstWeekday = new Date(targetYear, targetMonth - 1, 1).getDay();
  const daysInMonth = lastDay.getDate();

  // Previous month padding
  for (let i = 0; i < firstWeekday; i++) {
    calendarDays.push(null);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEvents = registrations.filter(r => r.date === dateStr);
    calendarDays.push({ day: d, date: dateStr, events: dayEvents });
  }

  const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1;
  const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear;
  const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1;
  const nextYear = targetMonth === 12 ? targetYear + 1 : targetYear;

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  res.render('calendar/index', {
    title: 'My Training Calendar',
    calendarDays,
    allRegistrations,
    targetYear,
    targetMonth,
    monthName: monthNames[targetMonth - 1],
    prevMonth,
    prevYear,
    nextMonth,
    nextYear,
    today: now.toISOString().split('T')[0],
  });
});

module.exports = router;
