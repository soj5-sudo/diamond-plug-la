// ===== Diamond Plug LA — main app (Phase 3) =====
import { supabase } from './config.js';
import { DB, estimatePrice, money, PRICE_DEFAULTS } from './db.js';
import { createViewer, parseByExt } from './viewer.js';
import { askAssistant, diamondArt, ringArt } from './chatbot.js';

// Built-in admin (shared account — no Supabase auth user needed)
const ADMIN_USER = 'Diamond Plug LA';
const ADMIN_PASS = 'Diamond Plug LA';
const ADMIN_PROFILE = { id: 'admin-builtin', name: 'Diamond Plug LA', email: 'admin', role: 'admin', builtin: true };

let ME = null;
let IS_ADMIN = false;
let activeViewer = null;

const $ = id => document.getElementById(id);
const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseRole = r => (r || '').replace('pending_', '');
const isPending = r => (r || '').startsWith('pending_');

Object.assign(window, {
  scrollToId, openAuth, closeAuth, setAuthMode, submitAuth, startCustom, signOut, go: navTo
});

// ---------- landing art ----------
function paintLanding() {
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  set('art1', diamondArt()); set('art2', ringArt()); set('art3', diamondArt('#5b7fa6')); set('art4', ringArt()); set('craftArt', ringArt());
}
function scrollToId(id) { $(id)?.scrollIntoView({ behavior: 'smooth' }); }

// ---------- AUTH ----------
let authMode = 'signup';
function openAuth(mode) { setAuthMode(mode); $('authOverlay').classList.add('active'); $('authError').textContent = ''; }
function closeAuth() { $('authOverlay').classList.remove('active'); }
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('tabSignup').classList.toggle('active', signup);
  $('tabLogin').classList.toggle('active', !signup);
  $('authTitle').textContent = signup ? 'Create your account' : 'Sign in';
  $('authDesc').textContent = signup ? 'Join as a client or designer — approved by our team.' : 'Clients & designers sign in here. Admin: use your staff credentials.';
  $('authSubmit').textContent = signup ? 'Create Account' : 'Sign In';
  $('authNameField').style.display = signup ? '' : 'none';
  $('authRoleField').style.display = signup ? '' : 'none';
  $('authNote').style.display = signup ? '' : 'none';
  $('authEmailLabel').textContent = signup ? 'Email' : 'Email or admin username';
  $('authError').textContent = '';
}

async function submitAuth() {
  const emailRaw = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const errEl = $('authError'); errEl.style.color = 'var(--red)'; errEl.textContent = '';

  // Admin built-in login (only on sign-in)
  if (authMode === 'login' && emailRaw === ADMIN_USER && password === ADMIN_PASS) {
    ME = ADMIN_PROFILE; IS_ADMIN = true;
    closeAuth(); await boot(); return;
  }

  if (!emailRaw || !password) { errEl.textContent = 'Enter your email and password.'; return; }
  $('authSubmit').textContent = 'Please wait…';
  try {
    if (authMode === 'signup') {
      const name = $('authName').value.trim();
      const role = 'pending_' + $('authRole').value; // pending until admin approves
      if (!name) { errEl.textContent = 'Enter your name.'; $('authSubmit').textContent = 'Create Account'; return; }
      const { error } = await supabase.auth.signUp({ email: emailRaw, password, options: { data: { name, role } } });
      if (error) throw error;
      const { error: e2 } = await supabase.auth.signInWithPassword({ email: emailRaw, password });
      if (e2) {
        errEl.style.color = 'var(--green)';
        errEl.textContent = 'Account created! Confirm your email if asked, then sign in. Admin will approve you.';
        $('authSubmit').textContent = 'Create Account'; setAuthMode('login'); return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: emailRaw, password });
      if (error) throw error;
    }
    closeAuth(); await boot();
  } catch (e) {
    errEl.style.color = 'var(--red)';
    errEl.textContent = e.message || 'Something went wrong.';
    $('authSubmit').textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
  }
}

async function signOut() {
  if (!IS_ADMIN) await supabase.auth.signOut();
  ME = null; IS_ADMIN = false; location.reload();
}

// ---------- BOOT ----------
async function boot() {
  if (!IS_ADMIN) {
    ME = await DB.myProfile();
    if (!ME) return; // stay on landing
  }
  $('landing').style.display = 'none';
  $('app').classList.add('active');

  // pending approval gate
  if (!IS_ADMIN && isPending(ME.role)) {
    $('sideUser').textContent = `${ME.name} · Pending`;
    $('customBtn').style.display = 'none';
    $('navMenu').innerHTML = '';
    $('pageTitle').textContent = 'Awaiting Approval';
    $('topActions').innerHTML = '';
    $('content').innerHTML = `<div class="empty"><div class="empty-title">Your account is awaiting approval</div><div class="empty-desc">Our admin team reviews new ${baseRole(ME.role)} accounts before granting access. You'll be able to sign in fully once approved. Thank you for your patience.</div><button class="btn" style="margin-top:22px" onclick="signOut()">Sign out</button></div>`;
    return;
  }

  const role = IS_ADMIN ? 'admin' : baseRole(ME.role);
  ME.role = role;
  $('sideUser').textContent = `${ME.name} · ${cap(role)}`;
  $('customBtn').style.display = role === 'client' ? '' : 'none';
  await buildNav();
  navTo(defaultView());
}

function defaultView() { return { client: 'orders', designer: 'queue', admin: 'dash' }[ME.role]; }

