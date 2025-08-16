// server.js
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // index.html সার্ভ করার জন্য

// ডাটাবেস (সাধারণ ইন-মেমরি লিস্ট — প্রয়োজনে MongoDB ব্যবহার করতে পারেন)
let orders = [];

// ===== REST API =====

// সব অর্ডার দেখা
app.get("/orders", (req, res) => {
  res.json(orders);
});

// নতুন অর্ডার তৈরি
app.post("/orders", (req, res) => {
  const order = { ...req.body, id: Date.now().toString() };
  orders.unshift(order);
  io.emit("order:created", order);
  res.status(201).json(order);
});

// অর্ডার আপডেট
app.put("/orders/:id", (req, res) => {
  const { id } = req.params;
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  orders[idx] = { ...orders[idx], ...req.body, id };
  io.emit("order:updated", orders[idx]);
  res.json(orders[idx]);
});

// অর্ডার ডিলিট
app.delete("/orders/:id", (req, res) => {
  const { id } = req.params;
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const deleted = orders.splice(idx, 1)[0];
  io.emit("order:deleted", deleted);
  res.status(204).end();
});

// ===== Socket.io =====
io.on("connection", (socket) => {
  console.log("ক্লায়েন্ট কানেক্টেড:", socket.id);
  socket.on("disconnect", () => {
    console.log("ক্লায়েন্ট ডিসকানেক্টেড:", socket.id);
  });
});

// ===== Start Server =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server চলছে http://localhost:${PORT}`);
});
