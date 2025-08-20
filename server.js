// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ফর্ম ডেটা পড়ার জন্য

app.use(express.static('public')); // client ফাইল সার্ভ করবে

const server = http.createServer(app);

// cors options: production-এ specific origin লিখবে
const io = new Server(server, {
  cors: { origin: '*' }
});

// ================= Access Code System =================
const ACCESS_CODE = "12345"; // 👉 এখানে তোমার সিক্রেট কোড লিখো

// হোমপেজে কোড চাইবে
app.get("/", (req, res) => {
  res.send(`
    <form method="POST" action="/login" style="text-align:center;margin-top:50px;">
      <input type="password" name="code" placeholder="Enter Access Code" required />
      <button type="submit">Enter</button>
    </form>
  `);
});

// কোড চেক
app.post("/login", (req, res) => {
  if (req.body.code === ACCESS_CODE) {
    res.sendFile(path.join(__dirname, "index.html")); // সঠিক হলে secure.html লোড করবে
  } else {
    res.send("<h2 style='color:red;text-align:center;'>❌ Wrong Code! Access Denied.</h2>");
  }
});

// ================= Socket.IO Part =================
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

// ================= Run Server =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
