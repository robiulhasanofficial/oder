// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cookie = require('cookie'); // for socket handshake cookie parsing

const app = express();

// Config: Change env var in production if you don't want the password hard-coded.
const SITE_PASSWORD = process.env.SITE_PASSWORD || '664249';

// Middleware
app.use(cors()); // production-এ origin সীমাবদ্ধ করো
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // login form support
app.use(cookieParser());

// ----------------------
// Routes that must be public: /login (GET/POST)
// ----------------------
app.get('/login', (req, res) => {
  // simple login page (you can replace with your own)
  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>Login</title>
        <style>
          body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f7f7f7;margin:0}
          form{background:#fff;padding:24px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.08);width:320px}
          input{width:100%;padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:6px}
          button{width:100%;padding:10px;border:0;border-radius:6px;background:#111;color:#fff;font-weight:600}
          .hint{font-size:13px;color:#666;margin-bottom:8px}
        </style>
      </head>
      <body>
        <form method="POST" action="/login">
          <div class="hint">Enter site password to continue</div>
          <input name="password" type="password" placeholder="Password" required />
          <button type="submit">Login</button>
        </form>
      </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const pw = (req.body && (req.body.password || req.body.pw)) || '';
  if (pw === SITE_PASSWORD) {
    // set httpOnly cookie (simple approach). For production, use signed cookie/session.
    res.cookie('site_auth', SITE_PASSWORD, {
      httpOnly: true,
      sameSite: 'lax',
      // secure: true, // enable in production (HTTPS)
      maxAge: 1000 * 60 * 60 * 24 // 1 day
    });
    return res.redirect('/'); // logged in -> go to root
  }
  return res.status(401).send('Invalid password');
});

// ----------------------
// HTTP (Express) password middleware
// ----------------------
function checkPasswordHttp(req, res, next) {
  try {
    // Allow the login page and assets under /login to be accessed without password
    if (req.path && req.path.startsWith('/login')) return next();

    // header: x-site-password  অথবা Authorization: Bearer <pw>
    const headerPw = req.get('x-site-password') ||
      (req.get('authorization') ? req.get('authorization').split(' ')[1] : null);

    // query: ?pw=664249  অথবা ?password=664249
    const queryPw = req.query.pw || req.query.password;

    // cookie: site_auth
    const cookiePw = req.cookies && req.cookies.site_auth;

    if (headerPw === SITE_PASSWORD || queryPw === SITE_PASSWORD || cookiePw === SITE_PASSWORD) {
      return next();
    }

    // If not authorized, send 401 and a helpful message (browser will show it).
    res.status(401).send('Unauthorized — visit /login or provide ?pw=YOUR_PASSWORD or header x-site-password or Authorization: Bearer <pw>');
  } catch (e) {
    console.error('password middleware error', e);
    res.status(500).send('Server error');
  }
}

// apply password middleware BEFORE serving static files / routes that should be protected
app.use(checkPasswordHttp);

// serve static files (only accessible when password provided)
app.use(express.static('public'));

// ----------------------
// Server + Socket.IO
// ----------------------
const server = http.createServer(app);

// cors options for socket.io (prod: restrict origins)
const io = new Server(server, {
  cors: { origin: '*' }
});

// Socket.IO authentication middleware (handshake)
// Accepts: socket.handshake.auth.password, query pw, header x-site-password, or cookie site_auth
io.use((socket, next) => {
  try {
    const authPw = (socket.handshake.auth && socket.handshake.auth.password) ||
                   socket.handshake.query.pw ||
                   socket.handshake.query.password ||
                   (socket.handshake.headers && socket.handshake.headers['x-site-password']) ||
                   (socket.handshake.headers && socket.handshake.headers.authorization ? socket.handshake.headers.authorization.split(' ')[1] : null);

    // parse cookie from handshake headers (if present)
    const cookiesHeader = socket.handshake.headers && socket.handshake.headers.cookie;
    const parsedCookies = cookiesHeader ? cookie.parse(cookiesHeader) : {};
    const cookiePw = parsedCookies && parsedCookies.site_auth;

    if (authPw === SITE_PASSWORD || cookiePw === SITE_PASSWORD) {
      return next();
    }

    const err = new Error('Unauthorized');
    err.data = { message: 'Invalid site password' };
    next(err);
  } catch (e) {
    console.error('socket auth error', e);
    next(new Error('Server error'));
  }
});

// Simple in-memory store (restart এ হারাবে)
let lastFull = { list: [], lastUpdated: 0 };

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  socket.on('orders:hello', (data) => {
    try {
      if (lastFull.lastUpdated > (data.lastUpdated || 0)) {
        socket.emit('orders:full', lastFull);
      }
    } catch (e) { console.error(e); }
  });

  socket.on('orders:sync', (payload) => {
    try {
      if (payload.lastUpdated && payload.lastUpdated > lastFull.lastUpdated) {
        lastFull = { list: payload.list || [], lastUpdated: payload.lastUpdated };
      }
      socket.broadcast.emit('orders:sync', payload);
    } catch (e) { console.error(e); }
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
