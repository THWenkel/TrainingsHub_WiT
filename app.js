'use strict';

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { csrfSync } = require('csrf-sync');
const { initializeDatabase } = require('./src/config/database');
const { setLocals } = require('./src/middleware/auth');

// Initialize database
initializeDatabase();

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'trainingshub-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Flash messages
app.use(flash());

// Local variables for views (must be before CSRF so errors have access to currentUser)
app.use(setLocals);

// CSRF protection
const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.body._csrf || req.headers['x-csrf-token'],
});
app.use(csrfSynchronisedProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = generateToken(req);
  next();
});

// Rate limiting for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);

// General API rate limit
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);

// Routes
app.use('/auth', require('./src/routes/auth'));
app.use('/trainings', require('./src/routes/trainings'));
app.use('/calendar', require('./src/routes/calendar'));
app.use('/billing', require('./src/routes/billing'));
app.use('/admin', require('./src/routes/admin'));

// Home route
app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  res.redirect('/trainings');
});

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN' || err.name === 'ForbiddenError') {
    return res.status(403).render('error', {
      title: 'Request Forbidden',
      message: 'Invalid or expired form token. Please go back and try again.',
      status: 403,
    });
  }
  next(err);
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { title: 'Page Not Found', message: 'The page you are looking for does not exist.', status: 404 });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Server Error', message: 'An unexpected error occurred.', status: 500 });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`TrainingsHub running on http://localhost:${PORT}`);
    console.log('Default admin: admin@trainingshub.local / admin123');
  });
}

module.exports = app;
