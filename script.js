// script.js — Local + Socket.IO realtime sync (last-write-wins)
const ACCESS_CODE = "5jehad999"; // 👉 তোমার সিক্রেট কোড

// ================= নতুন গ্লোবাল ভেরিয়েবল =================
let currentUser = null;
let onlineUsers = new Map();
let isOrderLocked = false;
let socket = null;

// ================= লগইন সিস্টেম =================
function initLoginSystem() {
    const loginModal = document.getElementById('loginModal');
    const mainContent = document.getElementById('mainContent');
    const loginForm = document.getElementById('loginForm');

    // localStorage থেকে লগইন স্টেট চেক করুন
    const savedUser = localStorage.getItem('currentUser');
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';

    if (isLoggedIn && savedUser) {
        currentUser = JSON.parse(savedUser);
        showMainContent();
    } else {
        showLoginModal();
    }

    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const userName = document.getElementById('userName').value.trim();
        const userPassword = document.getElementById('userPassword').value.trim();

        if (!userName) {
            toast('নাম প্রয়োজন');
            return;
        }

        if (userPassword !== ACCESS_CODE) {
            toast('ভুল পাসওয়ার্ড');
            return;
        }

        // লগইন সফল
        currentUser = {
            name: userName,
            id: 'user_' + Math.random().toString(36).slice(2),
            loginTime: Date.now()
        };

        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        localStorage.setItem('isLoggedIn', 'true');

        showMainContent();
        initSocketConnection();
        toast('লগইন সফল! ✅');
    });
}

function showLoginModal() {
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('mainContent').style.display = 'none';
}

function showMainContent() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
}

function logout() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    localStorage.setItem('isLoggedIn', 'false');
    onlineUsers.delete(currentUser?.id);
    updateOnlineUsers();
    showLoginModal();
    toast('লগআউট করা হয়েছে');
}

// ================= অনলাইন ইউজার ম্যানেজমেন্ট =================
function initSocketConnection() {
    try {
        if (typeof io !== 'undefined') {
            socket = io(SOCKET_URL);
            
            socket.on('connect', () => {
                console.log('Socket connected', socket.id);
                // সার্ভারে ইউজার ইনফো সেন্ড করুন
                socket.emit('user:join', currentUser);
                toast('রিয়েল-টাইম কানেকশন সফল ✅');
            });

            socket.on('disconnect', () => {
                console.log('Socket disconnected');
                toast('কানেকশন বিচ্ছিন্ন ❌');
            });

            socket.on('connect_error', (err) => {
                console.warn('Socket connect error', err);
            });

            socket.on('users:update', (users) => {
                onlineUsers = new Map(users);
                updateOnlineUsers();
            });

            socket.on('order:lockStatus', (status) => {
                isOrderLocked = status.isLocked;
                updateOrderLockUI();
            });

            // বিদ্যমান orders সিঙ্ক ইভেন্টগুলি
            socket.on('orders:sync', payload => { onRemotePayload(payload, 'socket'); });
            socket.on('orders:full', payload => { onRemotePayload(payload, 'socket-full'); });
            socket.on('orders:hello', (payload) => {
                if (payload.lastUpdated > store.lastUpdated) {
                    onRemotePayload(payload, 'socket-hello');
                }
            });

        } else {
            console.warn('Socket.IO client not found — realtime features disabled');
        }
    } catch(e) {
        console.warn('Socket init error', e);
    }
}

function updateOnlineUsers() {
    const countElement = document.getElementById('connectedUsersCount');
    const userListContent = document.getElementById('userListContent');
    
    if (countElement) {
        countElement.textContent = `${onlineUsers.size} অনলাইন`;
    }
    
    if (userListContent) {
        userListContent.innerHTML = '';
        onlineUsers.forEach((user, userId) => {
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            
            const avatar = document.createElement('div');
            avatar.className = 'user-avatar';
            avatar.textContent = user.name.charAt(0).toUpperCase();
            
            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';
            userInfo.innerHTML = `
                <strong>${escapeHtml(user.name)}</strong>
                <div class="muted">${new Date(user.joinTime).toLocaleTimeString('bn-BD')}</div>
            `;
            
            userItem.appendChild(avatar);
            userItem.appendChild(userInfo);
            userListContent.appendChild(userItem);
        });
    }
}

// ইউজার কাউন্টার ক্লিক ইভেন্ট
document.addEventListener('click', function(e) {
    if (e.target.closest('#connectedUsersCount')) {
        const dropdown = document.getElementById('userListDropdown');
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    } else {
        // বাইরে ক্লিক করলে ড্রপডাউন বন্ধ
        const dropdown = document.getElementById('userListDropdown');
        if (!e.target.closest('.user-counter-container')) {
            dropdown.style.display = 'none';
        }
    }
});

