// server.js (merged - session + socket.io auth + basic hardening)
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

// ======= Basic middlewares =======
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ======= CORS (allow cookies) =======
app.use(cors({
  origin: CLIENT_ORIGIN,
  credentials: true
}));

// ======= Session setup =======
// NOTE: default MemoryStore is fine for dev only. Use connect-mongo or redis in production.
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'change_this_to_a_long_random_value',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 60 * 1000, // 1 hour
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);

// If you want Mongo session store, uncomment and configure:
// const MongoStore = require('connect-mongo');
// app.use(session({
//   secret: process.env.SESSION_SECRET,
//   store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
//   resave: false,
//   saveUninitialized: false,
//   cookie: { ... }
// }));

// ======= Rate limit for login =======
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { success: false, error: 'Too many login attempts. Try later.' }
});

// ======= Simple auth middleware for protected routes =======
function authMiddleware(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

// ======= Routes =======
// POST /login
app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Missing credentials' });
  }

  // Simple ENV-based check. In production, use hashed passwords (bcrypt) & DB.
  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PASS = process.env.ADMIN_PASS;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    req.session.username = username;
    return res.json({ success: true });
  } else {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// GET /logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login.html');
  });
});

// Example protected route that returns some data
app.get('/api/protected', authMiddleware, (req, res) => {
  res.json({ success: true, msg: 'You are authenticated', user: req.session.username });
});

// ======= Socket.io setup with session sharing =======
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true
  }
});

// helper to wrap Express-style middleware for socket.io
const wrap = (middleware) => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

// Optionally only allow sockets from logged-in sessions
io.use((socket, next) => {
  const req = socket.request;
  if (req.session && req.session.loggedIn) {
    return next();
  }
  return next(new Error('unauthorized'));
});

// In-memory store for demo (restart will clear it)
let lastFull = { list: [], lastUpdated: 0 };

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id, 'user:', socket.request.session.username);

  socket.on('orders:hello', (data) => {
    try {
      if (lastFull.lastUpdated > (data.lastUpdated || 0)) {
        socket.emit('orders:full', lastFull);
      }
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('orders:sync', (payload) => {
    try {
      if (payload.lastUpdated && payload.lastUpdated > lastFull.lastUpdated) {
        lastFull = { list: payload.list || [], lastUpdated: payload.lastUpdated };
      }
      socket.broadcast.emit('orders:sync', payload);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
