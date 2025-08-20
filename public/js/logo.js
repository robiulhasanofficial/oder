// public/js/login.js
(function () {
  // যদি এই HTML ফাইলটি Express public থেকে serve হয়, তবে RELATIVE ব্যবহার করুন:
  const LOCAL_API = '/api/login';          // same-origin case
  const LIVE_SERVER_FALLBACK = 'http://localhost:3000/api/login'; // যখন live-server(5500) থেকে খুলবেন

  const API_URL = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
    && window.location.port === '5500'
    ? LIVE_SERVER_FALLBACK
    : LOCAL_API;

  const form = document.getElementById('login-form');
  const msg = document.getElementById('message');

  if (!form) {
    console.warn('[login.js] login-form not found in DOM');
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.style.color = 'red';
    msg.textContent = '';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      msg.textContent = 'ইমেইল ও পাসওয়ার্ড পূরণ করুন';
      return;
    }

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      let data;
      try { data = await res.json(); } catch (e) { data = {}; }

      if (res.ok && data.ok) {
        msg.style.color = 'green';
        msg.textContent = '✅ লগইন সফল — রিডাইরেক্ট করা হচ্ছে...';
        setTimeout(() => { window.location.href = '/index.html'; }, 600);
      } else {
        msg.style.color = 'red';
        msg.textContent = data.error || `লগইন ব্যর্থ (status ${res.status})`;
      }
    } catch (err) {
      msg.style.color = 'red';
      msg.textContent = 'নেটওয়ার্ক বা সার্ভার সমস্যা: ' + err.message;
    }
  });
})();