// ================= তারিখ ও বিদ্যালয় সার্চ =================
function initSearchFilters() {
    const searchDate = document.getElementById('searchDate');
    const searchSchool = document.getElementById('searchSchool');
    const btnSearch = document.getElementById('btnSearchByDateSchool');
    const btnReset = document.getElementById('btnResetSearch');

    btnSearch.addEventListener('click', function() {
        const date = searchDate.value;
        const school = searchSchool.value.trim().toLowerCase();
        
        if (!date && !school) {
            toast('কমপক্ষে একটি ফিল্ড পূরণ করুন');
            return;
        }

        state.searchDate = date;
        state.searchSchool = school;
        state.page = 1;
        render();
        
        let message = 'সার্চ ফলাফল: ';
        if (date) message += `তারিখ: ${date} `;
        if (school) message += `বিদ্যালয়: ${school}`;
        toast(message);
    });

    btnReset.addEventListener('click', function() {
        searchDate.value = '';
        searchSchool.value = '';
        state.searchDate = '';
        state.searchSchool = '';
        state.page = 1;
        render();
        toast('সার্চ রিসেট করা হয়েছে');
    });
}

// রেন্ডার ফাংশন আপডেট - তারিখ ও বিদ্যালয় সার্চ যোগ করুন
const originalRender = render;
render = function() {
    const q = state.query.toLowerCase();
    const searchDate = state.searchDate;
    const searchSchool = state.searchSchool.toLowerCase();
    const counts = {};
    store.list.forEach(r => { const k = (r.orderId||'').toString(); counts[k] = (counts[k]||0) + 1; });

    const filtered = store.list.map((x, idx) => ({...x, _idx: idx}))
        .filter(row => {
            // সাধারণ সার্চ
            const matchesGeneral = (
                (row.name||'').toString().toLowerCase().includes(q) ||
                (row.orderName||'').toString().toLowerCase().includes(q) ||
                (row.orderId||'').toString().toLowerCase().includes(q) ||
                (row.phone||'').toString().toLowerCase().includes(q) ||
                (row.school||'').toString().toLowerCase().includes(q)
            );

            // তারিখ সার্চ
            let matchesDate = true;
            if (searchDate) {
                const rowDate = row.orderDateTime ? new Date(row.orderDateTime).toISOString().split('T')[0] : '';
                matchesDate = rowDate === searchDate;
            }

            // বিদ্যালয় সার্চ
            let matchesSchool = true;
            if (searchSchool) {
                matchesSchool = (row.school||'').toString().toLowerCase().includes(searchSchool);
            }

            return matchesGeneral && matchesDate && matchesSchool;
        });

    // বাকি কোড অপরিবর্তিত
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
};

// ================= অর্ডার লক/আনলক সিস্টেম =================
function initOrderLockSystem() {
    const orderLockBtn = document.getElementById('orderLockBtn');
    const orderForm = document.getElementById('orderForm');
    const orderBlockMessage = document.getElementById('orderBlockMessage');

    orderLockBtn.addEventListener('click', function() {
        if (isOrderLocked) {
            // আনলক করতে চাইলে পাসওয়ার্ড চেক
            const password = prompt('অর্ডার আনলক করতে পাসওয়ার্ড দিন:');
            if (password === ACCESS_CODE) {
                toggleOrderLock(false);
                toast('অর্ডার সিস্টেম আনলক করা হয়েছে ✅');
            } else if (password !== null) {
                toast('ভুল পাসওয়ার্ড! অনুমতি denied ❌');
            }
        } else {
            // লক করতে চাইলে সরাসরি লক করবে
            toggleOrderLock(true);
            toast('অর্ডার সিস্টেম লক করা হয়েছে 🔒');
        }
    });

    // ফর্ম সাবমিশন চেক
    orderForm.addEventListener('submit', function(e) {
        if (isOrderLocked) {
            e.preventDefault();
            toast('অর্ডার সিস্টেম বন্ধ আছে! নতুন অর্ডার গ্রহণ করা হচ্ছে না ❌');
            return false;
        }
    });
}

function toggleOrderLock(lockStatus) {
    isOrderLocked = lockStatus;
    
    // UI আপডেট
    updateOrderLockUI();
    
    // সার্ভারে স্টেট সেন্ড করুন
    if (socket) {
        socket.emit('order:lockToggle', { 
            isLocked: lockStatus, 
            userId: currentUser?.id,
            userName: currentUser?.name 
        });
    }
    
    // লোকাল স্টোরেজে সেভ করুন
    localStorage.setItem('orderLockStatus', lockStatus.toString());
}

