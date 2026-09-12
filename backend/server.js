/**
 * SentinelGate — OTP delivery backend
 * -----------------------------------
 * A minimal Express server that generates a one-time code server-side,
 * emails it to the user with Nodemailer, and verifies it on request.
 * The code is NEVER sent back to the browser — that's the whole point.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.static(path.join(__dirname, '..')));
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

transporter.verify((err) => {
  if (err) {
    console.warn('⚠️  Email transport not ready:', err.message);
    console.warn('   Check GMAIL_USER / GMAIL_APP_PASSWORD in your .env file.');
  } else {
    console.log('✅  Email transport ready — real OTP emails can be sent.');
  }
});

// Serve the front-end (index.html, style.css, script.js) from this same server.
// This means once deployed, there's ONE public URL for everything — no separate
// front-end hosting needed, and no cross-origin issues since it's all one origin.
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 4000;

/* ============================================================
   SUPABASE MIRROR (optional — db.json remains the primary store;
   this just also pushes users/resources up to Supabase so you
   have a real cloud database copy too)
   ============================================================ */
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY)
  : null;

if (supabase) {
  console.log('✅  Supabase configured — users & resources will be read from and saved to Supabase (db.json is kept as an automatic backup).');
} else {
  console.log('ℹ️   Supabase not configured (SUPABASE_URL/SUPABASE_SERVICE_KEY missing in .env) — using db.json only.');
}



async function syncToSupabase(state) {
  if (!supabase) return;
  try {
    const dedupeById = (arr) => {
      const map = new Map();
      arr.forEach(item => map.set(item.id, item));
      return [...map.values()];
    };

    const userRows = dedupeById(state.users).map(u => ({
      id: u.id, username: u.username, password: u.password, role: u.role,
      name: u.name, email: u.email, status: u.status, created_via: u.createdVia,
    }));
    const resourceRows = dedupeById(state.resources).map(r => ({
      id: r.id, name: r.name, sensitivity: r.sensitivity, roles: r.roles,
      require_trusted_device: r.requireTrustedDevice, require_mfa: r.requireMFA,
    }));
    const { error: userErr } = await supabase.from('users').upsert(userRows);
    if (userErr) console.warn('Supabase users sync warning:', userErr.message);
    const { error: resErr } = await supabase.from('resources').upsert(resourceRows);
    if (resErr) console.warn('Supabase resources sync warning:', resErr.message);
  } catch (err) {
    console.warn('Supabase sync failed (db.json is unaffected):', err.message);
  }
}

