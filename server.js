// server.updated.js
// Cleaned & fixed server with session + login + socket.io
// মূলত: ডুপ্লিকেট কোড মুছে ফেলা, CORS/credentials টিকিয়ে দেওয়া, form-urlencoded সাপোর্ট যোগ, এবং invalid JSON হ্যান্ডলার যোগ করা হয়েছে।

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const session = require('express-session');

// bcrypt optional (if not installed, plain text env password fallback will be used)
let bcrypt = null;
try { bcrypt = require('bcrypt'); } catch (e) { /* bcrypt not available */ }

const app = express();

// Use CLIENT_ORIGIN env if provided, otherwise allow all (dev)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
// When credentials: true, CORS origin cannot be the string '*'. Use true to echo request origin for dev.
const corsOrigin = CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN;
app.use(cors({ origin: corsOrigin, credentials: true }));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // support HTML form posts
app.use(express.static('public'));

// Handle invalid JSON payloads gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ ok: false, error: 'invalid JSON' });
  }
  next();
});

// ====== Session setup (in-memory store - not for production) ======
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const SESSION_NAME = process.env.SESSION_NAME || 'sid';

const sessionMiddleware = session({
  name: SESSION_NAME,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: (process.env.NODE_ENV === 'production'),
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
});
app.use(sessionMiddleware);

// ====== Simple auth routes ======
// Behavior:
// - Use env ADMIN_USER and ADMIN_PASS (plain) OR ADMIN_PASSWORD_HASH (bcrypt hash)
// - If none provided, fallback to local default: admin / password (dev only)

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
// accept both ADMIN_PASS (your provided) and ADMIN_PASSWORD for compatibility
const ADMIN_PASS = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || null;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || null; // bcrypt hash

async function verifyPassword(plain) {
  if (ADMIN_PASSWORD_HASH) {
    if (!bcrypt) throw new Error('bcrypt required to verify password hash. Install bcrypt or set plain ADMIN_PASS in env.');
    return await bcrypt.compare(plain, ADMIN_PASSWORD_HASH);
  }
  if (ADMIN_PASS) {
    return plain === ADMIN_PASS;
  }
  // dev fallback (NOT FOR PRODUCTION)
  return (plain === 'password');
}

app.post('/api/login', async (req, res) => {
  try {
    // Accept either { username, password } OR { email, password } from client
    const { username, email, password } = req.body || {};
    const userField = username || email;

    if (!userField || !password) return res.status(400).json({ ok: false, error: 'missing username/password' });

    if (userField !== ADMIN_USER) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    let ok = false;
    try { ok = await verifyPassword(password); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

    if (!ok) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    // set session
    req.session.user = { username: userField };
    // optional: expose minimal user info
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

app.post('/api/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ ok: false, error: 'failed to destroy session' });
      res.clearCookie(SESSION_NAME);
      return res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

app.get('/api/session', (req, res) => {
  res.json({ ok: true, user: req.session && req.session.user ? req.session.user : null });
});

// simple middleware to protect endpoints
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ ok: false, error: 'unauthenticated' });
}

// ====== Socket.io setup (keep existing behavior) ======
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });

// share express-session with socket.io so socket.request.session is available
io.use((socket, next) => {
  try {
    sessionMiddleware(socket.request, {}, next);
  } catch (e) {
    next(e);
  }
});

// Simple in-memory store (restart এ হারাবে). পরবর্তীতে DB ব্যবহার করো।
let lastFull = { list: [], lastUpdated: 0 };

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);
  const sessUser = socket.request && socket.request.session && socket.request.session.user;
  if (sessUser) console.log('socket has session user:', sessUser.username);

  socket.on('orders:hello', (data) => {
    try {
      if (lastFull.lastUpdated > (data.lastUpdated || 0)){
        socket.emit('orders:full', lastFull);
      }
    } catch(e){ console.error(e); }
  });

  socket.on('orders:sync', (payload) => {
    try {
      if(payload.lastUpdated && payload.lastUpdated > lastFull.lastUpdated){
        lastFull = { list: payload.list || [], lastUpdated: payload.lastUpdated };
      }
      socket.broadcast.emit('orders:sync', payload);
    } catch(e){ console.error(e); }
  });

  socket.on('disconnect', ()=> {
    console.log('socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));

// ---- Notes ----
// 1) For production: use a proper session store (Redis, DB), set secure cookie when behind HTTPS,
//    and provide SESSION_SECRET environment variable. Do NOT use the default dev secret.
// 2) To use bcrypt-hashed password: set ADMIN_USER and ADMIN_PASSWORD_HASH env vars and install bcrypt.
// 3) To test locally quickly: create a .env file with the values you provided and run `node server.updated.js` (or `node server.js` if you rename it).
