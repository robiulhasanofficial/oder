// ====== Config ======
const API_URL = 'https://myapp.com/api'; // <-- তোমার সার্ভার URL
const POLL_INTERVAL_MS = 7000;
const STORE_KEY = 'orders_store_v5';
const QUEUE_KEY = 'orders_queue_v2';

// derive a socket URL (strip trailing /api if present)
const SOCKET_URL = (API_URL && API_URL.replace(/\/api\/?$/,'')) || undefined;

// ====== Socket.io (safe init) ======
let socket = { on: ()=>{}, emit: ()=>{} };
if(typeof io === 'function'){
  try{ socket = io(SOCKET_URL); }catch(e){ console.warn('socket init failed', e); }
}

// ====== Helpers ======
function log(...args){ console.log('[ORDERS]', ...args); }
function toast(msg){ const t = document.getElementById('toast'); if(!t) return console.warn('No toast element'); const item = document.createElement('div'); item.className = 'item'; item.textContent = msg; t.appendChild(item); setTimeout(()=>{ item.style.opacity='0'; item.style.transform='translateY(6px)'; },2400); setTimeout(()=>{ item.remove(); },3200); }

function setServerStatus(isOnline, text){ const s=document.getElementById('serverStatus'); if(!s) return; if(isOnline){ s.textContent = text || 'সার্ভার: অন'; s.style.background = 'linear-gradient(90deg, rgba(34,197,94,.12), rgba(34,197,94,.06))'; s.style.border = '1px solid rgba(34,197,94,.25)'; } else { s.textContent = text || 'সার্ভার: অফলাইন'; s.style.background = 'linear-gradient(90deg, rgba(239,68,68,.08), rgba(239,68,68,.03))'; s.style.border = '1px solid rgba(239,68,68,.25)'; } }

