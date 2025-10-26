// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { 
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Simple in-memory store (restart এ হারাবে)
let lastFull = { list: [], lastUpdated: 0 };

// নতুন: অনলাইন ইউজারদের স্টোর করার Map
const onlineUsers = new Map();

// নতুন: অর্ডার লক স্টেট
let orderLockState = {
  isLocked: false,
  lockedBy: null,
  lockedAt: null
};

// নতুন: তারিখ ও বিদ্যালয় দ্বারা সার্চ করার রুট
app.get('/api/orders/search', (req, res) => {
  try {
    const { date, school } = req.query;
    let filteredOrders = lastFull.list;

    if (date) {
      filteredOrders = filteredOrders.filter(order => {
        if (!order.orderDateTime) return false;
        const orderDate = new Date(order.orderDateTime).toISOString().split('T')[0];
        return orderDate === date;
      });
    }

    if (school) {
      const schoolLower = school.toLowerCase();
      filteredOrders = filteredOrders.filter(order => 
        order.school && order.school.toLowerCase().includes(schoolLower)
      );
    }

    res.json({
      success: true,
      count: filteredOrders.length,
      orders: filteredOrders,
      searchParams: { date, school }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// নতুন: সমস্ত অর্ডার পাওয়ার রুট
app.get('/api/orders', (req, res) => {
  res.json({
    success: true,
    count: lastFull.list.length,
    orders: lastFull.list,
    lastUpdated: lastFull.lastUpdated
  });
});

// নতুন: অনলাইন ইউজারদের লিস্ট পাওয়ার রুট
app.get('/api/online-users', (req, res) => {
  const usersArray = Array.from(onlineUsers.values());
  res.json({
    success: true,
    count: usersArray.length,
    users: usersArray
  });
});

// নতুন: অর্ডার লক স্টেট পাওয়ার রুট
app.get('/api/order-lock-status', (req, res) => {
  res.json({
    success: true,
    lockStatus: orderLockState
  });
});

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  // নতুন: ইউজার জয়েন করলে
  socket.on('user:join', (userData) => {
    try {
      console.log('User joined:', userData.name, socket.id);
      
      // ইউজার তথ্য onlineUsers Map-এ 저장
      onlineUsers.set(socket.id, {
        ...userData,
        socketId: socket.id,
        joinTime: Date.now()
      });

      // কানেক্ট হওয়া ইউজারকে কারেন্ট লক স্টেট জানান
      socket.emit('order:lockStatus', orderLockState);

      // সব ক্লায়েন্টকে অনলাইন ইউজারদের আপডেটেড তালিকা পাঠাও
      broadcastOnlineUsers();
      
      // নতুন ইউজারকে সর্বশীন অর্ডার ডেটা সেন্ড করুন
      socket.emit('orders:full', lastFull);

    } catch (e) {
      console.error('user:join error', e);
    }
  });

  // নতুন: অর্ডার লক টগল
  socket.on('order:lockToggle', (data) => {
    try {
      console.log('Order lock toggle:', data.isLocked, 'by', data.userName);
      
      // অর্ডার লক স্টেট আপডেট
      orderLockState = {
        isLocked: data.isLocked,
        lockedBy: data.userId,
        lockedByName: data.userName,
        lockedAt: Date.now()
      };

      // সব ক্লায়েন্টকে নতুন লক স্টেট পাঠাও
      io.emit('order:lockStatus', orderLockState);
      
      // লগ
      console.log(`Order system ${data.isLocked ? 'LOCKED' : 'UNLOCKED'} by ${data.userName}`);

    } catch (e) {
      console.error('order:lockToggle error', e);
    }
  });

  // বিদ্যমান অর্ডার সিঙ্ক ইভেন্টগুলি
  socket.on('orders:hello', (data) => {
    try {
      if (lastFull.lastUpdated > (data.lastUpdated || 0)) {
        socket.emit('orders:full', lastFull);
      } else if (data.lastUpdated > lastFull.lastUpdated) {
        // ক্লায়েন্টের ডেটা নতুন হলে সার্ভার আপডেট করুন
        lastFull = { list: data.list || [], lastUpdated: data.lastUpdated };
        // অন্য সব ক্লায়েন্টকে সিঙ্ক করুন
        socket.broadcast.emit('orders:sync', data);
      }
    } catch (e) { 
      console.error('orders:hello error', e); 
    }
  });

  socket.on('orders:sync', (payload) => {
    try {
      // update server memory if payload is newer
      if (payload.lastUpdated && payload.lastUpdated > lastFull.lastUpdated) {
        lastFull = { list: payload.list || [], lastUpdated: payload.lastUpdated };
      }
      // broadcast to other clients (not back to sender)
      socket.broadcast.emit('orders:sync', payload);
    } catch (e) { 
      console.error('orders:sync error', e); 
    }
  });

  // নতুন: তারিখ ও বিদ্যালয় দ্বারা সার্চ
  socket.on('orders:search', (searchData, callback) => {
    try {
      const { date, school } = searchData;
      let filteredOrders = lastFull.list;

      if (date) {
        filteredOrders = filteredOrders.filter(order => {
          if (!order.orderDateTime) return false;
          const orderDate = new Date(order.orderDateTime).toISOString().split('T')[0];
          return orderDate === date;
        });
      }

      if (school) {
        const schoolLower = school.toLowerCase();
        filteredOrders = filteredOrders.filter(order => 
          order.school && order.school.toLowerCase().includes(schoolLower)
        );
      }

      if (typeof callback === 'function') {
        callback({
          success: true,
          count: filteredOrders.length,
          orders: filteredOrders
        });
      }
    } catch (error) {
      console.error('Socket search error:', error);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Search failed' });
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('socket disconnected:', socket.id, 'Reason:', reason);

    // নতুন: ইউজার ছেড়ে গেলে onlineUsers থেকে মুছুন
    if (onlineUsers.has(socket.id)) {
      const user = onlineUsers.get(socket.id);
      console.log('User left:', user.name, socket.id);
      onlineUsers.delete(socket.id);
      
      // সব ক্লায়েন্টকে আপডেটেড ইউজার লিস্ট পাঠান
      broadcastOnlineUsers();
    }
  });

  // নতুন: হৃদস্পন্দন (heartbeat) ম্যানেজমেন্ট
  socket.on('heartbeat', (userData) => {
    if (onlineUsers.has(socket.id)) {
      // ইউজারের লাস্ট এক্টিভিটি টাইম আপডেট করুন
      const user = onlineUsers.get(socket.id);
      onlineUsers.set(socket.id, {
        ...user,
        lastActive: Date.now()
      });
    }
  });
});

// নতুন: অনলাইন ইউজারদের তালিকা সব ক্লায়েন্টে ব্রডকাস্ট করা
function broadcastOnlineUsers() {
  const usersArray = Array.from(onlineUsers.values());
  io.emit('users:update', usersArray);
  console.log(`Broadcasting online users: ${usersArray.length} users`);
}

// নতুন: নিষ্ক্রিয় ইউজারদের স্বয়ংক্রিয়ভাবে সরানোর ইন্টারভাল
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes
  
  let removedCount = 0;
  onlineUsers.forEach((user, socketId) => {
    const lastActive = user.lastActive || user.joinTime;
    if (now - lastActive > timeout) {
      onlineUsers.delete(socketId);
      removedCount++;
    }
  });
  
  if (removedCount > 0) {
    console.log(`Removed ${removedCount} inactive users`);
    broadcastOnlineUsers();
  }
}, 60000); // প্রতি মিনিটে চেক করুন

// নতুন: হেলথ চেক এন্ডপয়েন্ট
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    onlineUsers: onlineUsers.size,
    totalOrders: lastFull.list.length,
    orderLockState: orderLockState
  });
});

// নতুন: সার্ভার স্ট্যাটাস এন্ডপয়েন্ট
app.get('/status', (req, res) => {
  const usersArray = Array.from(onlineUsers.values());
  res.json({
    server: 'Running',
    uptime: process.uptime(),
    onlineUsers: usersArray.map(user => ({
      name: user.name,
      joinTime: new Date(user.joinTime).toLocaleString(),
      socketId: user.socketId
    })),
    orders: {
      total: lastFull.list.length,
      lastUpdated: new Date(lastFull.lastUpdated).toLocaleString()
    },
    orderLock: orderLockState
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Status: http://localhost:${PORT}/status`);
});

// গ্রেসফুল শাটডাউন হ্যান্ডলিং
process.on('SIGINT', () => {
  console.log('\n🔴 Server shutting down...');
  io.disconnectSockets();
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🔴 Server shutting down...');
  io.disconnectSockets();
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});