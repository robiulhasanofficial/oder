// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Socket.io সেটআপ — production-এ origin কনফিগার করুন
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET','POST','PUT','DELETE']
  }
});

// Middleware
app.use(express.json());
app.use(cors());

// Serve frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// Config
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/orders_db';

// Mongoose connect
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('✅ MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error', err); process.exit(1); });

// Schema + Model
const orderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: String,
  school: String,
  orderName: String,
  orderId: { type: String, required: true, index: true },
  amount: { type: Number, default: 0 },
  orderDateTime: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

// Health
app.get('/health', (req,res) => res.json({ ok:true, now: new Date() }));

// GET /orders
app.get('/orders', async (req,res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch(err) {
    console.error('GET /orders error', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /orders
app.post('/orders', async (req,res) => {
  try {
    const payload = req.body || {};
    if(!payload.name || !payload.orderId) return res.status(400).json({ error: 'name and orderId required' });
    const created = await Order.create(payload);
    const obj = created.toObject();
    io.emit('order:created', obj); // realtime broadcast
    res.status(201).json(obj);
  } catch(err) {
    console.error('POST /orders error', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /orders/:id
app.put('/orders/:id', async (req,res) => {
  try {
    const id = req.params.id;
    const updated = await Order.findByIdAndUpdate(id, req.body, { new: true }).lean();
    if(!updated) return res.status(404).json({ error: 'Order not found' });
    io.emit('order:updated', updated);
    res.json(updated);
  } catch(err) {
    console.error('PUT /orders/:id error', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /orders/:id
app.delete('/orders/:id', async (req,res) => {
  try {
    const id = req.params.id;
    const deleted = await Order.findByIdAndDelete(id).lean();
    if(!deleted) return res.status(404).json({ error: 'Order not found' });
    io.emit('order:deleted', String(id)); // broadcast deleted id as string
    res.json({ success: true, deletedId: String(id) });
  } catch(err) {
    console.error('DELETE /orders/:id error', err);
    res.status(500).json({ error: err.message });
  }
});

// Convenience fallback endpoints (optional but helpful)
app.delete('/orders', async (req,res) => {
  try {
    const { orderId } = req.query;
    if(!orderId) return res.status(400).json({ error: 'orderId query parameter required' });
    const deleted = await Order.findOneAndDelete({ orderId }).lean();
    if(!deleted) return res.status(404).json({ error: 'Order not found (by orderId)' });
    io.emit('order:deleted', String(deleted._id));
    res.json({ success: true, data: deleted });
  } catch(err) {
    console.error('DELETE /orders (by query) error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/orders/delete', async (req,res) => {
  try {
    const { id, orderId } = req.body || {};
    let deleted = null;
    if(id) deleted = await Order.findByIdAndDelete(id).lean();
    else if(orderId) deleted = await Order.findOneAndDelete({ orderId }).lean();
    else return res.status(400).json({ error:'provide id or orderId' });
    if(!deleted) return res.status(404).json({ error:'Order not found' });
    io.emit('order:deleted', String(deleted._id));
    res.json({ success:true, data: deleted });
  } catch(err) {
    console.error('POST /orders/delete error', err);
    res.status(500).json({ error: err.message });
  }
});

// socket connection
io.on('connection', socket => {
  console.log('🔌 socket connected', socket.id);
  socket.on('disconnect', () => console.log('❌ socket disconnected', socket.id));
});

// Fallback for SPA: serve index.html
app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// start server
server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