function fmtDate(ts){ if(!ts) return ''; const d=new Date(ts); const pad=n=>n.toString().padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function autoId(){ const d=new Date(); const pad=n=>n.toString().padStart(2,'0'); return `YY-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function escapeHtml(str){ return String(str||'').replace(/[&<>\"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function formatCurrency(v){ if(v === '' || v === null || v === undefined || isNaN(+v)) return ''; const n=Number(v); return `৳ ${n.toFixed(2)}`; }
function hexToRgba(hex, alpha){ if(!hex) return `rgba(0,0,0,${alpha})`; const h=hex.replace('#',''); const bigint=parseInt(h,16); const r=(bigint>>16)&255; const g=(bigint>>8)&255; const b=bigint&255; return `rgba(${r},${g},${b},${alpha})`; }

// ====== Local store (fallback + caching) ======
const store = {
  list: [],
  load(){ try{ this.list = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }catch{ this.list = []; } },
  save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(this.list)); }catch(e){ console.warn('localStorage save failed', e); } },
  upsertByIndex(index,item){ if(index === '' || index === null || index === undefined){ this.list.push(item); } else { this.list[index] = item; } this.save(); },
  removeByIndex(index){ this.list.splice(index,1); this.save(); },
  clear(){ this.list = []; this.save(); }
};

// ====== Offline queue helpers ======
function loadQueue(){ try{ return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }catch{ return []; } }
function saveQueue(q){ try{ localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }catch(e){ console.warn('queue save failed', e); } }
function enqueueOp(op){ const q = loadQueue(); q.push(op); saveQueue(q); toast('অপারেশন কিউতে যোগ করা হয়েছে'); }

// remove pending create ops for a given tempId (used when user creates+deletes before sync)
function removeQueuedCreatesByTempId(tempId){
  if(!tempId) return;
  const q = loadQueue().filter(item => !(item.type === 'create' && item.tempId === tempId));
  saveQueue(q);
}

// improved processQueue with tempId-delete handling
async function processQueue(){
  let q = loadQueue();
  if(!q.length) return;
  toast('কিউ সিঙ্ক শুরু হচ্ছে...');
  for(;;){
    q = loadQueue();
    if(!q.length) break;
    const op = q[0];
    try{
      if(op.type === 'create'){
        const created = await createOrderOnServer(op.item);
        // match by tempId and replace
        const idx = store.list.findIndex(r => r.tempId && op.tempId && r.tempId === op.tempId);
        if(idx > -1){ store.list[idx] = created; } else { store.list.unshift(created); }
        const remaining = loadQueue().slice(1); saveQueue(remaining); continue;
      }
      if(op.type === 'update'){
        // require server id
        if(!op.id){
          // no server id — this probably shouldn't happen; remove op
          const remaining = loadQueue().slice(1); saveQueue(remaining); continue;
        }
        const updated = await updateOrderOnServer(op.id, op.item);
        const idx = store.list.findIndex(r => (r._id||r.id) == (updated._id||updated.id));
        if(idx > -1) store.list[idx] = updated;
        const remaining = loadQueue().slice(1); saveQueue(remaining); continue;
      }
      if(op.type === 'delete'){
        // If op has server id -> call server delete
        if(op.id){
          await deleteOrderOnServer(op.id);
          const idx = store.list.findIndex(r => (r._id||r.id) == op.id);
          if(idx > -1){ store.list.splice(idx,1); }
          const remaining = loadQueue().slice(1); saveQueue(remaining); continue;
        }
        // If op only has tempId, it means user created locally then deleted before sync.
        // In that case, just remove any pending create for that tempId and remove local item.
        if(op.tempId){
          removeQueuedCreatesByTempId(op.tempId);
          const idx = store.list.findIndex(r => r.tempId == op.tempId);
          if(idx > -1){ store.list.splice(idx,1); }
          const remaining = loadQueue().slice(1); saveQueue(remaining); continue;
        }
        // otherwise skip this op
        const remaining = loadQueue().slice(1); saveQueue(remaining);
      }
    }catch(err){
      console.warn('sync op failed — will retry later', err);
      setServerStatus(false);
      break;
    }
  }
  store.save();
  render();
  if(loadQueue().length === 0) toast('কিউ সিঙ্ক সম্পন্ন হয়েছে');
}

// ====== Network: Server CRUD (with server-status updates) ======
async function fetchJson(url, opts){ try{ const res = await fetch((API_URL||'') + url, opts); if(!res.ok){ const txt = await res.text().catch(()=>res.statusText); throw new Error(`HTTP ${res.status} ${txt}`); } if (res.status === 204) return null; try { return await res.json(); } catch(e){ return await res.text().catch(()=>null); } }catch(err){ setServerStatus(false); throw err; } }

async function loadOrdersFromServer(){ const url = `/orders`; const data = await fetchJson(url); if(!Array.isArray(data)) throw new Error('Server returned non-array'); setServerStatus(true); return data.map(item => ({ ...item })); }
async function createOrderOnServer(order){ const url = `/orders`; const created = await fetchJson(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(order) }); setServerStatus(true); setTimeout(processQueue, 1000); return created; }
async function updateOrderOnServer(id, order){ const url = `/orders/${encodeURIComponent(id)}`; const updated = await fetchJson(url, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(order) }); setServerStatus(true); setTimeout(processQueue, 1000); return updated; }
async function deleteOrderOnServer(id){ const url = `/orders/${encodeURIComponent(id)}`; const resp = await fetchJson(url, { method: 'DELETE' }); setServerStatus(true); setTimeout(processQueue, 1000); return resp; }

// ====== Rendering & helpers ======
let state = { sortKey: 'createdAt', sortDir: 'desc', page:1, pageSize:10, query: '' };

function computeCounts(list){ const counts = {}; list.forEach(r => { const k = (r.orderId||'').toString().trim(); if(!k) return; counts[k] = (counts[k]||0) + 1; }); return counts; }

function compareRows(a,b,k){ let va = a[k] !== undefined ? a[k] : ''; let vb = b[k] !== undefined ? b[k] : ''; if(/date|time|at$/i.test(k) || k.toLowerCase().includes('date') || k.toLowerCase().includes('at')){ va = Number(new Date(va)) || 0; vb = Number(new Date(vb)) || 0; return state.sortDir === 'asc' ? va - vb : vb - va; } const na = Number(va), nb = Number(vb); if(!isNaN(na) && !isNaN(nb)) return state.sortDir === 'asc' ? na - nb : nb - na; va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); if(va > vb) return state.sortDir === 'asc' ? 1 : -1; if(va < vb) return state.sortDir === 'asc' ? -1 : 1; return 0; }

function render(){
  const q = state.query.toLowerCase();
  const counts = computeCounts(store.list);
  const filtered = store.list.map((x, idx) => ({...x, _idx: idx})).filter(row => {
    return ( (row.name||'').toString().toLowerCase().includes(q) || (row.orderName||'').toString().toLowerCase().includes(q) || (row.orderId||'').toString().toLowerCase().includes(q) || (row.phone||'').toString().toLowerCase().includes(q) || (row.school||'').toString().toLowerCase().includes(q) );
  });

  filtered.sort((a,b)=> compareRows(a,b,state.sortKey) );

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if(state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const rows = filtered.slice(start, start + state.pageSize);

  const tbody = document.querySelector('#dataTable tbody'); if(!tbody) return console.warn('No table body to render'); tbody.innerHTML = '';

  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const countForId = counts[(row.orderId||'').toString()] || 0;

    if(countForId >= 10){ const bucketIndex = Math.floor((countForId - 10) / 10); const palette = ['#ef4444','#10b981','#f59e0b','#7c3aed','#06b6d4','#f97316','#db2777','#0ea5e9','#8b5cf6','#16a34a']; const color = palette[bucketIndex % palette.length]; tr.style.borderLeft = `4px solid ${color}`; tr.style.background = `linear-gradient(90deg, ${hexToRgba(color,0.06)}, ${hexToRgba(color,0.03)})`; }

    const amountDisplay = escapeHtml(formatCurrency(row.amount));

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
        <button class="btn btn-success" data-idx="${row._idx}" data-action="edit">এডিট</button>
        <button class="btn btn-danger" data-idx="${row._idx}" data-action="delete">ডিলিট</button>
      </td>
    `;

    const orderTd = tr.querySelector('.order-id');
    if(orderTd && countForId >= 10){ const bucketIndex = Math.floor((countForId - 10) / 10); const palette = ['#ef4444','#10b981','#f59e0b','#7c3aed','#06b6d4','#f97316','#db2777','#0ea5e9','#8b5cf6','#16a34a']; const color = palette[bucketIndex % palette.length]; orderTd.style.color = color; orderTd.style.fontWeight = '700'; }

    tbody.appendChild(tr);
  });

  // pagination (same as before)
  const pg = document.getElementById('pagination'); if(pg){ pg.innerHTML = ''; const info = document.createElement('div'); info.style.marginRight = 'auto'; info.style.alignSelf = 'center'; info.style.color = 'var(--muted)'; info.textContent = `পেজ ${state.page}/${pages} • মোট ${total}`; pg.appendChild(info); const prev = document.createElement('button'); prev.className='page-btn'; prev.textContent='পূর্ববর্তী'; prev.disabled = state.page <= 1; prev.onclick = ()=>{ if(state.page>1){ state.page--; render(); } }; const next = document.createElement('button'); next.className='page-btn'; next.textContent='পরবর্তী'; next.disabled = state.page >= pages; next.onclick = ()=>{ if(state.page<pages){ state.page++; render(); } }; pg.appendChild(prev); pg.appendChild(next); }
}

