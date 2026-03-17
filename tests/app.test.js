'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Set in-memory test database
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

before(async () => {
  const app = require('../app');
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function request(method, path, body, cookieStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const bodyStr = body ? new URLSearchParams(body).toString() : undefined;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function extractSetCookie(headers) {
  const cookies = headers['set-cookie'];
  if (!cookies) return '';
  return cookies.map(c => c.split(';')[0]).join('; ');
}

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : '';
}

// Helper: get a page's CSRF token using an existing cookie session
async function getCsrfToken(path, cookie) {
  const res = await request('GET', path, undefined, cookie);
  return extractCsrfToken(res.body);
}

describe('Authentication', () => {
  test('Login page is accessible', async () => {
    const res = await request('GET', '/auth/login');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Login'));
  });

  test('Register page is accessible', async () => {
    const res = await request('GET', '/auth/register');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Create Account'));
  });

  test('Root redirects unauthenticated users to login', async () => {
    const res = await request('GET', '/');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('/auth/login') || res.headers.location === '/auth/login');
  });

  test('Admin login succeeds with correct credentials', async () => {
    const loginPage = await request('GET', '/auth/login');
    const cookie = extractSetCookie(loginPage.headers);
    const csrf = extractCsrfToken(loginPage.body);
    const res = await request('POST', '/auth/login', {
      email: 'admin@trainingshub.local',
      password: 'admin123',
      _csrf: csrf,
    }, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    assert.ok(res.headers['set-cookie'], 'Session cookie should be set');
  });

  test('Login fails with wrong password', async () => {
    const loginPage = await request('GET', '/auth/login');
    const cookie = extractSetCookie(loginPage.headers);
    const csrf = extractCsrfToken(loginPage.body);
    const res = await request('POST', '/auth/login', {
      email: 'admin@trainingshub.local',
      password: 'wrongpassword',
      _csrf: csrf,
    }, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/login');
  });

  test('Register creates a new user', async () => {
    const regPage = await request('GET', '/auth/register');
    const cookie = extractSetCookie(regPage.headers);
    const csrf = extractCsrfToken(regPage.body);
    const res = await request('POST', '/auth/register', {
      name: 'Test User',
      email: 'testuser@example.com',
      password: 'password123',
      confirmPassword: 'password123',
      _csrf: csrf,
    }, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
  });

  test('Register rejects mismatched passwords', async () => {
    const regPage = await request('GET', '/auth/register');
    const cookie = extractSetCookie(regPage.headers);
    const csrf = extractCsrfToken(regPage.body);
    const res = await request('POST', '/auth/register', {
      name: 'Test User',
      email: 'testuser2@example.com',
      password: 'password123',
      confirmPassword: 'different456',
      _csrf: csrf,
    }, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/register');
  });

  test('Register rejects duplicate email', async () => {
    const regPage = await request('GET', '/auth/register');
    const cookie = extractSetCookie(regPage.headers);
    const csrf = extractCsrfToken(regPage.body);
    const res = await request('POST', '/auth/register', {
      name: 'Duplicate',
      email: 'admin@trainingshub.local',
      password: 'password123',
      confirmPassword: 'password123',
      _csrf: csrf,
    }, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/auth/register');
  });

  test('POST without CSRF token is rejected', async () => {
    const res = await request('POST', '/auth/login', {
      email: 'admin@trainingshub.local',
      password: 'admin123',
    });
    assert.equal(res.status, 403);
  });
});

// Helper to log in and return session cookie
async function loginAs(email, password) {
  const loginPage = await request('GET', '/auth/login');
  const cookie = extractSetCookie(loginPage.headers);
  const csrf = extractCsrfToken(loginPage.body);
  const res = await request('POST', '/auth/login', { email, password, _csrf: csrf }, cookie);
  const newCookie = extractSetCookie(res.headers) || cookie;
  return newCookie;
}

describe('Trainings (authenticated)', () => {
  let cookie;

  before(async () => {
    cookie = await loginAs('admin@trainingshub.local', 'admin123');
  });

  test('Trainings overview accessible after login', async () => {
    const res = await request('GET', '/trainings', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Trainings Overview'));
  });

  test('Training detail page is accessible', async () => {
    const res = await request('GET', '/trainings/1', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Introduction to Cloud Computing'));
  });

  test('Non-existent training returns redirect', async () => {
    const res = await request('GET', '/trainings/9999', undefined, cookie);
    assert.equal(res.status, 302);
  });

  test('Admin can access new training form', async () => {
    const res = await request('GET', '/trainings/new', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Create New Training'));
  });

  test('Admin can create a training', async () => {
    const csrf = await getCsrfToken('/trainings/new', cookie);
    const res = await request('POST', '/trainings', {
      title: 'Test Training',
      type: 'training',
      date: '2026-05-01',
      time: '09:00',
      duration_minutes: '60',
      max_participants: '10',
      price: '0',
      currency: 'EUR',
      _csrf: csrf,
    }, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/trainings');
  });
});

describe('Calendar (authenticated)', () => {
  let cookie;

  before(async () => {
    cookie = await loginAs('admin@trainingshub.local', 'admin123');
  });

  test('Calendar page is accessible', async () => {
    const res = await request('GET', '/calendar', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('My Training Calendar'));
  });

  test('Calendar supports month/year navigation', async () => {
    const res = await request('GET', '/calendar?month=4&year=2026', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('April 2026'));
  });
});

describe('Billing (authenticated)', () => {
  let cookie;

  before(async () => {
    cookie = await loginAs('admin@trainingshub.local', 'admin123');
  });

  test('Billing page is accessible', async () => {
    const res = await request('GET', '/billing', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Billing Information'));
  });

  test('Billing edit page is accessible', async () => {
    const res = await request('GET', '/billing/edit', undefined, cookie);
    assert.equal(res.status, 200);
  });

  test('Can save billing information', async () => {
    const csrf = await getCsrfToken('/billing/edit', cookie);
    const res = await request('POST', '/billing', {
      full_name: 'Test User',
      address: '123 Test St',
      city: 'Berlin',
      zip_code: '10115',
      country: 'Germany',
      payment_method: 'invoice',
      _csrf: csrf,
    }, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/billing');
  });
});

describe('Admin routes', () => {
  let cookie;

  before(async () => {
    cookie = await loginAs('admin@trainingshub.local', 'admin123');
  });

  test('Admin dashboard is accessible', async () => {
    const res = await request('GET', '/admin', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Admin Dashboard'));
  });

  test('Admin users list is accessible', async () => {
    const res = await request('GET', '/admin/users', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Manage Users'));
  });

  test('Admin registrations list is accessible', async () => {
    const res = await request('GET', '/admin/registrations', undefined, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('All Registrations'));
  });
});

describe('Access control', () => {
  let userCookie;

  before(async () => {
    // Register a regular user
    const regPage = await request('GET', '/auth/register');
    const regCookie = extractSetCookie(regPage.headers);
    const csrf = extractCsrfToken(regPage.body);
    await request('POST', '/auth/register', {
      name: 'Regular User',
      email: 'regular@example.com',
      password: 'password123',
      confirmPassword: 'password123',
      _csrf: csrf,
    }, regCookie);
    userCookie = await loginAs('regular@example.com', 'password123');
  });

  test('Regular user cannot access admin dashboard', async () => {
    const res = await request('GET', '/admin', undefined, userCookie);
    assert.equal(res.status, 302);
    assert.notEqual(res.headers.location, '/admin');
  });

  test('Regular user cannot create trainings', async () => {
    const res = await request('GET', '/trainings/new', undefined, userCookie);
    assert.equal(res.status, 302);
  });

  test('Unauthenticated access to trainings redirects to login', async () => {
    const res = await request('GET', '/trainings');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('/auth/login') || res.headers.location === '/auth/login');
  });
});
