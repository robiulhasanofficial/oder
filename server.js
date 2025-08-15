// server.js
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

// CORS: যদি তুমি নির্দিষ্ট ডোমেইন চান, '*' এর বদলে তা ব্যবহার করো
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
  orderId: { type: String, required: true },
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
    res.status(201).json({ success: true, message: "Order saved successfully!", data: newOrder });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get All Orders
app.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Order
app.put("/orders/:id", async (req, res) => {
  try {
    const updated = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if(!updated) return res.status(404).json({ success:false, message: "Order পাওয়া যায়নি" });
    res.json({ success: true, message: "Order updated successfully!", data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Order
app.delete("/orders/:id", async (req, res) => {
  try {
    const deleted = await Order.findByIdAndDelete(req.params.id);
    if(!deleted) return res.status(404).json({ success:false, message: "Order পাওয়া যায়নি" });
    res.json({ success: true, message: "Order deleted successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================
// Start Server
// ====================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