// ====== Edit / Remove ======
function edit(idx){ const row = store.list[idx]; if(!row) return toast('রেকর্ড পাওয়া যায়নি'); document.getElementById('name').value = row.name || ''; document.getElementById('phone').value = row.phone || ''; document.getElementById('school').value = row.school || ''; document.getElementById('orderId').value = row.orderId || ''; document.getElementById('orderName').value = row.orderName || ''; document.getElementById('amount').value = row.amount !== undefined ? row.amount : ''; document.getElementById('editingIndex').value = idx; const pv = document.getElementById('orderPreview'); pv.textContent = row.orderDateTime ? `অর্ডারের সময় (সংরক্ষিত): ${fmtDate(row.orderDateTime)}` : ''; window.scrollTo({ top: 0, behavior: 'smooth' }); }

async function remove(idx){
  if(!confirm('নিশ্চিতভাবে মুছতে চাও?')) return;
  const rec = store.list[idx];
  if(!rec){ toast('রেকর্ড পাওয়া যায়নি'); return; }
  const serverId = rec._id || rec.id;
  try{
    if(serverId){
      // optimistic UI
      store.list.splice(idx,1); store.save(); render();
      try{
        await deleteOrderOnServer(serverId);
        toast('সার্ভার থেকে মুছে ফেলা হয়েছে 🗑️');
      }catch(err){
        console.warn('server delete failed, enqueuing', err);
        enqueueOp({ type:'delete', id: serverId });
        toast('সার্ভারে মুছতে ব্যর্থ — পরে চেষ্টা করা হবে');
      }
    } else {
      // No server id: user created locally (tempId) and now deletes before sync.
      // Remove local record and remove any pending create op for same tempId.
      const tempId = rec.tempId;
      store.removeByIndex(idx);
      removeQueuedCreatesByTempId(tempId);
      render();
      toast('লোকালি মুছে ফেলা হয়েছে 🗑️');
    }
  }catch(err){
    console.error(err);
    toast('মুছতে ব্যর্থ হয়েছে');
    await loadOrdersAndRender();
  }
}

