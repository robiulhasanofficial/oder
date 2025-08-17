// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Config: Change env var in production if you don't want the password hard-coded.
const SITE_PASSWORD = process.env.SITE_PASSWORD || '664249';

// CORS (production-এ origin সীমাবদ্ধ করো)
app.use(cors()); 
app.use(express.json());

// ----------------------
// HTTP (Express) password middleware
// ----------------------
function checkPasswordHttp(req, res, next) {
  try {
    // পাসওয়ার্ড চেক করার জায়গা: header বা query
    // header: x-site-password  অথবা Authorization: Bearer <pw>
    const headerPw = req.get('x-site-password') ||
      (req.get('authorization') ? req.get('authorization').split(' ')[1] : null);

    // query: ?pw=664249  অথবা ?password=664249
    const queryPw = req.query.pw || req.query.password;

    if (headerPw === SITE_PASSWORD || queryPw === SITE_PASSWORD) {
      return next();
    }

    // OPTIONAL: allow a simple health check without password (uncomment if needed)
    // if (req.path === '/health') return res.send({ ok: true });

    // block if no correct password
    res.status(401).send('Unauthorized — provide password via query ?pw=YOUR_PASSWORD or header x-site-password or Authorization: Bearer <pw>');
  } catch (e) {
    console.error('password middleware error', e);
    res.status(500).send('Server error');
  }
}

// apply password middleware BEFORE serving static files / routes
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
io.use((socket, next) => {
  try {
    // Try multiple places: socket.handshake.auth (recommended), query, or headers
    const authPw = (socket.handshake.auth && socket.handshake.auth.password) ||
                   socket.handshake.query.pw ||
                   socket.handshake.query.password ||
                   socket.handshake.headers['x-site-password'] ||
                   (socket.handshake.headers['authorization'] ? socket.handshake.headers['authorization'].split(' ')[1] : null);

    if (authPw === SITE_PASSWORD) {
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
