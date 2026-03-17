'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/trainingshub.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      trainer TEXT,
      type TEXT NOT NULL DEFAULT 'training',
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 60,
      location TEXT,
      max_participants INTEGER DEFAULT 20,
      price REAL DEFAULT 0,
      currency TEXT DEFAULT 'EUR',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      training_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, training_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (training_id) REFERENCES trainings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS billing_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      company TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      country TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'invoice',
      iban TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      training_id INTEGER NOT NULL,
      access_granted INTEGER NOT NULL DEFAULT 0,
      granted_by INTEGER,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, training_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (training_id) REFERENCES trainings(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by) REFERENCES users(id)
    );
  `);

  // Seed default admin user if none exists
  const adminExists = database.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    database.prepare(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
    ).run('Administrator', 'admin@trainingshub.local', hash, 'admin');

    // Seed some sample trainings
    const adminId = database.prepare('SELECT id FROM users WHERE role = ?').get('admin').id;
    const sampleTrainings = [
      {
        title: 'Introduction to Cloud Computing',
        description: 'Learn the fundamentals of cloud computing, including IaaS, PaaS and SaaS models.',
        trainer: 'John Smith',
        type: 'webinar',
        date: '2026-04-10',
        time: '10:00',
        duration_minutes: 90,
        location: 'Online (Zoom)',
        max_participants: 50,
        price: 0,
        currency: 'EUR',
      },
      {
        title: 'Agile Project Management',
        description: 'A comprehensive hands-on training on Agile methodologies, Scrum and Kanban.',
        trainer: 'Maria Müller',
        type: 'training',
        date: '2026-04-15',
        time: '09:00',
        duration_minutes: 480,
        location: 'Conference Room A',
        max_participants: 15,
        price: 299,
        currency: 'EUR',
      },
      {
        title: 'Cybersecurity Awareness',
        description: 'Understand the latest cybersecurity threats and best practices to protect your organization.',
        trainer: 'Sarah Connor',
        type: 'webinar',
        date: '2026-04-22',
        time: '14:00',
        duration_minutes: 60,
        location: 'Online (Teams)',
        max_participants: 100,
        price: 49,
        currency: 'EUR',
      },
    ];
    const insertTraining = database.prepare(
      'INSERT INTO trainings (title, description, trainer, type, date, time, duration_minutes, location, max_participants, price, currency, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const t of sampleTrainings) {
      insertTraining.run(t.title, t.description, t.trainer, t.type, t.date, t.time, t.duration_minutes, t.location, t.max_participants, t.price, t.currency, adminId);
    }
  }
}

module.exports = { getDb, initializeDatabase };