function updateOrderLockUI() {
    const orderLockBtn = document.getElementById('orderLockBtn');
    const orderBlockMessage = document.getElementById('orderBlockMessage');
    const mainContent = document.getElementById('mainContent');
    const btnSave = document.getElementById('btnSave');

    if (isOrderLocked) {
        // লক করা অবস্থা
        orderLockBtn.innerHTML = `
            <svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 1 5 5v3h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3zm-7 8v8h14v-8H5zm7 2a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1z"/></svg>
            অর্ডার আনলক
        `;
        orderLockBtn.className = 'btn btn-success';
        orderBlockMessage.style.display = 'flex';
        mainContent.classList.add('order-form-locked');
        
        if (btnSave) {
            btnSave.disabled = true;
            btnSave.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M12 1a11 11 0 1 0 11 11A11 11 0 0 0 12 1zm0 2a9 9 0 1 1-9 9 9 9 0 0 1 9-9zm0 4a5 5 0 1 0 5 5 5 5 0 0 0-5-5z"/></svg>
                অর্ডার বন্ধ
            `;
        }
    } else {
        // আনলক করা অবস্থা
        orderLockBtn.innerHTML = `
            <svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 1 5 5v3h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z"/></svg>
            অর্ডার লক
        `;
        orderLockBtn.className = 'btn btn-warning';
        orderBlockMessage.style.display = 'none';
        mainContent.classList.remove('order-form-locked');
        
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M5 5h14v14H5V5zm2 2v10h10V7H7zm2 2h6v2H9V9z"/></svg>
                সংরক্ষণ
            `;
        }
    }
}

// ================= মেইন ইনিশিয়ালাইজেশন =================
function initApp() {
    // প্রথমে অ্যাক্সেস কোড চেক
    if (localStorage.getItem("access_granted") !== "true") {
        const userCode = prompt("Enter Access Code:");
        if (userCode !== ACCESS_CODE) {
            document.documentElement.innerHTML = "<h2 style='color:red;text-align:center;margin-top:100px;'>❌ Access Denied</h2>";
            throw new Error("Access Denied");
        } else {
            localStorage.setItem("access_granted", "true");
        }
    }

    console.log("Access Granted ✅");

    // লগইন সিস্টেম ইনিশিয়ালাইজ
    initLoginSystem();

    // স্টোর লোড
    store.load();

    // অর্ডার লক স্টেট চেক
    const savedLockStatus = localStorage.getItem('orderLockStatus');
    if (savedLockStatus) {
        isOrderLocked = savedLockStatus === 'true';
    }

    // ইভেন্ট লিসেনার সেটআপ
    initEventListeners();
    initSearchFilters();
    initOrderLockSystem();

    // প্রাথমিক রেন্ডার
    render();
    updateOrderLockUI();

    // যদি ইতিমধ্যে লগড ইন থাকে, সকেট কানেকশন শুরু করুন
    if (currentUser) {
        initSocketConnection();
    }
}

// ================= বিদ্যমান ফাংশনগুলি রাখুন =================
// Toast function
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

// Store, helpers, এবং অন্যান্য বিদ্যমান ফাংশনগুলি এখানে রাখুন...
// (আপনার পূর্ববর্তী সমস্ত store, helper, render, edit, remove ফাংশনগুলি এখানে থাকবে)

// ================= Config =================
const SOCKET_URL = 'https://oder-gjta.onrender.com';
const STORE_KEY = 'orders_store_v4_with_amount';
const SYNC_KEY = 'orders_store_sync_msg_v1';
const CHANNEL_NAME = 'orders_channel_v1';
const clientId = localStorage.getItem('orders_client_id') || (function(){ const id = 'c_' + Math.random().toString(36).slice(2); localStorage.setItem('orders_client_id', id); return id; })();

// Store (with lastUpdated)
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

// Helpers
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

// State
let state = { 
    sortKey: 'createdAt', 
    sortDir: 'desc', 
    page: 1, 
    pageSize: 10, 
    query: '',
    searchDate: '',
    searchSchool: ''
};

// বাকি বিদ্যমান কোডগুলি (edit, remove, form events, export/import, sync functions) 
// এখানে রাখুন... তারা একই থাকবে

// ================= ইভেন্ট লিসেনার সেটআপ =================
function initEventListeners() {
    // বিদ্যমান ইভেন্ট লিসেনারগুলি এখানে রাখুন
    // orderForm, btnClearForm, btnAutoId, search, pageSize, btnExport, importCsv, btnClearAll
}

// ================= অ্যাপ শুরু =================
// DOM কন্টেন্ট লোড হওয়ার পর অ্যাপ ইনিশিয়ালাইজ করুন
document.addEventListener('DOMContentLoaded', function() {
    initApp();
});

// F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U block
document.addEventListener('keydown', e => {
    if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key.toUpperCase())) ||
        (e.ctrlKey && e.key.toUpperCase() === 'U')
    ) {
        e.preventDefault();
        alert('Inspect blocked!');
    }
});

// বিদ্যমান sync-related functions (publishChange, onRemotePayload, initSyncAnnounce) 
// এখানে রাখুন - তারা একই থাকবে