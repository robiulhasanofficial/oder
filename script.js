// script.js — Local + Socket.IO realtime sync (last-write-wins)
const ACCESS_CODE = "12345"; // 👉 তোমার সিক্রেট কোড


// localStorage চেক করা
if (localStorage.getItem("access_granted") !== "true") {
    const userCode = prompt("Enter Access Code:");

    if (userCode !== ACCESS_CODE) {
        // কোড ভুল হলে সব মুছে শুধু Access Denied দেখাবে
        document.documentElement.innerHTML = "<h2 style='color:red;text-align:center;margin-top:100px;'>❌ Access Denied</h2>";
        throw new Error("Access Denied"); // বাকী JS থামাবে
    } else {
        // কোড ঠিক হলে localStorage-এ রাখো যাতে বারবার না চায়
        localStorage.setItem("access_granted", "true");
    }
}


// এখানে তুমি বাকি ওয়েবসাইটের কোড রাখতে পারো
console.log("Access Granted ✅");



// ================= Config =================
const SOCKET_URL = 'https://oder-gjta.onrender.com'; // তোমার সার্ভারের URL (যদি same-origin, undefined/'' রাখতে পারো)
const STORE_KEY = 'orders_store_v4_with_amount';
const SYNC_KEY = 'orders_store_sync_msg_v1';
const CHANNEL_NAME = 'orders_channel_v1';
const clientId = localStorage.getItem('orders_client_id') || (function(){ const id = 'c_' + Math.random().toString(36).slice(2); localStorage.setItem('orders_client_id', id); return id; })();

// ================= Toast =================
function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return console.log('toast:', msg);
  const item = document.createElement('div');
  item.className = 'item';
  item.textContent = msg;
  t.appendChild(item);
  setTimeout(()=>{ item.style.opacity = '0'; item.style.transform = 'translateY(6px)'; }, 2400);
  setTimeout(()=>{ item.remove(); }, 3000);
}

// ================= Store (with lastUpdated) =================
const store = {
  list: [],
  lastUpdated: 0,
  load(){
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      this.list = Array.isArray(raw.list) ? raw.list : (raw.list || []);
      this.lastUpdated = raw.lastUpdated || 0;
    } catch(e){
      this.list = [];
      this.lastUpdated = 0;
    }
  },
  save(){
    localStorage.setItem(STORE_KEY, JSON.stringify({ list: this.list, lastUpdated: this.lastUpdated }));
  },
  upsert(index, item){
    if(index === '' || index === null || index === undefined){
      this.list.push(item);
    } else {
      this.list[index] = item;
    }
    this.lastUpdated = Date.now();
    this.save();
    publishChange();
  },
  remove(index){
    this.list.splice(index,1);
    this.lastUpdated = Date.now();
    this.save();
    publishChange();
  },
  clear(){
    this.list = [];
    this.lastUpdated = Date.now();
    this.save();
    publishChange();
  }
};

// ================= Helpers =================
function fmtDate(ts){
if(!ts) return '';
  const d = new Date(ts);
  const pad = n => n.toString().padStart(2,'0');
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(hour12)}:${pad(d.getMinutes())} ${ampm}`;
}
function autoId(){
  const d = new Date();
  const pad = n => n.toString().padStart(2,'0');
  return `YY-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function escapeHtml(str){ return String(str||'').replace(/[&<>"]|'/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"})[m]); }
