// server.js
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

// CORS: প্রয়োজনমত origin সীমাবদ্ধ করুন
app.use(cors());
app.use(express.json());

// ====================
// Config / Env
// ====================
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/orders_db";
const PORT = process.env.PORT || 3000;

// ====================
// MongoDB Connection
// ====================
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => {
  console.error("❌ MongoDB Connection Error:", err);
  process.exit(1);
});

// ====================
// Order Schema & Model
// ====================
const orderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: String,
  school: String,
  orderName: String,
  orderId: { type: String, required: true, index: true },
  amount: { type: Number, default: 0 },
  orderDateTime: { type: Date, default: Date.now },
  status: { type: String, default: "pending" }
}, { timestamps: true });

const Order = mongoose.model("Order", orderSchema);

// ====================
// Simple root health-check
// ====================
app.get("/", (req, res) => {
  res.json({ success: true, message: "Order API is running" });
});

// ====================
// API Routes (prefixed with /orders)
// ====================

// Add New Order
app.post("/orders", async (req, res) => {
  try {
    const payload = req.body;
    if(!payload.name || !payload.orderId) {
      return res.status(400).json({ success:false, message: "name এবং orderId প্রয়োজন" });
    }
    const newOrder = new Order(payload);
    await newOrder.save();
    // Important: return the created order object directly (not wrapped)
    return res.status(201).json(newOrder);
  } catch (err) {
    console.error('POST /orders error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get All Orders
app.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('GET /orders error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Order (by Mongo _id)
app.put("/orders/:id", async (req, res) => {
  try {
    const updated = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if(!updated) return res.status(404).json({ success:false, message: "Order পাওয়া যায়নি" });
    // return the updated document directly
    return res.json(updated);
  } catch (err) {
    console.error('PUT /orders/:id error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Order by Mongo _id
app.delete("/orders/:id", async (req, res) => {
  try {
    const deleted = await Order.findByIdAndDelete(req.params.id);
    if(!deleted) return res.status(404).json({ success:false, message: "Order পাওয়া যায়নি" });
    return res.json({ success: true, message: "Order deleted successfully!" });
  } catch (err) {
    console.error('DELETE /orders/:id error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Additional convenience endpoints so client fallbacks succeed ---

// DELETE by orderId via query param: DELETE /orders?orderId=YY-...
app.delete("/orders", async (req, res) => {
  try {
    const { orderId } = req.query;
    if(!orderId) return res.status(400).json({ success:false, message: "orderId query parameter required" });
    const deleted = await Order.findOneAndDelete({ orderId });
    if(!deleted) return res.status(404).json({ success:false, message: "Order পাওয়া যায়নি (by orderId)" });
    return res.json({ success: true, message: "Order deleted by orderId", data: deleted });
  } catch (err) {
    console.error('DELETE /orders (by query) error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /orders/delete  with body { id, orderId }  (fallback that some clients use)
app.post("/orders/delete", async (req, res) => {
  try {
    const { id, orderId } = req.body || {};
    let deleted = null;
    if(id){
      deleted = await Order.findByIdAndDelete(id);
    } else if(orderId){
      deleted = await Order.findOneAndDelete({ orderId });
    } else {
      return res.status(400).json({ success:false, message: "Provide id or orderId in body" });
    }
    if(!deleted) return res.status(404).json({ success:false, message: "Order পাওয়া যায়নি" });
    return res.json({ success: true, message: "Order deleted (fallback)", data: deleted });
  } catch (err) {
    console.error('POST /orders/delete error', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================
// Start Server
// ====================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