// ---------- NAV ----------
const NAV = {
  client: [['orders', 'My Pieces', 'box'], ['notifs', 'Updates', 'bell']],
  designer: [['queue', 'Assigned', 'layers'], ['notifs', 'Updates', 'bell']],
  admin: [['dash', 'Dashboard', 'grid'], ['orders', 'All Orders', 'box'], ['approvals', 'Approvals', 'check'], ['people', 'Users', 'users'], ['pricing', 'Pricing', 'tag'], ['notifs', 'Activity', 'bell']]
};
const ICON = {
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
};
const svgIcon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ''}</svg>`;

async function buildNav() {
  const menu = $('navMenu'); menu.innerHTML = '';
  const unread = IS_ADMIN ? 0 : await DB.unread(ME);
  let pending = 0;
  if (ME.role === 'admin') pending = (await DB.pendingUsers()).length;
  for (const [id, label, ic] of NAV[ME.role]) {
    const b = document.createElement('button');
    b.className = 'nav-item'; b.dataset.view = id;
    let badge = '';
    if (id === 'notifs' && unread) badge = `<span class="nav-badge">${unread}</span>`;
    if (id === 'approvals' && pending) badge = `<span class="nav-badge">${pending}</span>`;
    b.innerHTML = svgIcon(ic) + `<span>${label}</span>` + badge;
    b.onclick = () => navTo(id);
    menu.appendChild(b);
  }
}

async function navTo(view) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  const titles = { orders: ME.role === 'admin' ? 'All Orders' : 'My Pieces', queue: 'Assigned Orders', dash: 'Dashboard', approvals: 'Account Approvals', people: 'Users', pricing: 'Pricing Model', notifs: ME.role === 'admin' ? 'Activity' : 'Updates' };
  $('pageTitle').textContent = titles[view] || 'Dashboard';
  $('topActions').innerHTML = '';
  const C = $('content'); C.innerHTML = '<div style="padding:50px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    if (ME.role === 'client' && view === 'orders') return renderClientOrders(C);
    if (ME.role === 'designer' && view === 'queue') return renderDesignerQueue(C);
    if (ME.role === 'admin' && view === 'dash') return renderAdminDash(C);
    if (ME.role === 'admin' && view === 'orders') return renderAdminOrders(C);
    if (ME.role === 'admin' && view === 'approvals') return renderApprovals(C);
    if (ME.role === 'admin' && view === 'people') return renderUsers(C);
    if (ME.role === 'admin' && view === 'pricing') return renderPricing(C);
    if (view === 'notifs') return renderNotifs(C);
  } catch (e) { C.innerHTML = `<div class="empty"><div class="empty-title">Couldn't load</div><div class="empty-desc">${esc(e.message)}</div></div>`; }
}

