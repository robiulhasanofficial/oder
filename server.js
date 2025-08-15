// server.js

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ====================
// MongoDB Connection
// ====================
mongoose.connect("YOUR_MONGO_URI", {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ MongoDB Connection Error:", err));

// ====================
// Order Schema & Model
// ====================
const orderSchema = new mongoose.Schema({
    name: String,
    quantity: Number,
    status: { type: String, default: "pending" }
}, { timestamps: true });

const Order = mongoose.model("Order", orderSchema);

// ====================
// API Routes
// ====================

// Add New Order
app.post("/orders", async (req, res) => {
    try {
        const newOrder = new Order(req.body);
        await newOrder.save();
        res.json({ success: true, message: "Order saved successfully!" });
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

// Update Order Status
app.put("/orders/:id", async (req, res) => {
    try {
        await Order.findByIdAndUpdate(req.params.id, req.body);
        res.json({ success: true, message: "Order updated successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Delete Order
app.delete("/orders/:id", async (req, res) => {
    try {
        await Order.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Order deleted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================
// Start Server
// ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