// ====== Form submit handling (create or update) ======
async function onFormSubmit(e){
  e.preventDefault();
  const idxRaw = document.getElementById('editingIndex') ? document.getElementById('editingIndex').value : '';
  const editingIndex = idxRaw === '' ? null : Number(idxRaw);
  const name = (document.getElementById('name').value || '').trim();
  const phone = (document.getElementById('phone').value || '').trim();
  const school = (document.getElementById('school').value || '').trim();
  const orderIdVal = (document.getElementById('orderId').value || '').trim();
  const orderName = (document.getElementById('orderName').value || '').trim();
  const amountRaw = (document.getElementById('amount').value || '').trim();
  const amount = amountRaw === '' ? '' : Number(amountRaw);

  if(!name){
    toast('নাম প্রয়োজন');
    return;
  }

  // build order payload (client-side)
  const now = new Date().toISOString();
  const orderPayload = {
    name, phone, school,
    orderId: orderIdVal,
    orderName,
    amount: amount === '' ? '' : amount,
    orderDateTime: now,
    createdAt: now
  };

  // Update existing
  if(editingIndex !== null && !isNaN(editingIndex)){
    const existing = store.list[editingIndex];
    if(!existing){ toast('রেকর্ড পাওয়া যায়নি'); return; }
    const serverId = existing._id || existing.id;
    // merge changes
    const merged = { ...existing, ...orderPayload, updatedAt: new Date().toISOString() };
    // optimistic UI update
    store.list[editingIndex] = merged;
    store.save();
    render();
    document.getElementById('orderForm').reset();
    document.getElementById('editingIndex').value = '';
    document.getElementById('orderPreview').textContent = '';
    // If server id exists -> try server update, else enqueue update op
    if(serverId && navigator.onLine){
      try{
        await updateOrderOnServer(serverId, merged);
        toast('সার্ভারে আপডেট করা হয়েছে');
      }catch(err){
        console.warn('update failed, queueing', err);
        enqueueOp({ type: 'update', id: serverId, item: merged });
        setServerStatus(false);
      }
    } else {
      // no server id -> enqueue update (this covers local-only records too)
      enqueueOp({ type: 'update', id: serverId, item: merged });
      toast('লokal আপডেট কিউতে যুক্ত হয়েছে');
    }
    return;
  }

  // Create new
  const tempId = `temp-${Date.now()}-${Math.floor(Math.random()*9000+1000)}`;
  const item = { ...orderPayload, tempId, createdAt: now };

  // Add locally immediately
  store.list.unshift(item);
  store.save();
  render();
  document.getElementById('orderForm').reset();
  document.getElementById('editingIndex').value = '';
  document.getElementById('orderPreview').textContent = '';
  // Try to create on server if online
  if(navigator.onLine){
    try{
      const created = await createOrderOnServer(item);
      // replace local temp item with created (match by tempId)
      const idx = store.list.findIndex(r => r.tempId === tempId);
      if(idx > -1){ store.list[idx] = created; store.save(); render(); }
      toast('নতুন অর্ডার সার্ভারে সেভ হয়েছে');
    }catch(err){
      console.warn('create failed, enqueueing', err);
      enqueueOp({ type: 'create', item, tempId });
      setServerStatus(false);
    }
  } else {
    // offline -> enqueue create
    enqueueOp({ type: 'create', item, tempId });
    toast('অফলাইনে — লোকাল ডেটা রেকর্ড করা হয়েছে এবং পরে সিঙ্ক হবে');
  }
}

