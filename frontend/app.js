// Served by the backend (localhost:5000, or a deployed domain like Railway):
// use relative /api, so it works on any host/port with no CORS issue.
// Only when opened locally on another port (e.g. Live Server :3000),
// fall back to localhost:5000.
const API = (window.location.hostname === 'localhost' && window.location.port && window.location.port !== '5000' ? 'http://localhost:5000' : '') + '/api';
const fmt = n => 'Rs ' + Number(n || 0).toLocaleString('en-PK');
const fmtDate = d => new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });

let currentUser = JSON.parse(localStorage.getItem('eventUser') || 'null');
let events = [], categories = [], myRegs = [], activeCategory = 'All';

// ---------- Presentation helpers (v2 design only — no API change) ----------
// Classic category tones for the card header bands.
const CAT_TONES = { Conference: 'tone-navy', Workshop: 'tone-gold', Concert: 'tone-burgundy', Seminar: 'tone-slate', Exhibition: 'tone-plum', Sports: 'tone-forest' };
const catTone = name => CAT_TONES[name] || 'tone-navy';
const dayOf = d => new Date(d).getDate();
const monthOf = d => new Date(d).toLocaleString('en-PK', { month: 'short' }).toUpperCase();
const seatsPct = ev => ev.capacity > 0 ? Math.round(((ev.capacity - ev.seats_left) / ev.capacity) * 100) : 0;

// Staggered fade-up entrance: cards reveal as they scroll into view.
const revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(entries => {
  entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('reveal-in'); revealObserver.unobserve(en.target); } });
}, { threshold: 0.08 }) : null;
function observeReveals(container) {
  if (!container) return;
  container.querySelectorAll('.card').forEach((card, i) => {
    card.style.animationDelay = Math.min(i * 70, 420) + 'ms';
    if (revealObserver) revealObserver.observe(card);
    else card.classList.add('reveal-in');
  });
}

// Count-up animation for dashboard stat numbers.
function animateCount(el) {
  const target = Number(el.dataset.count || 0);
  const money = el.dataset.fmt === 'money';
  if (!target) { el.textContent = money ? fmt(0) : '0'; return; }
  const start = performance.now(), dur = 900;
  (function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.round(target * eased);
    el.textContent = money ? fmt(val) : val.toLocaleString('en-PK');
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

async function api(path, opts) {
  const r = await fetch(API + path, opts);
  if (!r.ok) { let msg = await r.text(); try { msg = JSON.parse(msg).error || msg; } catch {} throw new Error(msg); }
  return r.json();
}
function setMsg(id, text, ok) {
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.className = 'msg' + (ok ? ' ok' : '');
  // Re-trigger the toast pop animation on every message.
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}

// ---------- Auth: login / registration forms ----------
function showAuth(which) {
  document.getElementById('loginForm').classList.toggle('hidden', which !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', which !== 'register');
  document.getElementById('tabLoginBtn').classList.toggle('active', which === 'login');
  document.getElementById('tabRegisterBtn').classList.toggle('active', which === 'register');
  setMsg('authMsg', '');
}
function fillDemo(email, pass) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = pass;
}
async function doLogin(e) {
  e.preventDefault();
  try {
    const user = await api('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('loginEmail').value.trim(), password: document.getElementById('loginPassword').value })
    });
    enterApp(user);
  } catch (err) { setMsg('authMsg', err.message); }
}
async function doRegister(e) {
  e.preventDefault();
  const pass = document.getElementById('regPassword').value;
  if (pass !== document.getElementById('regConfirm').value) { setMsg('authMsg', 'Passwords do not match'); return; }
  try {
    const user = await api('/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: document.getElementById('regName').value.trim(),
        email: document.getElementById('regEmail').value.trim(),
        phone: document.getElementById('regPhone').value.trim(),
        role: document.getElementById('regRole').value,
        password: pass
      })
    });
    setMsg('authMsg', 'Account created! Welcome, ' + user.full_name, true);
    enterApp(user);
  } catch (err) { setMsg('authMsg', err.message); }
}
function logout() {
  localStorage.removeItem('eventUser');
  currentUser = null;
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
}
function enterApp(user) {
  currentUser = user;
  localStorage.setItem('eventUser', JSON.stringify(user));
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  document.getElementById('userInfo').textContent = user.full_name + ' (' + user.role + ')  ';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.getElementById('heroGreeting').textContent = greet + ', ' + user.full_name.split(' ')[0];
  document.getElementById('createNote').textContent =
    (user.role === 'organizer' || user.role === 'admin')
      ? 'You can create events as ' + user.role + '.'
      : 'Only organizers and admins can create events. You are logged in as an attendee, so you can browse and register for events.';
  loadAll();
}

