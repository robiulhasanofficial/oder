// server.js (complete patched)
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();

// === Env / config ===
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace_this_in_prod';
let PASSWORD_HASH = process.env.PASSWORD_HASH || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// DEV fallback: if DEV_PLAIN_PASSWORD is set, auto-generate a hash (dev only)
if(!PASSWORD_HASH && process.env.DEV_PLAIN_PASSWORD){
  console.warn('WARNING: Using DEV_PLAIN_PASSWORD to auto-generate PASSWORD_HASH — dev only!');
  PASSWORD_HASH = bcrypt.hashSync(String(process.env.DEV_PLAIN_PASSWORD), 10);
}

// === middlewares ===
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// allow credentials for cross-origin cookie transport if needed
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// session middleware (MemoryStore) - replace with Redis/Mongo in production
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: (process.env.NODE_ENV === 'production'),
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // default 1 day
  }
});
app.use(sessionMiddleware);

// --- Login page (GET) ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'), err => {
    if(err){
      res.send(`
        <!doctype html><html><head><meta charset="utf-8"><title>Login</title></head>
        <body>
          <h3>অ্যাপ খুলতে পাসওয়ার্ড দিন</h3>
          <form method="POST" action="/login">
            <input name="password" type="password" required />
            <label><input type="checkbox" name="remember" /> Remember this device</label>
            <button type="submit">লগইন</button>
          </form>
        </body></html>
      `);
    }
  });
});

// --- Login POST ---
app.post('/login', async (req, res) => {
  const { password, remember } = req.body;
  if(!password) return res.status(400).send('Password required');
  if(!PASSWORD_HASH) {
    console.error('PASSWORD_HASH not set!');
    return res.status(500).send('Server not configured for authentication');
  }
  const ok = await bcrypt.compare(String(password), String(PASSWORD_HASH));
  if(!ok){
    if(req.headers.accept && req.headers.accept.indexOf('html') > -1) {
      return res.status(401).send('Invalid password');
    }
    return res.status(401).json({ error: 'Invalid password' });
  }

  // success
  req.session.isAuth = true;
  req.session.user = 'admin';
  if(remember === 'on' || remember === 'true' || remember === true){
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  } else {
    req.session.cookie.expires = false;
  }

  if(req.headers.accept && req.headers.accept.indexOf('html') > -1) {
    return res.redirect('/');
  }
  res.json({ ok: true });
});

// --- Logout ---
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('connect.sid');
    if(err) console.warn('session destroy err', err);
    if(req.headers.accept && req.headers.accept.indexOf('html') > -1) {
      return res.redirect('/login');
    }
    return res.json({ ok: true });
  });
});

// --- requireAuth middleware ---
function requireAuth(req, res, next){
  if(req.session && req.session.isAuth) return next();
  if(req.accepts('html')) return res.redirect('/login');
  return res.status(401).json({ error: 'Unauthorized' });
}

// Allow /login and /logout public; protect everything after this
app.use((req, res, next) => {
  if(req.path === '/login' || req.path === '/logout' || req.path.startsWith('/public/login')) return next();
  return requireAuth(req, res, next);
});

// Serve static files (protected)
app.use(express.static(path.join(__dirname, 'public')));

// Protected API route for client auth-check
app.get('/api/secret', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

// === Socket.IO setup ===
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, credentials: true }
});

// share session with socket
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

let lastFull = { list: [], lastUpdated: 0 };

io.on('connection', (socket) => {
  const req = socket.request;
  if(!req.session || !req.session.isAuth){
    console.log('unauthorized socket connection - disconnecting', socket.id);
    socket.disconnect(true);
    return;
  }
  console.log('socket connected (auth):', socket.id);

  socket.on('orders:hello', (data) => {
    try {
      if(lastFull.lastUpdated > (data.lastUpdated || 0)){
        socket.emit('orders:full', lastFull);
      }
    } catch(e){ console.error(e); }
  });

  socket.on('orders:sync', (payload) => {
    try {
      if(payload && payload.lastUpdated && payload.lastUpdated > lastFull.lastUpdated){
        lastFull = { list: payload.list || [], lastUpdated: payload.lastUpdated };
      }
      socket.broadcast.emit('orders:sync', payload);
    } catch(e){ console.error(e); }
  });

  socket.on('disconnect', ()=> {
    console.log('socket disconnected:', socket.id);
  });
});

server.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));