function formatCurrency(v){
  if(v === '' || v === null || v === undefined || isNaN(+v)) return '';
  const n = Number(v);
  return `৳ ${n.toFixed(2)}`;
}
function hexToRgba(hex, alpha){
  if(!hex) return `rgba(0,0,0,${alpha})`;
  const h = hex.replace('#','');
  const bigint = parseInt(h,16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ================ Render (same as yours, unchanged visually) ================
let state = { sortKey: 'createdAt', sortDir: 'desc', page:1, pageSize:10, query:'' };

function render(){
  const q = state.query.toLowerCase();
  const counts = {};
  store.list.forEach(r => { const k = (r.orderId||'').toString(); counts[k] = (counts[k]||0) + 1; });

  const filtered = store.list.map((x, idx) => ({...x, _idx: idx}))
    .filter(row => {
      return (
        (row.name||'').toString().toLowerCase().includes(q) ||
        (row.orderName||'').toString().toLowerCase().includes(q) ||
        (row.orderId||'').toString().toLowerCase().includes(q) ||
        (row.phone||'').toString().toLowerCase().includes(q) ||
        (row.school||'').toString().toLowerCase().includes(q)
      );
    });

  filtered.sort((a,b)=>{
    const k = state.sortKey;
    let va = a[k] !== undefined ? a[k] : '';
    let vb = b[k] !== undefined ? b[k] : '';
    if(typeof va === 'string') va = va.toLowerCase();
    if(typeof vb === 'string') vb = vb.toLowerCase();
    if(va > vb) return state.sortDir === 'asc' ? 1 : -1;
    if(va < vb) return state.sortDir === 'asc' ? -1 : 1;
    return 0;
  });

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if(state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const rows = filtered.slice(start, start + state.pageSize);

  const tbody = document.querySelector('#dataTable tbody');
  if(!tbody) return console.warn('dataTable tbody not found');
  tbody.innerHTML = '';

  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const countForId = counts[(row.orderId||'').toString()] || 0;

    if(countForId >= 10){
      const bucketIndex = Math.floor((countForId - 10) / 10);
      const palette = ['#ef4444','#10b981','#f59e0b','#7c3aed','#06b6d4','#f97316','#db2777','#0ea5e9','#8b5cf6','#16a34a'];
      const color = palette[bucketIndex % palette.length];
      tr.classList.add('over-limit');
      tr.style.borderLeft = `4px solid ${color}`;
      tr.style.background = `linear-gradient(90deg, ${hexToRgba(color,0.06)}, ${hexToRgba(color,0.03)})`;
    }

    const amountDisplay = formatCurrency(row.amount);

    tr.innerHTML = `
      <td>${start + i + 1}</td>
      <td><span class="pill">${escapeHtml(row.name)}</span></td>
      <td>${escapeHtml(row.orderName || '')}</td>
      <td>${amountDisplay}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td>${escapeHtml(row.school)}</td>
      <td class="order-id">${escapeHtml(row.orderId)}${countForId>1? ' • '+countForId+ ' টি':''}</td>
      <td>${row.orderDateTime ? fmtDate(row.orderDateTime) : ''}</td>
      <td class="hide-sm">${row.createdAt ? fmtDate(row.createdAt) : ''}</td>
      <td class="actions">
        <button class="btn btn-success" onclick="edit(${row._idx})">এডিট</button>
        <button class="btn btn-danger" onclick="remove(${row._idx})">ডিলিট</button>
      </td>
    `;

    const orderTd = tr.querySelector('.order-id');
    if(orderTd && countForId >= 10){
      const bucketIndex = Math.floor((countForId - 10) / 10);
      const palette = ['#ef4444','#10b981','#f59e0b','#7c3aed','#06b6d4','#f97316','#db2777','#0ea5e9','#8b5cf6','#16a34a'];
      const color = palette[bucketIndex % palette.length];
      orderTd.style.color = color;
      orderTd.style.fontWeight = '700';
    }
    tbody.appendChild(tr);
  });

  // pagination
  const pg = document.getElementById('pagination');
  if(pg){
    pg.innerHTML = '';
    const info = document.createElement('div');
    info.style.marginRight = 'auto';
    info.style.alignSelf = 'center';
    info.style.color = 'var(--muted)';
    info.textContent = `পেজ ${state.page}/${pages} • মোট ${total}`;
    pg.appendChild(info);
    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.textContent = 'পূর্ববর্তী';
    prev.disabled = state.page <= 1;
    prev.onclick = ()=>{ if(state.page>1){ state.page--; render(); } };
    const next = document.createElement('button');
    next.className = 'page-btn';
    next.textContent = 'পরবর্তী';
    next.disabled = state.page >= pages;
    next.onclick = ()=>{ if(state.page<pages){ state.page++; render(); } };
    pg.appendChild(prev);
    pg.appendChild(next);
  }
}

// ================ Edit / Remove ================
function edit(idx){
  const row = store.list[idx];
  if(!row) return;
  document.getElementById('name').value = row.name;
  document.getElementById('phone').value = row.phone || '';
  document.getElementById('school').value = row.school || '';
  document.getElementById('orderId').value = row.orderId || '';
  document.getElementById('orderName').value = row.orderName || '';
  document.getElementById('amount').value = row.amount !== undefined ? row.amount : '';
  document.getElementById('editingIndex').value = idx;
  const pv = document.getElementById('orderPreview');
  pv.textContent = row.orderDateTime ? `অর্ডারের সময় (সংরক্ষিত): ${fmtDate(row.orderDateTime)}` : '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function remove(idx){
  if(confirm('নিশ্চিতভাবে মুছতে চাও?')){
    store.remove(idx);
    render();
    toast('মুছে ফেলা হয়েছে 🗑️');
  }
}


// ================= Auto-fill on OrderId typing =================
function debounce(fn, wait){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(()=>fn.apply(this, args), wait);
  };
}