// ---------- Tabs ----------
function showTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'myregs') loadMyRegs();
  if (name === 'dashboard') loadDashboard();
}

// ---------- Data ----------
async function loadAll() {
  // Skeleton shimmer while the real data loads.
  const skeleton = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  document.getElementById('eventGrid').innerHTML = skeleton;
  document.getElementById('upcomingList').innerHTML = skeleton;
  try {
    document.getElementById('connStatus').textContent = 'Connected to backend';
    [events, categories] = await Promise.all([api('/events'), api('/categories')]);
    renderFilters(); renderEvents(); loadDashboard(); loadMyRegs();
  } catch (err) {
    document.getElementById('eventGrid').innerHTML = '';
    document.getElementById('upcomingList').innerHTML = '';
    setMsg('appMsg', 'Could not load events: ' + err.message + ' — is the backend running on port 5000?');
  }
}
function renderFilters() {
  const cats = ['All', ...categories.map(c => c.name)];
  document.getElementById('categoryFilters').innerHTML = cats.map(c =>
    `<button class="${c === activeCategory ? 'active' : ''}" onclick="setCategory('${c}')">${c}</button>`).join('');
  document.getElementById('evCategory').innerHTML = categories.map(c =>
    `<option value="${c.id}">${c.name}</option>`).join('');
}
function setCategory(c) { activeCategory = c; renderFilters(); renderEvents(); }

// Shared classic header band for an event card.
function cardBand(ev) {
  return `<div class="card-band ${catTone(ev.category)}">
    <span class="cat-tag">${ev.category || ''}</span>
    <span class="date-badge"><b>${dayOf(ev.event_date)}</b><span>${monthOf(ev.event_date)}</span></span>
  </div>`;
}

function renderEvents() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const list = events.filter(ev =>
    (activeCategory === 'All' || ev.category === activeCategory) &&
    (ev.title.toLowerCase().includes(q) || ev.venue.toLowerCase().includes(q)));
  const grid = document.getElementById('eventGrid');
  grid.innerHTML = list.map(ev => `
    <div class="card">
      ${cardBand(ev)}
      <div class="card-body">
        <h3>${ev.title}</h3>
        <p class="card-meta">${ev.organizer_name || ''}</p>
        <p class="card-meta">📍 ${ev.venue}</p>
        <p class="card-meta">📅 ${fmtDate(ev.event_date)}</p>
        <p class="card-desc">${ev.description || ''}</p>
        <div class="seats-bar ${ev.seats_left <= ev.capacity * 0.2 ? 'low' : ''}"><i style="width:${seatsPct(ev)}%"></i></div>
        <div class="card-foot"><span class="price">${Number(ev.price) ? fmt(ev.price) : 'Free'}</span>
        <span class="seats-note">${ev.seats_left} / ${ev.capacity} seats left</span></div>
        <div class="card-actions">
          <label>Tickets <input type="number" id="tickets-${ev.id}" value="1" min="1" max="${Math.max(1, ev.seats_left)}"></label>
          <button class="primary btn-shine" onclick="registerFor(${ev.id})" ${ev.seats_left <= 0 ? 'disabled' : ''}>
            ${ev.seats_left <= 0 ? 'Sold Out' : 'Register'}
          </button>
          ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'organizer')
            ? `<button onclick="viewAttendees(${ev.id}, '${ev.title.replace(/'/g, '')}')">Attendees</button>
               <button onclick="deleteEvent(${ev.id})">🗑️</button>` : ''}
        </div>
        <div id="att-${ev.id}" class="attendees"></div>
      </div>
    </div>`).join('') || '<div class="empty">No events found — try a different search or category.</div>';
  observeReveals(grid);
}

