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

// Config from env
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const CORS_ORIGIN = process.env.CORS_ORIGIN || ''; // e.g. "http://localhost:5500,https://example.com"
const isProd = process.env.NODE_ENV === 'production';

// --- parse allowed origins (comma separated) ---
let allowedOrigins = null;
if(CORS_ORIGIN){
  allowedOrigins = CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
  console.log('Allowed CORS origins:', allowedOrigins);
} else {
  // if not set, allow same-origin / all (you may want to lock this down)
  allowedOrigins = null;
  console.log('No CORS_ORIGIN set — CORS will allow all origins (consider setting CORS_ORIGIN in production).');
}

// CORS middleware options
const corsOptions = {
  origin: function(origin, callback){
    // allow requests with no origin (mobile apps, curl, server-to-server)
    if(!origin) return callback(null, true);
    if(!allowedOrigins) return callback(null, true); // allow any
    if(allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
    return callback(new Error(msg), false);
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
};

// apply cors to express
app.use(cors(corsOptions));
app.use(express.json());

// Socket.io setup — set CORS similarly
const socketCors = allowedOrigins ? { origin: allowedOrigins, methods: ['GET','POST','PUT','DELETE'] } : { origin: true, methods: ['GET','POST','PUT','DELETE'] };
const io = new Server(server, { cors: socketCors });

// Mongo connect
if(!MONGO_URI){
  console.error('MONGO_URI is not set in .env — aborting.');
  process.exit(1);
}

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

// -------------------------
// API router mounted at /api
// -------------------------
const api = express.Router();

// Health
api.get('/health', (req,res) => res.json({ ok:true, now: new Date() }));

// GET /api/orders
api.get('/orders', async (req,res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch(err) {
    console.error('GET /orders error', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders
api.post('/orders', async (req,res) => {
  try {
    const payload = req.body || {};
    if(!payload.name || !payload.orderId) return res.status(400).json({ error: 'name and orderId required' });
    const created = await Order.create(payload);
    const obj = created.toObject();
    io.emit('order:created', obj);
    res.status(201).json(obj);
  } catch(err) {
    console.error('POST /orders error', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/orders/:id
api.put('/orders/:id', async (req,res) => {
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

// DELETE /api/orders/:id
api.delete('/orders/:id', async (req,res) => {
  try {
    const id = req.params.id;
    const deleted = await Order.findByIdAndDelete(id).lean();
    if(!deleted) return res.status(404).json({ error: 'Order not found' });
    io.emit('order:deleted', String(id));
    res.json({ success: true, deletedId: String(id) });
  } catch(err) {
    console.error('DELETE /orders/:id error', err);
    res.status(500).json({ error: err.message });
  }
});

// optional helpers under /api
api.delete('/orders', async (req,res) => {
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

api.post('/orders/delete', async (req,res) => {
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

// mount API under /api
app.use('/api', api);

// Serve frontend from /public (static) — keep after /api so API takes precedence
app.use(express.static(path.join(__dirname, 'public')));

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