function fillByOrderId(orderId){
  if(!orderId) return;
  // exact match করে খোঁজ
  const matches = store.list.filter(o => (o.orderId || '').toString() === orderId);
  if(matches.length === 0){
    // যদি চাইলে এখানে ফিল্ডগুলো ক্লিয়ার করতে পারো (কমেন্টেড)
    // document.getElementById('name').value = '';
    // document.getElementById('phone').value = '';
    // document.getElementById('school').value = '';
    return;
  }

  // যদি একাধিক মিলে, সর্বশেষ(createdAt || orderDateTime) টেকনিক দিয়ে বেছে নাও
  matches.sort((a,b) => {
    const ta = a.createdAt || a.orderDateTime || 0;
    const tb = b.createdAt || b.orderDateTime || 0;
    return tb - ta;
  });
  const existing = matches[0];

  // ফর্মে অটোমেটিক ভরবে
  // যদি তুমি চাইলে কেবল তখনই ভরাও যখন ইনপুটগুলো খালি — সেটাও করা যায় (নীচে আরেকটি উদাহরণ আছে)
  document.getElementById('name').value = existing.name || '';
  document.getElementById('phone').value = existing.phone || '';
  document.getElementById('school').value = existing.school || '';
  toast('আগের তথ্য অটো-ফিল হয়েছে ✅');
}

const debouncedFill = debounce((val) => fillByOrderId(val.trim()), 250);

const orderIdEl = document.getElementById('orderId');
if(orderIdEl){
  // টাইপিং হিসেবে দ্রুত ফিডব্যাক চাইলে 'input' ব্যবহার কর
  orderIdEl.addEventListener('input', (e) => debouncedFill(e.target.value));
  // অথবা blur-তে একবারে চেক করতেও রাখলাম
  orderIdEl.addEventListener('blur', (e) => fillByOrderId(e.target.value.trim()));
}

// ================= Events (form etc) =================
document.getElementById('orderForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const school = document.getElementById('school').value.trim();
  const orderId = document.getElementById('orderId').value.trim();
  const orderName = document.getElementById('orderName').value.trim();
  const amountVal = document.getElementById('amount').value;
  const amount = amountVal === '' ? 0 : Number(amountVal);
  const editingIndex = document.getElementById('editingIndex').value;

  if(!name) { toast('নাম প্রয়োজন'); return; }
  if(!phone) { toast('ফোন প্রয়োজন'); return; }
  if(!school) { toast('বিদ্যালয়ের নাম প্রয়োজন'); return; }
  if(!orderId) { toast('আইডি প্রয়োজন'); return; }
  if(!orderName) { toast('অর্ডারের নাম প্রয়োজন'); return; }
  if(isNaN(amount) || amount < 0){ toast('সঠিক টাকা প্রবেশ করাও'); return; }

  let orderDateTime = Date.now();
  if(editingIndex !== ''){
    const prev = store.list[+editingIndex];
    orderDateTime = prev && prev.orderDateTime ? prev.orderDateTime : Date.now();
  }

  const item = {
    name,
    phone,
    school,
    orderId,
    orderName,
    amount,
    orderDateTime,
    createdAt: Date.now()
  };

  if(editingIndex !== ''){
    item.createdAt = store.list[+editingIndex]?.createdAt || item.createdAt;
  }

  // use store.upsert which triggers publishChange
  store.upsert(editingIndex !== '' ? +editingIndex : '', item);

  toast(editingIndex !== '' ? 'আপডেট সম্পন্ন ✅' : 'সংরক্ষণ সম্পন্ন ✅');
  e.target.reset();
  document.getElementById('editingIndex').value = '';
  document.getElementById('orderPreview').textContent = '';
  render();
});

document.getElementById('btnClearForm').addEventListener('click', ()=>{
  document.getElementById('orderForm').reset();
  document.getElementById('editingIndex').value = '';
  document.getElementById('orderPreview').textContent = '';
  toast('ফর্ম ক্লিয়ার হয়েছে');
});