async function registerFor(eventId) {
  const tickets = document.getElementById('tickets-' + eventId).value;
  try {
    await api('/registrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, event_id: eventId, tickets })
    });
    setMsg('appMsg', 'Registered successfully!', true);
    await loadAll(); showTab('myregs');
  } catch (err) { setMsg('appMsg', err.message); }
}
async function loadMyRegs() {
  if (!currentUser) return;
  try {
    myRegs = await api('/registrations/user/' + currentUser.id);
    const list = document.getElementById('myRegList');
    list.innerHTML = myRegs.map(r => `
      <div class="card">
        ${cardBand({ category: r.category, event_date: r.event_date })}
        <div class="card-body">
          <h3>${r.title}</h3>
          <p class="card-meta">📍 ${r.venue} · 📅 ${fmtDate(r.event_date)}</p>
          <p>${r.tickets} ticket(s) · <span class="price">${fmt(r.total_amount)}</span></p>
          <p>Status: ${r.status}</p>
          ${r.status === 'confirmed' ? `<div class="card-actions"><button onclick="cancelReg(${r.id})">Cancel Registration</button></div>` : ''}
        </div>
      </div>`).join('') || '<div class="empty">You have no registrations yet. Browse Events to register.</div>';
    observeReveals(list);
  } catch (err) { setMsg('appMsg', err.message); }
}
async function cancelReg(id) {
  await api('/registrations/' + id + '/cancel', { method: 'PUT' });
  await loadAll(); loadMyRegs();
}
async function loadDashboard() {
  try {
    const d = await api('/dashboard?userId=' + (currentUser ? currentUser.id : ''));
    document.getElementById('stats').innerHTML = `
      <div class="stat"><b data-count="${d.total_events}">0</b>Total Events</div>
      <div class="stat"><b data-count="${d.upcoming_events}">0</b>Upcoming</div>
      <div class="stat"><b data-count="${d.total_registrations}">0</b>Registrations</div>
      <div class="stat"><b data-count="${d.my_registrations}">0</b>My Registrations</div>
      <div class="stat"><b data-count="${d.total_revenue}" data-fmt="money">Rs 0</b>Total Revenue</div>`;
    document.querySelectorAll('#stats b[data-count]').forEach(animateCount);
    const upcoming = document.getElementById('upcomingList');
    upcoming.innerHTML = d.upcoming_list.map(ev => `
      <div class="card">
        ${cardBand(ev)}
        <div class="card-body">
          <h3>${ev.title}</h3>
          <p class="card-meta">📍 ${ev.venue} · 📅 ${fmtDate(ev.event_date)}</p>
          <div class="card-foot"><span class="price">${Number(ev.price) ? fmt(ev.price) : 'Free'}</span>
          <span class="seats-note">${ev.seats_left} seats left</span></div>
        </div>
      </div>`).join('') || '<div class="empty">No upcoming events right now.</div>';
    observeReveals(upcoming);
  } catch (err) { /* dashboard stays empty if backend is down */ }
}
async function createEvent(e) {
  e.preventDefault();
  try {
    await api('/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('evTitle').value.trim(),
        category_id: document.getElementById('evCategory').value,
        organizer_id: currentUser.id,
        venue: document.getElementById('evVenue').value.trim(),
        event_date: document.getElementById('evDate').value,
        capacity: document.getElementById('evCapacity').value,
        price: document.getElementById('evPrice').value,
        description: document.getElementById('evDesc').value.trim()
      })
    });
    setMsg('appMsg', 'Event created!', true);
    document.getElementById('createForm').reset();
    await loadAll(); showTab('events');
  } catch (err) { setMsg('appMsg', err.message); }
}
async function viewAttendees(eventId, title) {
  const list = await api('/registrations/event/' + eventId);
  document.getElementById('att-' + eventId).innerHTML =
    '<p class="muted">Attendees for ' + title + ': ' +
    (list.filter(r => r.status === 'confirmed').map(r => `${r.full_name} (${r.tickets})`).join(', ') || 'none yet') + '</p>';
}
async function deleteEvent(id) {
  if (!confirm('Delete this event? Its registrations will also be removed.')) return;
  await api('/events/' + id, { method: 'DELETE' });
  await loadAll();
}

// ---------- Startup ----------
(async () => {
  try {
    await api('/health');
    document.getElementById('connStatus').textContent = '✅ Connected to backend';
  } catch {
    document.getElementById('connStatus').textContent = '⚠️ Backend not running yet — log in will need the backend on port 5000. See README.';
  }
  if (currentUser) enterApp(currentUser);
})();