// ---------- CLIENT ----------
async function renderClientOrders(C) {
  $('topActions').innerHTML = `<button class="btn gold" onclick="startCustom()">✦ Request Custom Piece</button>`;
  const orders = await DB.ordersForClient(ME.id);
  if (!orders.length) {
    C.innerHTML = empty('No pieces yet', 'Click <b>Request Custom Piece</b> to tell our team what you want. Our designers will create it and send you a 3D design to review.', 'Request Custom Piece', 'startCustom()');
    return;
  }
  const rows = await Promise.all(orders.map(async o => {
    const d = await DB.latestDesign(o.id);
    const ready = d && o.status === 'review';
    return `<tr class="clickable" onclick="DPLA.clientOpen('${o.id}')">
      <td><div style="font-weight:600;color:var(--ink)">${esc(o.title)}</div><div style="font-size:11px;color:var(--faint)">${o.code}</div></td>
      <td>${d ? `<span style="color:var(--gold)">v${d.version} ready</span>` : '<span style="color:var(--faint)">in design</span>'}</td>
      <td>${badge(o.status)}</td>
      <td>${o.price != null ? `<span style="color:var(--gold);font-weight:600">${money(o.price)}</span>` : '<span style="color:var(--faint)">—</span>'}</td>
      <td style="text-align:right">${ready ? '<span class="badge review">New update</span>' : `<span style="color:var(--gold);font-size:12px">Open →</span>`}</td></tr>`;
  }));
  C.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><table><thead><tr><th>Piece</th><th>Design</th><th>Status</th><th>Est. Price</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function clientOpen(orderId) {
  await openViewerModal(orderId, async (order, design) => {
    const revs = await DB.revisionsForOrder(orderId);
    const canApprove = design && !['approved', 'production'].includes(order.status);
    return `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
        <button class="btn gold" onclick="DPLA.chat('${orderId}')">Send feedback / request a change</button>
        <button class="btn" onclick="DPLA.estimator('${orderId}','client')">Price estimator</button>
        ${canApprove ? `<button class="btn" onclick="DPLA.approve('${orderId}')">Approve this design</button>` : ''}
        ${order.status === 'approved' ? '<div class="badge approved" style="justify-content:center;padding:10px">Approved · in production</div>' : ''}
      </div>
      <div class="section-title" style="margin-bottom:10px">Your feedback history</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${revs.length ? revs.map(r => `<div style="font-size:12px;padding:10px;background:var(--cream);border-radius:3px"><div style="color:var(--muted);margin-bottom:3px">${ago(r.created_at)} · ${r.status}</div>${esc(r.note)}</div>`).join('') : '<div style="font-size:12px;color:var(--faint)">No feedback yet.</div>'}
      </div>`;
  });
}

async function approve(orderId) {
  const o = await DB.updateOrder(orderId, { status: 'approved' });
  await DB.notify({ role: 'admin' }, `Client approved ${o.code} — ready for production.`);
  if (o.designer_id) await DB.notify({ userId: o.designer_id }, `${o.code} approved by client.`);
  toast('Approved', 'Sent to production.', 'success');
  closeModal(); navTo('orders');
}

// client requests a custom piece (chat only — never uploads files)
async function startCustom() {
  const order = await DB.createOrder(ME.id, 'Custom piece');
  await DB.notify({ role: 'admin' }, `New custom request from ${ME.name} (${order.code}).`);
  openChat(order.id, true);
}

// ---------- DESIGNER (upload only) ----------
async function renderDesignerQueue(C) {
  const orders = await DB.ordersForDesigner(ME.id);
  if (!orders.length) { C.innerHTML = empty('No orders assigned', 'When the admin assigns you an order, it appears here. Your job: upload the design file (STL / 3DM render in 3D; any file type is accepted).'); return; }
  const rows = await Promise.all(orders.map(async o => {
    const d = await DB.latestDesign(o.id);
    const client = o.client_id ? await DB.profile(o.client_id) : null;
    const revs = await DB.revisionsForOrder(o.id);
    const open = revs.filter(r => r.status === 'open').length;
    return `<tr class="clickable" onclick="DPLA.designerOpen('${o.id}')">
      <td><div style="font-weight:600;color:var(--ink)">${esc(o.title)}</div><div style="font-size:11px;color:var(--faint)">${o.code}</div></td>
      <td>${client ? esc(client.name) : '—'}</td>
      <td>${d ? `v${d.version} · ${d.format}` : '<span style="color:var(--faint)">none</span>'}</td>
      <td>${open ? `<span style="color:var(--amber)">${open} to address</span>` : '<span style="color:var(--faint)">0</span>'}</td>
      <td>${badge(o.status)}</td>
      <td style="text-align:right;color:var(--gold);font-size:12px">Open →</td></tr>`;
  }));
  C.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><table><thead><tr><th>Order</th><th>Client</th><th>Latest</th><th>Feedback</th><th>Status</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function designerOpen(orderId) {
  await openViewerModal(orderId, async (order) => {
    const revs = await DB.revisionsForOrder(orderId);
    return `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
        <button class="btn gold" onclick="DPLA.upload('${orderId}')">Upload design file</button>
        <div style="font-size:11px;color:var(--muted);text-align:center">STL & 3DM render in 3D for the client. Any file type accepted.</div>
      </div>
      <div class="section-title" style="margin-bottom:10px">Client feedback</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${revs.length ? revs.map(r => `<div style="font-size:12px;padding:10px;background:var(--cream);border-radius:3px;border-left:2px solid ${r.status === 'open' ? 'var(--amber)' : 'var(--green)'}"><div style="color:var(--muted);margin-bottom:5px">${ago(r.created_at)} · ${r.status}</div><div style="margin-bottom:6px">${esc(r.structured || r.note)}</div>${r.status === 'open' ? `<button class="btn sm" onclick="DPLA.resolveRev('${r.id}','${orderId}')">Mark addressed</button>` : ''}</div>`).join('') : '<div style="font-size:12px;color:var(--faint)">No feedback yet.</div>'}
      </div>`;
  });
}

async function resolveRev(revId, orderId) { await DB.resolveRevision(revId); toast('Marked addressed', 'Upload the new version to update the client.', 'success'); designerOpen(orderId); }

async function upload(orderId) {
  const input = $('fileInput'); input.value = ''; input.removeAttribute('accept'); // any file type
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const renderable = ['stl', 'obj', '3dm'].includes(ext);
    toast('Uploading', file.name + '…');
    try {
      let tris = null;
      if (renderable) { const buf = await file.arrayBuffer(); const parsed = await parseByExt(ext, buf.slice(0)); tris = parsed.triangleCount; }
      const existing = await DB.designsForOrder(orderId);
      const version = existing.length + 1;
      const path = await DB.uploadFile(orderId, version, file);
      const design = await DB.addDesign(orderId, { file_name: file.name, format: ext.toUpperCase(), storage_path: path, triangle_count: tris, dimensions: '', uploaded_by: ME.id });
      const o = await DB.updateOrder(orderId, { status: 'review' });
      if (o.client_id) await DB.notify({ userId: o.client_id }, `Your design for ${o.code} is ready — v${design.version}. Open to view in 3D.`);
      await DB.notify({ role: 'admin' }, `Designer uploaded v${design.version} for ${o.code}.`);
      toast('Uploaded', renderable ? 'Client notified · renders in 3D.' : 'Client notified · file delivered.', 'success');
      designerOpen(orderId);
    } catch (err) { toast('Upload failed', err.message, 'error'); }
  };
  input.click();
}

// ---------- ADMIN ----------
async function renderAdminDash(C) {
  const orders = await DB.allOrders();
  const inProg = orders.filter(o => ['new', 'progress', 'review'].includes(o.status)).length;
  const done = orders.filter(o => ['approved', 'production', 'done'].includes(o.status)).length;
  const revenue = orders.filter(o => o.price).reduce((s, o) => s + Number(o.price), 0);
  const pending = (await DB.pendingUsers()).length;
  const clients = (await DB.approvedByRole('client')).length;
  const designers = (await DB.approvedByRole('designer')).length;
  C.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:24px">
      <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value">${inProg}</div></div>
      <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value">${done}</div></div>
      <div class="stat-card"><div class="stat-label">Pipeline Value</div><div class="stat-value gold">${revenue ? '$' + Math.round(revenue / 1000) + 'k' : '$0'}</div></div>
      <div class="stat-card"><div class="stat-label">Pending Approvals</div><div class="stat-value">${pending}</div><div class="stat-meta">${clients} clients · ${designers} designers</div></div>
    </div>
    ${pending ? `<div class="card" style="margin-bottom:24px;border-left:3px solid var(--amber)"><div style="display:flex;justify-content:space-between;align-items:center"><div><b>${pending}</b> account${pending > 1 ? 's' : ''} awaiting your approval</div><button class="btn gold sm" onclick="DPLA.go('approvals')">Review →</button></div></div>` : ''}
    <div class="section-head"><div class="section-title">Recent Orders</div><button class="btn sm" onclick="DPLA.go('orders')">View all</button></div>
    ${orders.length ? await orderTable(orders.slice(0, 7)) : empty('No orders yet', 'Client requests appear here for you to assign, message, and price.')}`;
}
async function renderAdminOrders(C) {
  const orders = await DB.allOrders();
  C.innerHTML = orders.length ? await orderTable(orders) : empty('No orders yet', 'Client requests show up here.');
}
async function orderTable(orders) {
  const rows = await Promise.all(orders.map(async o => {
    const c = o.client_id ? await DB.profile(o.client_id) : null;
    const d = o.designer_id ? await DB.profile(o.designer_id) : null;
    return `<tr class="clickable" onclick="DPLA.adminOpen('${o.id}')">
      <td><div style="font-weight:600;color:var(--ink)">${esc(o.title)}</div><div style="font-size:11px;color:var(--faint)">${o.code}</div></td>
      <td>${c ? esc(c.name) : '—'}</td>
      <td>${d ? esc(d.name) : '<span style="color:var(--amber)">unassigned</span>'}</td>
      <td>${badge(o.status)}</td>
      <td>${o.price != null ? `<span style="color:var(--gold);font-weight:600">${money(o.price)}</span>` : '—'}</td>
      <td style="text-align:right;color:var(--gold);font-size:12px">Manage →</td></tr>`;
  }));
  return `<div class="card" style="padding:0;overflow:hidden"><table><thead><tr><th>Order</th><th>Client</th><th>Designer</th><th>Status</th><th>Price</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// Admin master control: sees 3D, chat log, can message client OR designer, assign, price
async function adminOpen(orderId) {
  const designers = await DB.approvedByRole('designer');
  await openViewerModal(orderId, async (order) => {
    const revs = await DB.revisionsForOrder(orderId);
    return `
      <div class="section-title" style="margin-bottom:10px">Assign designer</div>
      <select class="btn" style="width:100%;text-align:left;margin-bottom:14px" onchange="DPLA.assign('${orderId}',this.value)">
        <option value="">— unassigned —</option>
        ${designers.map(d => `<option value="${d.id}" ${order.designer_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
      </select>
      <div class="section-title" style="margin-bottom:8px">Price</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input id="adminPrice" type="number" placeholder="0.00" value="${order.price ?? ''}" style="flex:1;background:var(--surface);border:1px solid var(--border2);border-radius:2px;padding:10px;color:var(--ink);outline:none">
        <button class="btn gold" onclick="DPLA.setPrice('${orderId}')">Set</button>
      </div>
      <button class="btn sm" style="width:100%;margin-bottom:8px" onclick="DPLA.estimator('${orderId}','admin')">Open price estimator →</button>
      <div style="display:flex;flex-direction:column;gap:8px;margin:14px 0">
        <div class="section-title">Message</div>
        <button class="btn" onclick="DPLA.adminMsg('${orderId}','client')">Message the client</button>
        <button class="btn" onclick="DPLA.adminMsg('${orderId}','designer')">Message the designer</button>
        <button class="btn gold" onclick="DPLA.chat('${orderId}')">Open full chat log</button>
      </div>
      <div class="section-title" style="margin-bottom:10px">Client feedback</div>
      <div style="display:flex;flex-direction:column;gap:8px">${revs.length ? revs.map(r => `<div style="font-size:12px;padding:10px;background:var(--cream);border-radius:3px">${esc(r.structured || r.note)} <span style="color:var(--faint)">· ${r.status}</span></div>`).join('') : '<div style="font-size:12px;color:var(--faint)">None.</div>'}</div>`;
  });
}
async function assign(orderId, designerId) {
  const o = await DB.updateOrder(orderId, { designer_id: designerId || null, status: designerId ? 'progress' : 'new' });
  if (designerId) { await DB.notify({ userId: designerId }, `You've been assigned ${o.code}: ${o.title}`); const d = await DB.profile(designerId); toast('Assigned', (d?.name || '') + ' notified.', 'success'); }
}
async function setPrice(orderId) {
  const v = parseFloat($('adminPrice').value); if (isNaN(v)) { toast('Invalid', 'Enter a number', 'error'); return; }
  const o = await DB.updateOrder(orderId, { price: v });
  if (o.client_id) await DB.notify({ userId: o.client_id }, `Price set for ${o.code}: ${money(v)}`);
  toast('Price set', money(v), 'success'); adminOpen(orderId);
}
async function adminMsg(orderId, who) {
  const text = prompt(`Message to the ${who}:`); if (!text) return;
  const order = await DB.order(orderId);
  await DB.addMessage({ order_id: orderId, role: 'admin', sender: 'Admin', text });
  const target = who === 'client' ? order.client_id : order.designer_id;
  if (target) await DB.notify({ userId: target }, `Admin: ${text}`);
  toast('Message sent', `Delivered to the ${who}.`, 'success');
}

// ---------- APPROVALS ----------
async function renderApprovals(C) {
  const pending = await DB.pendingUsers();
  if (!pending.length) { C.innerHTML = empty('No pending approvals', 'New client and designer sign-ups will appear here for you to approve with a tick.'); return; }
  const rows = pending.map(u => `<tr>
    <td style="font-weight:600;color:var(--ink)">${esc(u.name)}</td>
    <td style="color:var(--muted)">${esc(u.email)}</td>
    <td>${badge('pending')} ${baseRole(u.role)}</td>
    <td style="color:var(--muted);font-size:12px">${ago(u.created_at)}</td>
    <td style="text-align:right;display:flex;gap:8px;justify-content:flex-end">
      <button class="tick-btn" title="Approve" onclick="DPLA.approveUser('${u.id}','${baseRole(u.role)}','${esc(u.name)}')">✓</button>
      <button class="btn sm danger" onclick="DPLA.rejectUser('${u.id}','${esc(u.name)}')">Reject</button>
    </td></tr>`).join('');
  C.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><table><thead><tr><th>Name</th><th>Email</th><th>Requested Role</th><th>When</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function approveUserAction(id, role, name) {
  await DB.approveUser(id, role);
  await DB.notify({ userId: id }, `Your account has been approved. Welcome to Diamond Plug LA!`);
  toast('Approved', `${name} can now access their ${role} account.`, 'success');
  buildNav(); renderApprovals($('content'));
}
async function rejectUserAction(id, name) {
  if (!confirm(`Reject and remove ${name}?`)) return;
  await DB.rejectUser(id);
  toast('Rejected', `${name} removed.`); buildNav(); renderApprovals($('content'));
}

async function renderUsers(C) {
  const clients = await DB.approvedByRole('client');
  const designers = await DB.approvedByRole('designer');
  const block = (title, arr) => `<div class="card" style="padding:0;overflow:hidden;margin-bottom:18px"><div style="padding:16px 22px;border-bottom:1px solid var(--border)"><div class="section-title">${title} (${arr.length})</div></div>${arr.length ? `<table><thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead><tbody>${arr.map(u => `<tr><td style="font-weight:600;color:var(--ink)">${esc(u.name)}</td><td style="color:var(--muted)">${esc(u.email)}</td><td style="color:var(--muted);font-size:12px">${ago(u.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div style="padding:30px;text-align:center;color:var(--faint);font-size:13px">None yet.</div>'}</div>`;
  C.innerHTML = block('Clients', clients) + block('Designers', designers);
}

// ---------- PRICING (admin edits the math model) ----------
let PRICECFG = null;
async function renderPricing(C) {
  PRICECFG = (await DB.getPricing()) || { ...PRICE_DEFAULTS };
  // ensure shape
  PRICECFG = { ...PRICE_DEFAULTS, ...PRICECFG };
  const ex = estimatePrice(PRICECFG, { karat: '14k', weight: 1, stone: 'None' });
  C.innerHTML = `<div class="grid grid-2">
    <div class="card"><div class="section-title" style="margin-bottom:16px">Gold &amp; labor inputs</div>
      ${numRow('Gold spot ($/oz)', 'goldSpotPerOz', PRICECFG.goldSpotPerOz)}
      ${numRow('Setting/labor charged to client ($/g)', 'settingPerGram', PRICECFG.settingPerGram)}
      ${numRow('Our internal labor cost ($/g)', 'costPerGram', PRICECFG.costPerGram)}
      <button class="btn gold" style="margin-top:12px" onclick="DPLA.savePricing()">Save pricing</button>
    </div>
    <div class="card"><div class="section-title" style="margin-bottom:16px">Live example · 14k, 1 gram</div>
      <div class="price-row"><span>Pure gold $/g</span><span>${money(ex.purePerG)}</span></div>
      <div class="price-row"><span>14k gold $/g (×0.585)</span><span>${money(ex.goldPerG)}</span></div>
      <div class="price-row"><span>+ Setting/labor</span><span>${money(PRICECFG.settingPerGram)}</span></div>
      <div class="price-total"><span>Client price / gram</span><span class="v">${money(ex.clientPerG)}</span></div>
      <div class="price-row" style="margin-top:14px;color:var(--muted)"><span>Our cost / gram</span><span>${money(ex.ourPerG)}</span></div>
      <div class="price-row" style="color:var(--green)"><span>Margin / gram</span><span>${money(ex.clientPerG - ex.ourPerG)}</span></div>
    </div>
    <div class="card" style="grid-column:1/-1"><div class="section-title" style="margin-bottom:10px">The model</div>
      <div style="font-size:13px;line-height:1.9;color:var(--ink2)">
        <div>Pure gold $/g = spot $/oz ÷ 31.1</div>
        <div>Karat gold $/g = pure × purity &nbsp;(14k = 0.585, 18k = 0.750, 24k = 1.0)</div>
        <div><b>Client price/g</b> = karat gold $/g + setting/labor ($/g)</div>
        <div style="color:var(--muted)">Our cost/g = karat gold $/g + internal labor ($/g)</div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><b style="color:var(--gold)">Total</b> = price/g × weight(g) + stones</div>
      </div></div>
  </div>`;
}
function numRow(label, key, val) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px"><span style="font-size:13px;color:var(--ink2)">${label}</span><input id="pc_${key}" type="number" value="${val}" style="width:120px;background:var(--surface);border:1px solid var(--border2);border-radius:2px;padding:8px 10px;color:var(--ink);text-align:right"></div>`;
}
async function savePricing() {
  PRICECFG.goldSpotPerOz = parseFloat($('pc_goldSpotPerOz').value) || PRICE_DEFAULTS.goldSpotPerOz;
  PRICECFG.settingPerGram = parseFloat($('pc_settingPerGram').value) || 0;
  PRICECFG.costPerGram = parseFloat($('pc_costPerGram').value) || 0;
  await DB.savePricing(PRICECFG);
  toast('Pricing saved', 'Model updated.', 'success'); renderPricing($('content'));
}

// ---------- PRICE ESTIMATOR (client & admin) ----------
let lastEstimate = null;
async function estimator(orderId, who) {
  const cfg = { ...PRICE_DEFAULTS, ...((await DB.getPricing()) || {}) };
  const karats = Object.keys(cfg.purity);
  const stones = Object.keys(cfg.stonePerCarat);
  openModal(`<div class="modal-head"><div class="modal-title">Price Estimator</div><button class="modal-close" onclick="DPLA.closeModal()">×</button></div>
    <div class="modal-body"><div class="grid grid-2">
      <div class="field"><label>Gold karat</label><select id="esKarat" onchange="DPLA.recalc('${who}')">${karats.map(k => `<option value="${k}">${k}</option>`).join('')}</select></div>
      <div class="field"><label>Gold weight (grams)</label><input id="esWeight" type="number" value="5" step="0.1" oninput="DPLA.recalc('${who}')"></div>
      <div class="field"><label>Stone</label><select id="esStone" onchange="DPLA.recalc('${who}')">${stones.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
      <div class="field"><label>Carat (each)</label><input id="esCarat" type="number" value="0" step="0.1" oninput="DPLA.recalc('${who}')"></div>
      <div class="field"><label>Stone count</label><input id="esCount" type="number" value="1" oninput="DPLA.recalc('${who}')"></div>
    </div><div id="esOut" style="margin-top:14px"></div>
    ${who === 'admin' ? `<button class="btn gold" style="margin-top:16px" onclick="DPLA.applyEstimate('${orderId}')">Apply as order price</button>` : `<button class="btn gold" style="margin-top:16px" onclick="DPLA.sendEstimateFeedback('${orderId}')">Send this spec as feedback</button>`}
    </div>`, false);
  window.__esCfg = cfg; recalc(who);
}
function recalc(who) {
  const cfg = window.__esCfg;
  const inp = { karat: $('esKarat').value, weight: $('esWeight').value, stone: $('esStone').value, carat: $('esCarat').value, stoneCount: $('esCount').value };
  const e = estimatePrice(cfg, inp); lastEstimate = { e, inp };
  let html = `<div class="card" style="background:var(--cream)">
    <div class="price-row"><span>Gold (${inp.karat}, ${inp.weight}g)</span><span>${money(e.goldCost)}</span></div>
    <div class="price-row"><span>Setting / labor</span><span>${money(e.settingCost)}</span></div>
    ${e.stoneCost ? `<div class="price-row"><span>Stones</span><span>${money(e.stoneCost)}</span></div>` : ''}
    <div class="price-total"><span>Estimated price</span><span class="v">${money(e.total)}</span></div>`;
  if (who === 'admin') html += `<div class="price-row" style="margin-top:12px;color:var(--muted)"><span>Our cost</span><span>${money(e.ourCost)}</span></div><div class="price-row" style="color:var(--green)"><span>Margin</span><span>${money(e.margin)}</span></div>`;
  html += `</div>`;
  $('esOut').innerHTML = html;
}
async function applyEstimate(orderId) {
  if (!lastEstimate) return;
  const o = await DB.updateOrder(orderId, { price: lastEstimate.e.total });
  if (o.client_id) await DB.notify({ userId: o.client_id }, `Price estimate for ${o.code}: ${money(lastEstimate.e.total)}`);
  toast('Price applied', money(lastEstimate.e.total), 'success'); adminOpen(orderId);
}
async function sendEstimateFeedback(orderId) {
  if (!lastEstimate) return;
  const { inp, e } = lastEstimate;
  const note = `Requested spec: ${inp.karat} gold, ${inp.weight}g${inp.stone !== 'None' ? `, ${inp.stone} ${inp.carat}ct ×${inp.stoneCount}` : ''} — est. ${money(e.total)}`;
  await DB.addRevision({ order_id: orderId, note, structured: note, requested_by: ME.id, from_version: 0 });
  const o = await DB.order(orderId);
  if (o.designer_id) await DB.notify({ userId: o.designer_id }, `New spec request on ${o.code}: ${note}`);
  await DB.notify({ role: 'admin' }, `Client sent a spec on ${o.code}.`);
  toast('Sent', 'Your spec was sent as feedback.', 'success'); closeModal();
}

// ---------- NOTIFICATIONS ----------
async function renderNotifs(C) {
  const ns = await DB.myNotifs(ME);
  await DB.markRead(ME); buildNav();
  if (!ns.length) { C.innerHTML = empty('No updates', 'Updates on your pieces appear here.'); return; }
  C.innerHTML = `<div class="card" style="padding:0">${ns.map(n => `<div style="padding:16px 22px;border-bottom:1px solid var(--border);display:flex;gap:14px;align-items:flex-start"><div style="width:8px;height:8px;border-radius:50%;background:${n.read ? 'var(--faint)' : 'var(--gold)'};margin-top:5px;flex-shrink:0"></div><div><div style="font-size:13px;color:var(--ink2)">${esc(n.text)}</div><div style="font-size:11px;color:var(--faint);margin-top:3px">${ago(n.created_at)}</div></div></div>`).join('')}</div>`;
}

// ---------- VIEWER MODAL ----------
async function openViewerModal(orderId, sidebarFn) {
  const order = await DB.order(orderId);
  const design = await DB.latestDesign(orderId);
  const versions = await DB.designsForOrder(orderId);
  const renderable = design && ['STL', 'OBJ', '3DM'].includes(design.format);
  const sidebar = await sidebarFn(order, design);
  openModal(`<div class="modal-head"><div class="modal-title">${esc(order.title)} · <span style="color:var(--muted);font-size:16px">${order.code}</span></div><button class="modal-close" onclick="DPLA.closeModal()">×</button></div>
    <div class="modal-body" style="padding:0"><div style="display:grid;grid-template-columns:1fr 320px;min-height:520px">
      <div style="position:relative;background:linear-gradient(160deg,#f3ede3,#e9e0d2)">
        <div id="vHost" style="position:absolute;inset:0">${renderable ? '' : `<div class="empty" style="height:100%;display:flex;flex-direction:column;justify-content:center"><div class="empty-title">${design ? 'File delivered' : 'No design yet'}</div><div class="empty-desc">${design ? esc(design.file_name) + ' — download from your files. (Only STL/3DM render in 3D.)' : 'Your designer will upload the 3D design here.'}</div></div>`}</div>
        ${renderable ? `<div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          <button class="btn sm" onclick="DPLA.viewer.reset()">Reset</button>
          <button class="btn sm" onclick="DPLA.viewer.zoom(0.85)">Zoom +</button>
          <button class="btn sm" onclick="DPLA.viewer.zoom(1.15)">Zoom −</button>
          <button class="btn sm" onclick="DPLA.viewer.setMaterial('gold')">Gold</button>
          <button class="btn sm" onclick="DPLA.viewer.setMaterial('wgold')">White</button>
          <button class="btn sm" onclick="DPLA.viewer.setMaterial('rose')">Rose</button>
        </div>` : ''}
      </div>
      <div style="border-left:1px solid var(--border);padding:22px;overflow-y:auto;max-height:520px">
        ${design ? `<div class="section-title" style="margin-bottom:12px">Design detail</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
            <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">File</span><span>${esc(design.file_name)}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">Format</span><span>${design.format}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">Version</span><span>v${design.version} of ${versions.length}</span></div>
            ${renderable ? `<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">Triangles</span><span id="vTris">—</span></div><div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">Dimensions</span><span id="vDims">—</span></div>` : ''}
          </div>` : ''}
        <div class="section-title" style="margin-bottom:8px">Estimated price</div>
        <div style="font-family:var(--serif);font-size:32px;color:var(--gold);margin-bottom:20px;font-weight:600">${order.price != null ? money(order.price) : 'Pending'}</div>
        ${sidebar}
      </div></div></div>`, true);

  if (renderable) {
    const host = $('vHost');
    activeViewer = createViewer(host); window.DPLA.viewer = activeViewer;
    try {
      const buf = await DB.downloadFile(design.storage_path);
      const parsed = await parseByExt(design.format.toLowerCase(), buf);
      const info = activeViewer.setGeometry(parsed);
      if ($('vTris')) $('vTris').textContent = info.tris.toLocaleString();
      if ($('vDims')) $('vDims').textContent = info.dims + ' mm';
    } catch (err) { host.innerHTML = `<div class="empty" style="height:100%;display:flex;flex-direction:column;justify-content:center"><div class="empty-title">Couldn't render</div><div class="empty-desc">${esc(err.message)}</div></div>`; }
  }
}

// ---------- CHATBOT ----------
let chatOrder = null;
async function openChat(orderId, isOnboarding) {
  chatOrder = orderId;
  const order = await DB.order(orderId);
  const prior = await DB.messagesForOrder(orderId);
  openModal(`<div class="modal-head"><div class="modal-title">${IS_ADMIN ? 'Chat Log' : 'Design Assistant'} · ${order.code}</div><button class="modal-close" onclick="DPLA.closeChat()">×</button></div>
    <div class="modal-body" style="padding:0;display:flex;flex-direction:column;height:560px">
      <div id="chatLog" style="flex:1;overflow-y:auto;padding:22px;display:flex;flex-direction:column;gap:14px"></div>
      <div id="chatChips" style="display:flex;flex-wrap:wrap;gap:6px;padding:0 22px 12px"></div>
      <div style="display:flex;gap:8px;padding:16px 22px;border-top:1px solid var(--border)">
        <input id="chatField" placeholder="${ME.role === 'client' ? 'Describe your piece or a change…' : 'Type a message…'}" onkeydown="if(event.key==='Enter')DPLA.chatSend()" style="flex:1;background:var(--surface);border:1px solid var(--border2);border-radius:2px;padding:12px 14px;color:var(--ink);outline:none">
        <button class="btn gold" onclick="DPLA.chatSend()">Send</button>
      </div></div>`, true);
  for (const m of prior) chatBubble(m.role === 'chatbot' ? 'bot' : (m.sender === ME.name ? 'user' : 'other'), esc(m.text), m.sender);
  if (!prior.length) {
    chatBubble('bot', isOnboarding
      ? `Welcome! Tell me the piece you'd like — metal, stone, style, size. Your request goes to our team and a designer will create your 3D design.`
      : `Hi! Tell me any change you'd like to <b>${esc(order.title)}</b> and I'll pass precise notes to your designer.`);
  }
  if (ME.role === 'client') chips(['A round solitaire engagement ring', 'Make the band thinner', 'Use 14k yellow gold', 'When will it be ready?']);
  setTimeout(() => $('chatField')?.focus(), 100);
}
function closeChat() { closeModal(); if (chatOrder) navTo(defaultView()); }
function chips(list) { const c = $('chatChips'); if (c) c.innerHTML = list.map(s => `<button class="btn sm" onclick="document.getElementById('chatField').value=this.textContent;DPLA.chatSend()">${s}</button>`).join(''); }
function chatBubble(who, html, sender) {
  const log = $('chatLog'); if (!log) return;
  const d = document.createElement('div'); d.style.maxWidth = '85%';
  if (who === 'user') { d.style.alignSelf = 'flex-end'; d.innerHTML = `<div style="background:var(--gold-soft);border:1px solid var(--gold-line);padding:10px 14px;border-radius:10px 10px 2px 10px;font-size:13px;color:var(--ink)">${html}</div>`; }
  else if (who === 'other') { d.style.alignSelf = 'flex-start'; d.innerHTML = `<div style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin-bottom:5px">${esc(sender || '')}</div><div style="background:var(--surface2);border:1px solid var(--border);padding:11px 14px;border-radius:10px 10px 10px 2px;font-size:13px;color:var(--ink2)">${html}</div>`; }
  else { d.style.alignSelf = 'flex-start'; d.innerHTML = `<div style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:5px">Assistant</div><div style="background:var(--surface2);border:1px solid var(--border);padding:11px 14px;border-radius:10px 10px 10px 2px;font-size:13px;line-height:1.6;color:var(--ink2)">${html}</div>`; }
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function typing(on) { const log = $('chatLog'); if (!log) return; if (on) { const d = document.createElement('div'); d.id = 'typing'; d.style.alignSelf = 'flex-start'; d.innerHTML = `<div style="background:var(--surface2);border:1px solid var(--border);padding:12px 16px;border-radius:10px;display:flex;gap:4px"><span style="width:5px;height:5px;border-radius:50%;background:var(--muted);animation:bounce 1.2s infinite"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--muted);animation:bounce 1.2s infinite .2s"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--muted);animation:bounce 1.2s infinite .4s"></span></div>`; log.appendChild(d); log.scrollTop = log.scrollHeight; } else $('typing')?.remove(); }

async function chatSend() {
  const field = $('chatField'); const text = field.value.trim(); if (!text) return;
  field.value = ''; chatBubble('user', esc(text));
  await DB.addMessage({ order_id: chatOrder, role: ME.role + '_chat', sender: ME.name, text });

  // Admin / designer: plain message, notify the other parties, no AI revision parsing
  if (ME.role !== 'client') {
    const o = await DB.order(chatOrder);
    if (o.client_id) await DB.notify({ userId: o.client_id }, `Message on ${o.code}: ${text}`);
    if (o.designer_id && ME.role === 'admin') await DB.notify({ userId: o.designer_id }, `Admin on ${o.code}: ${text}`);
    return;
  }

  // Client: AI assistant + revision extraction
  typing(true);
  const order = await DB.order(chatOrder);
  const design = await DB.latestDesign(chatOrder);
  const ctx = `${order.code} · ${order.title} · status ${order.status} · price ${order.price != null ? money(order.price) : 'not set'} · design ${design ? 'v' + design.version : 'none yet'}`;
  const reply = await askAssistant(text, ctx);
  typing(false);
  const m = reply.match(/REVISION:\s*(.+)/i);
  const display = reply.replace(/REVISION:\s*.+/i, '').trim() || reply;
  chatBubble('bot', esc(display).replace(/\n/g, '<br>'));
  await DB.addMessage({ order_id: chatOrder, role: 'chatbot', sender: 'Assistant', text: display });
  if (m) {
    const structured = m[1].trim();
    await DB.addRevision({ order_id: chatOrder, note: text, structured, requested_by: ME.id, from_version: design ? design.version : 0 });
    const o = await DB.updateOrder(chatOrder, { status: 'progress' });
    if (o.designer_id) await DB.notify({ userId: o.designer_id }, `New feedback on ${o.code}: ${structured}`);
    await DB.notify({ role: 'admin' }, `Client feedback on ${o.code}.`);
    chatBubble('bot', `✓ <b>Sent to your designer:</b><br><span style="color:var(--gold)">${esc(structured)}</span>`);
    toast('Feedback sent', 'Designer notified', 'success');
  }
  if (order.title === 'Custom piece' && text.length > 8) await DB.updateOrder(chatOrder, { title: text.slice(0, 60) });
}

// ---------- shared UI ----------
function openModal(html, large) { const box = $('modalBox'); box.className = 'modal' + (large ? ' lg' : ''); box.innerHTML = html; $('modalOverlay').classList.add('active'); }
function closeModal() { $('modalOverlay').classList.remove('active'); $('modalBox').innerHTML = ''; if (activeViewer) { activeViewer.dispose(); activeViewer = null; } }
$('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
function toast(title, msg, type) { const w = $('toastWrap'); const t = document.createElement('div'); t.className = 'toast ' + (type || ''); t.innerHTML = `<div class="toast-title">${title}</div><div class="toast-msg">${msg || ''}</div>`; w.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200); }
function empty(title, desc, btn, action) { return `<div class="empty"><div class="empty-title">${title}</div><div class="empty-desc">${desc}</div>${btn ? `<button class="btn gold" style="margin-top:22px" onclick="${action}">${btn}</button>` : ''}</div>`; }
function badge(s) { return `<span class="badge ${s}">${statusLabel(s)}</span>`; }
function statusLabel(s) { return { new: 'New', progress: 'In Progress', review: 'Design Ready', done: 'Done', approved: 'Approved', production: 'In Production', pending: 'Pending' }[s] || s; }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function ago(iso) { const s = Math.floor((Date.now() - new Date(iso)) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }

window.DPLA = {
  clientOpen, approve, designerOpen, resolveRev, upload, adminOpen, assign, setPrice, adminMsg,
  approveUser: approveUserAction, rejectUser: rejectUserAction,
  estimator, recalc, applyEstimate, sendEstimateFeedback, savePricing,
  chat: openChat, closeChat, chatSend, closeModal, go: navTo, viewer: null
};

// ---------- init ----------
paintLanding();
if (window.__pendingAuthMode) setAuthMode(window.__pendingAuthMode);
supabase.auth.onAuthStateChange((_e, session) => { if (session && !ME && !IS_ADMIN) boot(); });
boot();