document.getElementById('btnAutoId').addEventListener('click', ()=>{ document.getElementById('orderId').value = autoId(); toast('Auto ID সেট হয়েছে'); });

document.getElementById('search').addEventListener('input', (e)=>{ state.query = e.target.value; state.page = 1; render(); });
document.getElementById('pageSize').addEventListener('change', (e)=>{ state.pageSize = +e.target.value; state.page = 1; render(); });

document.getElementById('btnClearAll').addEventListener('click', ()=>{
  if(confirm('সব ডাটা স্থায়ীভাবে মুছে যাবে। নিশ্চিত?')){
    store.clear();
    render();
    toast('সব ডাটা মুছে ফেলা হয়েছে');
  }
});

// Export CSV
document.getElementById('btnExport').addEventListener('click', ()=>{
  const rows = [["name","phone","school","order_name","amount","order_id","order_datetime","created_at"]].concat(
    store.list.map(r=>[
      r.name, r.phone, r.school, r.orderName, r.amount, r.orderId,
      r.orderDateTime ? new Date(r.orderDateTime).toISOString() : '',
      r.createdAt ? new Date(r.createdAt).toISOString() : ''
    ])
  );
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'orders.csv'; a.click(); URL.revokeObjectURL(a.href);
  toast('CSV ডাউনলোড হয়েছে');
});

// Import CSV
document.getElementById('importCsv').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    const lines = text.split(/\r?\n/).filter(Boolean);
    if(lines.length === 0){ toast('ফাইল খালি'); e.target.value = ''; return; }
    const header = lines.shift().split(',').map(x => x.replace(/^\"|\"$/g,'').toLowerCase());
    const nameIdx = header.findIndex(h => /name/.test(h));
    const phoneIdx = header.findIndex(h => /phone/.test(h));
    const schoolIdx = header.findIndex(h => /school/.test(h));
    const orderNameIdx = header.findIndex(h => /order[_ ]?name/.test(h));
    const amountIdx = header.findIndex(h => /amount|price|money|টাকা/.test(h));
    const orderIdIdx = header.findIndex(h => /(order[_ ]?id|id)/.test(h));
    const orderTimeIdx = header.findIndex(h => /(order[_ ]?datetime|order_time|order_datetime)/.test(h));
    const createdIdx = header.findIndex(h => /created/.test(h));

    let count = 0;
    lines.forEach(line=>{
      const cols = line.match(/\"(?:[^\"]|\"\")*\"|[^,]+/g)?.map(x=>x.replace(/^\"|\"$/g,'').replace(/\"\"/g,'"')) || [];
      const name = cols[nameIdx] || '';
      const phone = cols[phoneIdx] || '';
      const school = cols[schoolIdx] || '';
      const orderName = cols[orderNameIdx] || '';
      const amount = amountIdx > -1 ? Number(cols[amountIdx]) : 0;
      const orderId = cols[orderIdIdx] || '';
      const orderDateTime = orderTimeIdx > -1 ? Date.parse(cols[orderTimeIdx]) : Date.now();
      const createdAt = createdIdx > -1 ? Date.parse(cols[createdIdx]) : Date.now();
      if(name && orderId){
        store.list.push({
          name,
          phone,
          school,
          orderName,
          amount: isNaN(amount) ? 0 : amount,
          orderId,
          orderDateTime: isNaN(orderDateTime) ? Date.now() : orderDateTime,
          createdAt: isNaN(createdAt) ? Date.now() : createdAt
        });
        count++;
      }
    });
    store.lastUpdated = Date.now();
    store.save();
    publishChange();
    render();
    toast(`${count} টি রেকর্ড ইম্পোর্ট হয়েছে`);
    e.target.value = '';
  };
  reader.readAsText(file, 'utf-8');
});

// ================= Realtime Sync Layer =================

// BroadcastChannel for same-origin tab sync
let bc = null;
try { if('BroadcastChannel' in window) bc = new BroadcastChannel(CHANNEL_NAME); } catch(e){ bc = null; }