/* ============================================================
   PERSISTENT DATABASE (plain JSON file — no native modules,
   no extra installs, survives server restarts)
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const SEED_STATE = {
  users: [
    { id: 1, username: 'admin', password: 'Admin@123', role: 'Admin', name: 'Alex Morgan', email: 'alex.morgan@college.edu', status: 'Active', createdVia: 'seed' },
    { id: 2, username: 'faculty', password: 'Faculty@123', role: 'Faculty', name: 'Dr. Priya Nair', email: 'priya.nair@college.edu', status: 'Active', createdVia: 'seed' },
    { id: 3, username: 'student', password: 'Student@123', role: 'Student', name: 'Rahul Dev', email: 'rahul.dev@college.edu', status: 'Active', createdVia: 'seed' },
  ],
  resources: [
    { id: 1, name: 'Student Records Database', sensitivity: 'High', roles: ['Admin', 'Faculty'], requireTrustedDevice: true, requireMFA: true },
    { id: 2, name: 'Grade Management System', sensitivity: 'High', roles: ['Admin', 'Faculty'], requireTrustedDevice: true, requireMFA: true },
    { id: 3, name: 'My Academic Profile', sensitivity: 'Low', roles: ['Admin', 'Faculty', 'Student'], requireTrustedDevice: false, requireMFA: false },
    { id: 4, name: 'Library Portal', sensitivity: 'Low', roles: ['Admin', 'Faculty', 'Student'], requireTrustedDevice: false, requireMFA: false },
    { id: 5, name: 'Finance & Admin Console', sensitivity: 'Critical', roles: ['Admin'], requireTrustedDevice: true, requireMFA: true },
    { id: 6, name: 'HR Records', sensitivity: 'Critical', roles: ['Admin'], requireTrustedDevice: true, requireMFA: true },
  ],
  logs: [], // activity logs — now saved to and loaded from db.json, same as everything else
  alerts: [],
  accessRequests: [],
  academicRecords: {
    student: { rollNo: 'CS21B045', program: 'B.Sc. Computer Science', semester: '6th', cgpa: '8.4',
      attendance: '91%', courses: [
        { name: 'Data Structures', grade: 'A' }, { name: 'Operating Systems', grade: 'A-' },
        { name: 'Database Systems', grade: 'B+' }, { name: 'Computer Networks', grade: 'A' }
      ] }
  },
  nextUserId: 4,
  nextLogId: 1,
  nextReqId: 1,
  nextAlertId: 1,
};

function loadState() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(SEED_STATE, null, 2));
      console.log('Created new database at', DB_PATH);
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (err) {
    console.error('Failed to load database, falling back to seed data in memory:', err.message);
    return { ...SEED_STATE };
  }
}

function saveState(state) {
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

app.get('/api/state', async (req, res) => {
  // db.json always provides the baseline (alerts, access requests, academic profiles, id counters).
  const localState = loadState();

  // If Supabase is configured, it becomes the source of truth for users & resources —
  // but if the read fails for any reason (no internet, wrong keys, Supabase down),
  // we silently keep using what's already in db.json instead of breaking the app.
  if (supabase) {
    try {
      const { data: users, error: usersErr } = await supabase.from('users').select('*');
      const { data: resources, error: resErr } = await supabase.from('resources').select('*');
      if (usersErr) throw usersErr;
      if (resErr) throw resErr;
      if (users && users.length) {
        localState.users = users.map(u => ({
          id: u.id, username: u.username, password: u.password, role: u.role,
          name: u.name, email: u.email, status: u.status, createdVia: u.created_via,
        }));
      }
      if (resources && resources.length) {
        localState.resources = resources.map(r => ({
          id: r.id, name: r.name, sensitivity: r.sensitivity, roles: r.roles,
          requireTrustedDevice: r.require_trusted_device, requireMFA: r.require_mfa,
        }));
      }
    } catch (err) {
      console.warn('Supabase read failed — falling back to db.json for users/resources:', err.message);
    }
  }

  res.json(localState);
});

app.post('/api/state', (req, res) => {
  const incoming = req.body || {};
  // Basic shape check so a malformed request can't corrupt the file.
  if (!Array.isArray(incoming.users) || !Array.isArray(incoming.resources)) {
    return res.status(400).json({ success: false, error: 'Invalid state payload' });
  }
  saveState(incoming);           // db.json — always happens, this is the safety net
  syncToSupabase(incoming);      // Supabase — the real primary store when configured, fire-and-forget
  res.json({ success: true, savedAt: new Date().toISOString() });
});
const OTP_TTL_MS = 30 * 1000;      // code expires after 30 seconds
const MAX_ATTEMPTS = 5;            // guesses allowed before the code is invalidated

// In-memory store: email -> { code, expiresAt, attempts }
// A real production system would use Redis or a database with TTL instead.
const otpStore = new Map();

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

 

app.post('/api/send-otp', async (req, res) => {
  const { email, username } = req.body || {};
  if (!email) return res.status(400).json({ success: false, error: 'email is required' });

  const code = generateCode();
  otpStore.set(email, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });

  try {
    await transporter.sendMail({
      from: `"SentinelGate" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Your SentinelGate verification code',
      text: `Hi ${username || ''},\n\nYour one-time verification code is: ${code}\nIt expires in 30 seconds.\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hi ${username || ''},</p>
             <p>Your one-time verification code is:</p>
             <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
             <p>It expires in 30 seconds. If you did not request this, you can ignore this email.</p>`,
    });
    console.log(`OTP sent to ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to send OTP email:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send email' });
  }
});

app.post('/api/verify-otp', (req, res) => {
  const { email, code } = req.body || {};
  const entry = otpStore.get(email);

  if (!entry) return res.json({ success: false, reason: 'No code was requested for this email' });
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email);
    return res.json({ success: false, reason: 'Code expired' });
  }
  entry.attempts += 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    otpStore.delete(email);
    return res.json({ success: false, reason: 'Too many attempts' });
  }
  if (entry.code !== code) {
    return res.json({ success: false, reason: 'Incorrect code' });
  }

  otpStore.delete(email); // one-time use — delete once verified
  res.json({ success: true });
});

app.get('/', (req, res) => res.send('SentinelGate OTP backend is running.'));

app.listen(PORT, () => console.log(`SentinelGate OTP backend listening on http://localhost:${PORT}`));