// ====== CSV Export / Import ======
function exportCsv(e){
  // create CSV from store.list
  try{
    const rows = store.list.slice(); // copy
    if(!rows || !rows.length){ toast('রফতানি করার জন্য ডেটা নেই'); return; }
    const headers = ['name','phone','school','orderId','orderName','amount','orderDateTime','createdAt','_id','tempId'];
    const escape = (v) => {
      if(v === null || v === undefined) return '';
      const s = String(v);
      if(s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`;
      return s;
    };
    const lines = [headers.join(',')];
    rows.forEach(r => {
      const line = headers.map(h => escape(r[h] !== undefined ? r[h] : '')).join(',');
      lines.push(line);
    });
    const csv = '\uFEFF' + lines.join('\n'); // BOM for Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('CSV ডাউনলোড শুরু হয়েছে');
  }catch(err){
    console.error('exportCsv failed', err);
    toast('CSV রপ্তানি ব্যর্থ হয়েছে');
  }
}

// Simple robust CSV parser (handles quoted fields)
function parseCsvText(text){
  const rows = [];
  let cur = '';
  let row = [];
  let inQuotes = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    if(inQuotes){
      if(ch === '"'){
        if(text[i+1] === '"'){ cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if(ch === '"'){ inQuotes = true; }
      else if(ch === ','){ row.push(cur); cur = ''; }
      else if(ch === '\r'){ /* ignore */ }
      else if(ch === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else { cur += ch; }
    }
  }
  // last
  if(cur !== '' || row.length){
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function importCsvFromFile(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try{
        const text = ev.target.result;
        // normalize and parse
        const cleaned = text.replace(/\uFEFF/g,'').trim();
        const parsed = parseCsvText(cleaned);
        if(!parsed || !parsed.length) { toast('CSV খালি বা অপ্রচলিত।'); resolve(); return; }
        // first row -> headers
        const headers = parsed[0].map(h => (h||'').trim());
        const items = [];
        for(let i=1;i<parsed.length;i++){
          const row = parsed[i];
          if(row.length === 1 && row[0] === '') continue; // skip empty line
          const obj = {};
          for(let j=0;j<headers.length;j++){
            const key = headers[j];
            obj[key] = (row[j] !== undefined) ? row[j] : '';
          }
          // minimal mapping: amount -> number if possible
          if(obj.amount !== undefined && obj.amount !== '') {
            const num = Number(String(obj.amount).replace(/[^0-9.-]+/g,''));
            obj.amount = isNaN(num) ? obj.amount : num;
          }
          // ensure createdAt/orderDateTime
          const now = new Date().toISOString();
          obj.createdAt = obj.createdAt || now;
          obj.orderDateTime = obj.orderDateTime || now;
          // assign a tempId to ensure queue match
          obj.tempId = `imp-${Date.now()}-${Math.floor(Math.random()*9000+1000)}`;
          items.push(obj);
        }
        // add items locally and enqueue create ops
        if(items.length === 0){ toast('কোনো রেকর্ড মেলে নি'); resolve(); return; }
        // add to front to show newest first
        items.reverse().forEach(it => {
          store.list.unshift(it);
          enqueueOp({ type: 'create', item: it, tempId: it.tempId });
        });
        store.save();
        render();
        toast(`${items.length}টি রেকর্ড ইম্পোর্ট করা হয়েছে (সিঙ্কের জন্য কিউতে যোগ করা হয়েছে)`); 
        // try immediate sync if online
        if(navigator.onLine) setTimeout(processQueue, 800);
        resolve();
      }catch(err){
        console.error('import parse failed', err);
        reject(err);
      }
    };
    reader.onerror = (err) => { reject(err); };
    reader.readAsText(file, 'utf-8');
  });
}

// ====== Polling + Socket listeners ======
let pollTimer = null;
function startPolling(){ if(POLL_INTERVAL_MS > 0){ pollTimer = setInterval(async ()=>{ try{ await reloadFromServerIfChanged(); checkServerHealth().catch(()=>{}); }catch(e){ /* ignore */ } }, POLL_INTERVAL_MS); }}
function stopPolling(){ if(pollTimer) clearInterval(pollTimer); pollTimer = null; }

// socket listeners (same)
socket.on && socket.on('order:created', (order) => { if(!order) return; const exists = store.list.find(r => (r._id||r.id) == (order._id||order.id)); if(!exists){ store.list.unshift(order); store.save(); render(); } });
socket.on && socket.on('order:updated', (order) => { if(!order) return; const idx = store.list.findIndex(r => (r._id||r.id) == (order._id||order.id)); if(idx > -1){ store.list[idx] = order; store.save(); render(); } else { store.list.unshift(order); store.save(); render(); } });
socket.on && socket.on('order:deleted', (payload) => { if(!payload) return; let id = (typeof payload === 'string') ? payload : (payload._id || payload.id || (payload.deletedId||null)); if(!id) return; const idx = store.list.findIndex(r => (r._id||r.id) == id); if(idx > -1){ store.list.splice(idx,1); store.save(); render(); } });

// ====== Smart reload: fetch server orders and compare minimal diff ======
async function reloadFromServerIfChanged(){ try{ const serverList = await loadOrdersFromServer(); const localCount = store.list.length; const serverCount = serverList.length; let changed = false; if(localCount !== serverCount) changed = true; else { for(let i=0;i<serverList.length;i++){ const s = serverList[i]; const l = store.list.find(x => (x._id||x.id) == (s._id||s.id)); if(!l || (s.updatedAt && l.updatedAt && s.updatedAt !== l.updatedAt) || (s.createdAt && l.createdAt && s.createdAt !== l.createdAt)) { changed = true; break; } } } if(changed){ store.list = serverList; store.save(); render(); } }catch(err){ console.warn('Polling/load failed', err); setServerStatus(false); } }

async function checkServerHealth(){ try{ const res = await fetch((API_URL||'') + '/health'); if(!res.ok) throw new Error('health failed'); const j = await res.json(); setServerStatus(true, 'সার্ভার: অন'); return j; }catch(err){ setServerStatus(false, 'সার্ভার: অফলাইন'); throw err; } }

// One-off load at init
async function loadOrdersAndRender(){ try{ const serverList = await loadOrdersFromServer(); store.list = serverList; store.save(); render(); }catch(err){ log('Server load failed, using local store'); store.load(); render(); toast('সার্ভার নাও থাকতে পারে — লোকাল ডেটা দেখানো হচ্ছে'); setServerStatus(false); } }

// ====== Init: bind events and start ======
function bindUI(){
  const form = document.getElementById('orderForm'); if(form) form.addEventListener('submit', onFormSubmit);
  const btnClearForm = document.getElementById('btnClearForm'); if(btnClearForm) btnClearForm.addEventListener('click', ()=>{ document.getElementById('orderForm').reset(); document.getElementById('editingIndex').value=''; document.getElementById('orderPreview').textContent=''; toast('ফর্ম ক্লিয়ার হয়েছে'); });
  const btnAutoId = document.getElementById('btnAutoId'); if(btnAutoId) btnAutoId.addEventListener('click', ()=>{ document.getElementById('orderId').value = autoId(); toast('Auto ID সেট হয়েছে'); });
  const search = document.getElementById('search'); if(search) search.addEventListener('input', (e)=>{ state.query = e.target.value; state.page = 1; render(); });
  const pageSize = document.getElementById('pageSize'); if(pageSize) pageSize.addEventListener('change', (e)=>{ state.pageSize = +e.target.value; state.page=1; render(); });
  const btnClearAll = document.getElementById('btnClearAll'); if(btnClearAll) btnClearAll.addEventListener('click', ()=>{ if(confirm('সব ডাটা স্থায়ীভাবে মুছে যাবে। নিশ্চিত?')){ store.clear(); render(); toast('সব ডাটা মুছে ফেলা হয়েছে'); } });
  const btnExport = document.getElementById('btnExport'); if(btnExport) btnExport.addEventListener('click', exportCsv);
  const importCsv = document.getElementById('importCsv'); if(importCsv) importCsv.addEventListener('change', (e)=>{ const f = e.target.files[0]; if(f) importCsvFromFile(f).catch(err=>toast(String(err))); e.target.value=''; });

  // delegated click handler on tbody -> safer than attaching in render
  const tbody = document.querySelector('#dataTable tbody');
  if(tbody){
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if(!btn) return;
      const idx = +btn.getAttribute('data-idx');
      const action = btn.getAttribute('data-action');
      if(action === 'edit') edit(idx);
      if(action === 'delete') remove(idx);
    });
  }
}

async function init(){ bindUI(); store.load(); await loadOrdersAndRender(); startPolling();
  // health + queued sync
  try{ await checkServerHealth(); }catch(e){}
  window.addEventListener('online', ()=>{ setServerStatus(true); toast('অনলাইনে ফিরে এসেছি — সার্ভারের সাথে সিঙ্ক করা হচ্ছে'); processQueue().catch(()=>{}); loadOrdersAndRender(); });
  window.addEventListener('offline', ()=>{ setServerStatus(false); toast('অফলাইন — লোকাল ডেটা দেখানো হচ্ছে'); });

  if(navigator.onLine) setTimeout(processQueue, 1500);
}

// expose some functions globally (but avoid polluting too much)
window.edit = edit; window.remove = (idx)=> remove(idx); window.autoId = autoId;
window.exportCsv = exportCsv; window.importCsvFromFile = importCsvFromFile; window.onFormSubmit = onFormSubmit;

// Start
init();