// Socket.IO client setup (if socket.io script loaded)
let socket = null;
try {
  if(typeof io !== 'undefined'){
    socket = io(SOCKET_URL);
    socket.on('connect', ()=>{ console.log('socket connected', socket.id); toast('Socket connected'); 
      // ask server for authoritative copy if server has newer
      socket.emit('orders:hello', { clientId, lastUpdated: store.lastUpdated });
    });
    socket.on('disconnect', ()=>{ console.log('socket disconnected'); toast('Socket disconnected'); });
    socket.on('connect_error', (err)=>{ console.warn('socket connect_error', err); });
    socket.on('orders:sync', payload => { onRemotePayload(payload, 'socket'); });
    socket.on('orders:full', payload => { onRemotePayload(payload, 'socket-full'); });
  } else {
    console.warn('socket.io client not found — socket disabled');
  }
} catch(e){
  console.warn('socket init error', e);
  socket = null;
}

// publish local change to others (BroadcastChannel + storage + socket)
function publishChange(){
  const payload = { clientId, lastUpdated: store.lastUpdated, list: store.list };

  // BroadcastChannel
  if(bc){
    try { bc.postMessage(payload); } catch(e){ console.warn('bc post error', e); }
  }

  // localStorage fire (so storage-event triggers in other tabs)
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ ...payload, __ts: Date.now() }));
    setTimeout(()=>{ try{ localStorage.removeItem(SYNC_KEY); } catch(e){} }, 800);
  } catch(e){}

  // socket
  if(socket && socket.connected){
    try { socket.emit('orders:sync', payload); } catch(e){ console.warn('socket emit error', e); }
  }
}

// handle incoming payload (from bc/storage/socket)
function onRemotePayload(payload, via){
  try {
    if(!payload) return;
    if(payload.clientId === clientId) return; // ignore our own
    if(!payload.lastUpdated) return;
    if(payload.lastUpdated > (store.lastUpdated || 0)){
      store.list = Array.isArray(payload.list) ? payload.list : [];
      store.lastUpdated = payload.lastUpdated;
      store.save();
      render();
      toast(`সিঙ্ক হয়েছে (${via || 'remote'})`);
    } else {
      // our copy is newer -> push to server (reconcile)
      if(socket && socket.connected){
        socket.emit('orders:sync', { clientId, lastUpdated: store.lastUpdated, list: store.list });
      }
    }
  } catch(e){ console.error('onRemotePayload error', e); }
}

// BroadcastChannel listener
if(bc){
  bc.onmessage = (ev) => {
    const payload = ev.data;
    try { onRemotePayload(payload, 'bc'); } catch(e){}
  };
}

// storage event listener (other tabs)
window.addEventListener('storage', (ev)=>{
  try {
    if(ev.key !== SYNC_KEY) return;
    if(!ev.newValue) return;
    const o = JSON.parse(ev.newValue);
    onRemotePayload(o, 'storage');
  } catch(e){}
});

// initial announce / ask server
function initSyncAnnounce(){
  const payload = { clientId, lastUpdated: store.lastUpdated, list: store.list };
  if(socket && socket.connected){
    socket.emit('orders:hello', payload);
  } else {
    if(bc) try{ bc.postMessage(payload); } catch(e){}
    try { localStorage.setItem(SYNC_KEY, JSON.stringify({ ...payload, __ts: Date.now() })); setTimeout(()=>localStorage.removeItem(SYNC_KEY), 800); } catch(e){}
  }
}

//bbbbb
// পুরোনো লিসেনার সরিয়ে দিন
const oldBtn = document.getElementById('btnClearAll');
oldBtn.replaceWith(oldBtn.cloneNode(true));

document.getElementById('btnClearAll').addEventListener('click', ()=> {
  // ইউজারের কাছ থেকে কোড নাও
  const userCode = prompt('সব ডাটা মুছতে হলে অ্যাকসেস কোড লিখো:');

  if(userCode === null) {
    toast('অ্যাকশন বাতিল করা হয়েছে');
    return;
  }

  // কোড যাচাই
  if(userCode !== ACCESS_CODE){
    alert('ভুল কোড — অ্যাক্সেস প্রত্যাখ্যাত।');
    toast('কোড ভুল — অনুমতি নেই');
    return;
  }

  // কোড সঠিক হলে কনফার্মেশন
  if(!confirm('সব ডাটা স্থায়ীভাবে মুছে যাবে। নিশ্চিত?')) {
    toast('অ্যাকশন বাতিল করা হয়েছে');
    return;
  }

  // সব ডাটা মুছে ফেলো
  store.clear();
  render();
  toast('সব ডাটা মুছে ফেলা হয়েছে');
});

// ================= Init =================

store.load();
render();
initSyncAnnounce();
