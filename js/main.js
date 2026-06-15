// ===== Diamond Plug LA — main app =====
import { supabase } from './config.js';
import { DB, estimatePrice, money } from './db.js';
import { createViewer, parseByExt } from './viewer.js';
import { askAssistant, diamondArt, ringArt } from './chatbot.js';

let ME = null;            // current profile
let PRICING = null;       // pricing config
let activeViewer = null;

const $ = id => document.getElementById(id);
const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// expose handlers used by inline onclick in index.html
Object.assign(window, {
  scrollToId, openAuth, closeAuth, toggleAuthMode, submitAuth,
  startCustom, signOut, go: navTo
});

// ---------- landing decorative art ----------
function paintLanding() {
  $('art1').innerHTML = diamondArt('gold');
  $('art2').innerHTML = ringArt();
  $('art3').innerHTML = diamondArt('blue');
  $('art4').innerHTML = diamondArt('gold');
  $('craftArt').innerHTML = ringArt();
}
function scrollToId(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }

// ---------- AUTH ----------
let authMode = 'signup';
function openAuth(mode) { authMode = mode; renderAuthMode(); $('authOverlay').classList.add('active'); $('authError').textContent = ''; }
function closeAuth() { $('authOverlay').classList.remove('active'); }
function toggleAuthMode() { authMode = authMode === 'signup' ? 'login' : 'signup'; renderAuthMode(); }
function renderAuthMode() {
  const signup = authMode === 'signup';
  $('authTitle').textContent = signup ? 'Create your account' : 'Welcome back';
  $('authDesc').textContent = signup ? 'Start your custom piece in minutes.' : 'Sign in to your design portal.';
  $('authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  $('authNameField').style.display = signup ? '' : 'none';
  $('authRoleField').style.display = signup ? '' : 'none';
  $('authSwitchText').textContent = signup ? 'Already have an account?' : "Don't have an account?";
  $('authSwitchLink').textContent = signup ? 'Sign in' : 'Create one';
}

async function submitAuth() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const errEl = $('authError'); errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Enter your email and password.'; return; }

  $('authSubmit').textContent = 'Please wait…';
  try {
    if (authMode === 'signup') {
      const name = $('authName').value.trim();
      const role = $('authRole').value;
      if (!name) { errEl.textContent = 'Enter your name.'; $('authSubmit').textContent = 'Create account'; return; }
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, role } } });
      if (error) throw error;
      // Some projects require email confirmation; try immediate sign-in.
      const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (e2) { errEl.style.color = 'var(--green)'; errEl.textContent = 'Account created! Check your email to confirm, then sign in.'; $('authSubmit').textContent = 'Create account'; authMode = 'login'; renderAuthMode(); return; }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    await boot();
    closeAuth();
  } catch (e) {
    errEl.style.color = 'var(--red)';
    errEl.textContent = e.message || 'Something went wrong.';
    $('authSubmit').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
  }
}

async function signOut() { await supabase.auth.signOut(); ME = null; location.reload(); }

// ---------- BOOT ----------
async function boot() {
  ME = await DB.myProfile();
  if (!ME) return; // not logged in → stay on landing
  PRICING = await DB.getPricing();
  $('landing').style.display = 'none';
  $('app').classList.add('active');
  $('sideUser').textContent = `${ME.name || ME.email} · ${cap(ME.role)}`;
  // designers/admins don't "start custom" — hide for them? keep for all, it just makes an order
  $('customBtn').style.display = ME.role === 'client' ? '' : 'none';
  buildNav();
  navTo(defaultView());
}

function defaultView() {
  return { client: 'orders', designer: 'queue', admin: 'dash' }[ME.role];
}

// ---------- NAV ----------
const NAV = {
  client: [['orders', 'My Orders', 'box'], ['notifs', 'Notifications', 'bell']],
  designer: [['queue', 'Assigned', 'layers'], ['notifs', 'Notifications', 'bell']],
  admin: [['dash', 'Dashboard', 'grid'], ['orders', 'All Orders', 'box'], ['people', 'Users', 'users'], ['pricing', 'Pricing', 'tag'], ['notifs', 'Activity', 'bell']]
};
const ICON = {
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'
};
const svgIcon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ''}</svg>`;

async function buildNav() {
  const menu = $('navMenu'); menu.innerHTML = '';
  const unread = await DB.unread(ME);
  for (const [id, label, ic] of NAV[ME.role]) {
    const b = document.createElement('button');
    b.className = 'nav-item'; b.dataset.view = id;
    b.innerHTML = svgIcon(ic) + `<span>${label}</span>` + (id === 'notifs' && unread ? `<span class="nav-badge">${unread}</span>` : '');
    b.onclick = () => navTo(id);
    menu.appendChild(b);
  }
}

async function navTo(view) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  const titles = { orders: ME.role === 'admin' ? 'All Orders' : 'My Orders', queue: 'Assigned Orders', dash: 'Dashboard', people: 'Users', pricing: 'Pricing Formula', notifs: ME.role === 'admin' ? 'Activity' : 'Notifications' };
  $('pageTitle').textContent = titles[view] || 'Dashboard';
  $('topActions').innerHTML = '';
  const C = $('content'); C.innerHTML = '<div style="padding:40px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    if (ME.role === 'client' && view === 'orders') return renderClientOrders(C);
    if (ME.role === 'designer' && view === 'queue') return renderDesignerQueue(C);
    if (ME.role === 'admin' && view === 'dash') return renderAdminDash(C);
    if (ME.role === 'admin' && view === 'orders') return renderAdminOrders(C);
    if (ME.role === 'admin' && view === 'people') return renderUsers(C);
    if (ME.role === 'admin' && view === 'pricing') return renderPricing(C);
    if (view === 'notifs') return renderNotifs(C);
  } catch (e) { C.innerHTML = `<div class="empty"><div class="empty-title">Couldn't load</div><div class="empty-desc">${esc(e.message)}</div></div>`; }
}

// ---------- CLIENT ----------
async function renderClientOrders(C) {
  $('topActions').innerHTML = `<button class="btn gold" onclick="startCustom()">✦ Custom Design</button>`;
  const orders = await DB.ordersForClient(ME.id);
  if (!orders.length) {
    C.innerHTML = empty('No orders yet', 'Click <b>Custom Design</b> to chat with our assistant and start your first piece.', 'Start Custom Design', 'startCustom()');
    return;
  }
  const rows = await Promise.all(orders.map(async o => {
    const d = await DB.latestDesign(o.id);
    return `<tr class="clickable" onclick="DPLA.clientOpen('${o.id}')">
      <td><div style="font-weight:500">${esc(o.title)}</div><div style="font-size:11px;color:var(--faint)">${o.code}</div></td>
      <td>${d ? `<span style="color:var(--diamond)">v${d.version} · ${d.format}</span>` : '<span style="color:var(--faint)">in design</span>'}</td>
      <td>${badge(o.status)}</td>
      <td>${o.price != null ? `<span style="color:var(--gold)">${money(o.price)}</span>` : '<span style="color:var(--faint)">—</span>'}</td>
      <td style="text-align:right;color:var(--gold);font-size:12px">Open →</td></tr>`;
  }));
  C.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><table><thead><tr><th>Order</th><th>Design</th><th>Status</th><th>Price</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function clientOpen(orderId) {
  await openViewerModal(orderId, async (order, design) => {
    const revs = await DB.revisionsForOrder(orderId);
    const canApprove = design && !['approved', 'production'].includes(order.status);
    return `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
        <button class="btn gold" onclick="DPLA.chat('${orderId}')">Request a change (chat)</button>
        ${canApprove ? `<button class="btn" onclick="DPLA.approve('${orderId}')">Approve final design</button>` : ''}
        ${order.status === 'approved' ? '<div class="badge approved" style="justify-content:center">Approved for production</div>' : ''}
      </div>
      <div class="section-title" style="margin-bottom:10px">Revision history</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${revs.length ? revs.map(r => `<div style="font-size:12px;padding:10px;background:var(--surface2);border-radius:8px"><div style="color:var(--muted);margin-bottom:3px">${ago(r.created_at)} · ${r.status}</div>${esc(r.note)}</div>`).join('') : '<div style="font-size:12px;color:var(--faint)">No revisions yet.</div>'}
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

// ---------- CUSTOM FLOW (the ✦ button) ----------
async function startCustom() {
  // Create a draft order, then open the chatbot which collects the brief + STL.
  const order = await DB.createOrder(ME.id, 'Custom piece', '');
  await DB.notify({ role: 'admin' }, `New custom request from ${ME.name || ME.email} (${order.code}).`);
  openChat(order.id, true);
}

// ---------- DESIGNER ----------
async function renderDesignerQueue(C) {
  const orders = await DB.ordersForDesigner(ME.id);
  if (!orders.length) { C.innerHTML = empty('No orders assigned', 'When an admin assigns you an order, it shows here. You can upload STL/OBJ/3DM files and read revision notes.'); return; }
  const rows = await Promise.all(orders.map(async o => {
    const d = await DB.latestDesign(o.id);
    const client = o.client_id ? await DB.profile(o.client_id) : null;
    const revs = await DB.revisionsForOrder(o.id);
    const open = revs.filter(r => r.status === 'open').length;
    return `<tr class="clickable" onclick="DPLA.designerOpen('${o.id}')">
      <td><div style="font-weight:500">${esc(o.title)}</div><div style="font-size:11px;color:var(--faint)">${o.code}</div></td>
      <td>${client ? esc(client.name || client.email) : '—'}</td>
      <td>${d ? `v${d.version} · ${d.format}` : '<span style="color:var(--faint)">none</span>'}</td>
      <td>${open ? `<span style="color:var(--amber)">${open} pending</span>` : '<span style="color:var(--faint)">0</span>'}</td>
      <td>${badge(o.status)}</td>
      <td style="text-align:right;color:var(--gold);font-size:12px">Open →</td></tr>`;
  }));
  C.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><table><thead><tr><th>Order</th><th>Client</th><th>Latest</th><th>Revisions</th><th>Status</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function designerOpen(orderId) {
  await openViewerModal(orderId, async (order) => {
    const revs = await DB.revisionsForOrder(orderId);
    return `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
        <button class="btn gold" onclick="DPLA.upload('${orderId}')">Upload STL / OBJ / 3DM</button>
        <select class="btn" style="text-align:left" onchange="DPLA.setStatus('${orderId}',this.value)">
          ${['new', 'progress', 'review', 'done'].map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
        </select>
      </div>
      <div class="section-title" style="margin-bottom:10px">Revision notes</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${revs.length ? revs.map(r => `<div style="font-size:12px;padding:10px;background:var(--surface2);border-radius:8px;border-left:2px solid ${r.status === 'open' ? 'var(--amber)' : 'var(--green)'}"><div style="color:var(--muted);margin-bottom:5px">${ago(r.created_at)} · ${r.status}</div><div style="margin-bottom:6px">${esc(r.structured || r.note)}</div>${r.status === 'open' ? `<button class="btn sm" onclick="DPLA.resolveRev('${r.id}','${orderId}')">Mark addressed</button>` : ''}</div>`).join('') : '<div style="font-size:12px;color:var(--faint)">No revision notes.</div>'}
      </div>`;
  });
}

async function setStatus(orderId, status) {
  const o = await DB.updateOrder(orderId, { status });
  if (o.client_id) await DB.notify({ userId: o.client_id }, `${o.code} status: ${statusLabel(status)}`);
  toast('Status updated', statusLabel(status));
}
async function resolveRev(revId, orderId) { await DB.resolveRevision(revId); toast('Marked addressed', 'Upload the new version to notify the buyer.', 'success'); designerOpen(orderId); }

async function upload(orderId) {
  const input = $('fileInput'); input.value = '';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['stl', 'obj', '3dm'].includes(ext)) { toast('Wrong format', 'Use STL, OBJ, or 3DM', 'error'); return; }
    toast('Uploading', file.name + '…');
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseByExt(ext, buf.slice(0));
      const existing = await DB.designsForOrder(orderId);
      const version = existing.length + 1;
      const path = await DB.uploadFile(orderId, version, file);
      const design = await DB.addDesign(orderId, { file_name: file.name, format: ext.toUpperCase(), storage_path: path, triangle_count: parsed.triangleCount, dimensions: '' });
      const o = await DB.updateOrder(orderId, { status: 'review' });
      if (o.client_id) await DB.notify({ userId: o.client_id }, `New design ready for ${o.code} — v${design.version}.`);
      await DB.notify({ role: 'admin' }, `Design v${design.version} uploaded for ${o.code}.`);
      toast('Uploaded', 'Buyer notified. Now visible in 3D.', 'success');
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
  const clients = (await DB.profilesByRole('client')).length;
  const designers = (await DB.profilesByRole('designer')).length;
  C.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:24px">
      <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value">${inProg}</div></div>
      <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value">${done}</div></div>
      <div class="stat-card"><div class="stat-label">Pipeline</div><div class="stat-value gold">${revenue ? '$' + Math.round(revenue / 1000) + 'k' : '$0'}</div></div>
      <div class="stat-card"><div class="stat-label">Users</div><div class="stat-value">${clients + designers}</div><div class="stat-meta">${clients} clients · ${designers} designers</div></div>
    </div>
    <div class="section-head"><div class="section-title">Recent Orders</div><button class="btn sm" onclick="DPLA.go('orders')">View all</button></div>
    ${orders.length ? await orderTable(orders.slice(0, 6)) : empty('No orders yet', 'Client requests appear here for assignment and pricing.')}`;
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
      <td><div style="font-weight:500">${esc(o.title)}</div><div style="font-size:11px;color:var(--faint)">${o.code}</div></td>
      <td>${c ? esc(c.name || c.email) : '—'}</td>
      <td>${d ? esc(d.name || d.email) : '<span style="color:var(--amber)">unassigned</span>'}</td>
      <td>${badge(o.status)}</td>
      <td>${o.price != null ? `<span style="color:var(--gold)">${money(o.price)}</span>` : '—'}</td>
      <td style="text-align:right;color:var(--gold);font-size:12px">Manage →</td></tr>`;
  }));
  return `<div class="card" style="padding:0;overflow:hidden"><table><thead><tr><th>Order</th><th>Client</th><th>Designer</th><th>Status</th><th>Price</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function adminOpen(orderId) {
  const designers = await DB.profilesByRole('designer');
  await openViewerModal(orderId, async (order) => {
    const revs = await DB.revisionsForOrder(orderId);
    return `
      <div class="section-title" style="margin-bottom:10px">Assign designer</div>
      <select class="btn" style="width:100%;text-align:left;margin-bottom:14px" onchange="DPLA.assign('${orderId}',this.value)">
        <option value="">— unassigned —</option>
        ${designers.map(d => `<option value="${d.id}" ${order.designer_id === d.id ? 'selected' : ''}>${esc(d.name || d.email)}</option>`).join('')}
      </select>
      <div class="section-title" style="margin-bottom:10px">Price</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input id="adminPrice" type="number" placeholder="0.00" value="${order.price ?? ''}" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);outline:none">
        <button class="btn gold" onclick="DPLA.setPrice('${orderId}')">Set</button>
      </div>
      <button class="btn sm" style="width:100%;margin-bottom:18px" onclick="DPLA.estimator('${orderId}')">Open price estimator →</button>
      <div class="section-title" style="margin-bottom:10px">Revisions</div>
      <div style="display:flex;flex-direction:column;gap:8px">${revs.length ? revs.map(r => `<div style="font-size:12px;padding:10px;background:var(--surface2);border-radius:8px">${esc(r.structured || r.note)} <span style="color:var(--faint)">· ${r.status}</span></div>`).join('') : '<div style="font-size:12px;color:var(--faint)">None.</div>'}</div>`;
  });
}
async function assign(orderId, designerId) {
  const o = await DB.updateOrder(orderId, { designer_id: designerId || null, status: designerId ? 'progress' : 'new' });
  if (designerId) { await DB.notify({ userId: designerId }, `You've been assigned ${o.code}: ${o.title}`); const d = await DB.profile(designerId); toast('Assigned', (d.name || d.email) + ' notified.', 'success'); }
}
async function setPrice(orderId) {
  const v = parseFloat($('adminPrice').value); if (isNaN(v)) { toast('Invalid', 'Enter a number', 'error'); return; }
  const o = await DB.updateOrder(orderId, { price: v });
  if (o.client_id) await DB.notify({ userId: o.client_id }, `Price set for ${o.code}: ${money(v)}`);
  toast('Price set', money(v), 'success'); adminOpen(orderId);
}

// price estimator
let lastEstimate = null;
async function estimator(orderId) {
  const p = PRICING; const opts = o => Object.keys(o).map(k => `<option>${k}</option>`).join('');
  openModal(`<div class="modal-head"><div class="modal-title">Price Estimator</div><button class="modal-close" onclick="DPLA.adminOpen('${orderId}')">×</button></div>
    <div class="modal-body"><div class="grid grid-2">
      <div class="field"><label>Metal</label><select id="peMetal" onchange="DPLA.recalc()">${opts(p.metals)}</select></div>
      <div class="field"><label>Metal weight (g)</label><input id="peWeight" type="number" value="4" oninput="DPLA.recalc()"></div>
      <div class="field"><label>Stone</label><select id="peStone" onchange="DPLA.recalc()">${opts(p.stonePerCarat)}</select></div>
      <div class="field"><label>Carat each</label><input id="peCarat" type="number" value="1" step="0.1" oninput="DPLA.recalc()"></div>
      <div class="field"><label>Stone count</label><input id="peCount" type="number" value="1" oninput="DPLA.recalc()"></div>
      <div class="field"><label>Cut</label><select id="peCut" onchange="DPLA.recalc()">${opts(p.cutMult)}</select></div>
      <div class="field"><label>Clarity</label><select id="peClarity" onchange="DPLA.recalc()">${opts(p.clarityMult)}</select></div>
      <div class="field"><label>Color</label><select id="peColor" onchange="DPLA.recalc()">${opts(p.colorMult)}</select></div>
      <div class="field"><label>Complexity</label><select id="peComplexity" onchange="DPLA.recalc()">${opts(p.complexityMult)}</select></div>
    </div><div id="peOut" style="margin-top:14px"></div>
    <button class="btn gold" style="margin-top:18px" onclick="DPLA.applyEstimate('${orderId}')">Apply as order price</button></div>`, true);
  recalc();
}
function recalc() {
  const g = id => $(id)?.value;
  const e = estimatePrice(PRICING, { metal: g('peMetal'), weight: g('peWeight'), stone: g('peStone'), carat: g('peCarat'), stoneCount: g('peCount'), cut: g('peCut'), clarity: g('peClarity'), color: g('peColor'), complexity: g('peComplexity') });
  lastEstimate = e;
  $('peOut').innerHTML = `<div class="card" style="background:var(--surface2)">${[['Metal', e.metalCost], ['Stone', e.stoneCost], ['Labor', e.labor], ['Subtotal', e.subtotal], ['Markup', e.markup]].map(([l, v]) => `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:var(--muted)">${l}</span><span>${money(v)}</span></div>`).join('')}<div style="display:flex;justify-content:space-between;padding-top:10px;margin-top:6px;border-top:1px solid var(--border)"><span style="font-weight:500">Total</span><span style="color:var(--gold);font-size:18px;font-weight:600">${money(e.total)}</span></div></div>`;
}
async function applyEstimate(orderId) {
  if (!lastEstimate) return;
  const o = await DB.updateOrder(orderId, { price: lastEstimate.total });
  if (o.client_id) await DB.notify({ userId: o.client_id }, `Estimate ready for ${o.code}: ${money(lastEstimate.total)}`);
  toast('Price applied', money(lastEstimate.total), 'success'); adminOpen(orderId);
}

async function renderUsers(C) {
  const clients = await DB.profilesByRole('client');
  const designers = await DB.profilesByRole('designer');
  const block = (title, arr) => `<div class="card" style="padding:0;overflow:hidden;margin-bottom:18px"><div style="padding:16px 22px;border-bottom:1px solid var(--border)"><div class="section-title">${title} (${arr.length})</div></div>${arr.length ? `<table><thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead><tbody>${arr.map(u => `<tr><td style="font-weight:500">${esc(u.name || '—')}</td><td style="color:var(--muted)">${esc(u.email)}</td><td style="color:var(--muted);font-size:12px">${ago(u.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div style="padding:30px;text-align:center;color:var(--faint);font-size:13px">None yet.</div>'}</div>`;
  C.innerHTML = block('Clients', clients) + block('Designers', designers);
}

async function renderPricing(C) {
  const p = PRICING;
  const rowsOf = (group) => Object.entries(p[group]).map(([k, v]) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px"><span style="font-size:13px;color:var(--muted)">${k}</span><input type="number" value="${v}" onchange="DPLA.setPrice2('${group}','${k}',this.value)" style="width:90px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);outline:none;text-align:right"></div>`).join('');
  C.innerHTML = `<div class="grid grid-2">
    <div class="card"><div class="section-title" style="margin-bottom:16px">Metal $/g</div>${rowsOf('metals')}</div>
    <div class="card"><div class="section-title" style="margin-bottom:16px">Stone $/carat</div>${rowsOf('stonePerCarat')}</div>
    <div class="card"><div class="section-title" style="margin-bottom:16px">Labor & markup</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px"><span style="font-size:13px;color:var(--muted)">Base labor $</span><input type="number" value="${p.laborBase}" onchange="DPLA.setLabor(this.value)" style="width:90px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);text-align:right"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:13px;color:var(--muted)">Markup %</span><input type="number" value="${p.markupPct}" onchange="DPLA.setMarkup(this.value)" style="width:90px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);text-align:right"></div></div>
    <div class="card"><div class="section-title" style="margin-bottom:16px">Formula</div><div style="font-size:13px;line-height:1.9;color:var(--muted)"><div><b style="color:var(--text)">Metal</b> = rate × weight</div><div><b style="color:var(--text)">Stone</b> = rate × carat × clarity × color × cut × qty</div><div><b style="color:var(--text)">Labor</b> = base × complexity</div><div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><b style="color:var(--gold)">Total</b> = (metal+stone+labor) × (1+markup%)</div></div></div>
  </div>`;
}
async function setPrice2(group, key, val) { const v = parseFloat(val); if (isNaN(v)) return; PRICING[group][key] = v; await DB.savePricing(PRICING); toast('Pricing updated', `${key} = ${val}`, 'success'); }
async function setLabor(val) { PRICING.laborBase = parseFloat(val) || 0; await DB.savePricing(PRICING); toast('Updated', 'Base labor'); }
async function setMarkup(val) { PRICING.markupPct = parseFloat(val) || 0; await DB.savePricing(PRICING); toast('Updated', 'Markup'); }

// ---------- NOTIFICATIONS ----------
async function renderNotifs(C) {
  const ns = await DB.myNotifs(ME);
  await DB.markRead(ME); buildNav();
  if (!ns.length) { C.innerHTML = empty('No notifications', 'Activity on your orders shows up here.'); return; }
  C.innerHTML = `<div class="card" style="padding:0">${ns.map(n => `<div style="padding:16px 22px;border-bottom:1px solid var(--border);display:flex;gap:14px;align-items:flex-start"><div style="width:8px;height:8px;border-radius:50%;background:${n.read ? 'var(--faint)' : 'var(--gold)'};margin-top:5px;flex-shrink:0"></div><div><div style="font-size:13px">${esc(n.text)}</div><div style="font-size:11px;color:var(--faint);margin-top:3px">${ago(n.created_at)}</div></div></div>`).join('')}</div>`;
}

// ---------- VIEWER MODAL ----------
async function openViewerModal(orderId, sidebarFn) {
  const order = await DB.order(orderId);
  const design = await DB.latestDesign(orderId);
  const versions = await DB.designsForOrder(orderId);
  const sidebar = await sidebarFn(order, design);
  openModal(`<div class="modal-head"><div class="modal-title">${esc(order.title)} · <span style="color:var(--muted);font-size:16px">${order.code}</span></div><button class="modal-close" onclick="DPLA.closeModal()">×</button></div>
    <div class="modal-body" style="padding:0"><div style="display:grid;grid-template-columns:1fr 300px;min-height:520px">
      <div style="position:relative;background:radial-gradient(ellipse at 40% 40%,#1a1710 0%,#0a0a0b 70%)">
        <div id="vHost" style="position:absolute;inset:0">${design ? '' : '<div class="empty" style="height:100%;display:flex;flex-direction:column;justify-content:center"><div class="empty-title">No design yet</div><div class="empty-desc">Your CAD designer will upload the 3D file here.</div></div>'}</div>
        ${design ? `<div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:8px">
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
            <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">Triangles</span><span id="vTris">—</span></div>
            <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--muted)">Dimensions</span><span id="vDims">—</span></div>
          </div>` : ''}
        <div class="section-title" style="margin-bottom:8px">Estimated price</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:32px;color:var(--gold);margin-bottom:20px">${order.price != null ? money(order.price) : 'Pending'}</div>
        ${sidebar}
      </div></div></div>`, true);

  if (design) {
    const host = $('vHost');
    activeViewer = createViewer(host);
    window.DPLA.viewer = activeViewer;
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
  openModal(`<div class="modal-head"><div class="modal-title">Design Assistant · ${order.code}</div><button class="modal-close" onclick="DPLA.closeChat()">×</button></div>
    <div class="modal-body" style="padding:0;display:flex;flex-direction:column;height:560px">
      <div id="chatLog" style="flex:1;overflow-y:auto;padding:22px;display:flex;flex-direction:column;gap:14px"></div>
      <div id="chatChips" style="display:flex;flex-wrap:wrap;gap:6px;padding:0 22px 12px"></div>
      <div style="display:flex;gap:8px;padding:16px 22px;border-top:1px solid var(--border)">
        <button class="btn" onclick="DPLA.attachSTL()">＋ STL</button>
        <input id="chatField" placeholder="Describe your piece or a change…" onkeydown="if(event.key==='Enter')DPLA.chatSend()" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;color:var(--text);outline:none">
        <button class="btn gold" onclick="DPLA.chatSend()">Send</button>
      </div></div>`, true);
  chatBubble('bot', isOnboarding
    ? `Welcome! Tell me about the piece you'd like — metal, stone, style, size. When you have a CAD file, tap <b>＋ STL</b> to attach it and I'll render it in 3D.`
    : `Hi! Tell me any change you'd like to <b>${esc(order.title)}</b> and I'll send precise notes to your designer.`);
  chips(['A round solitaire engagement ring', 'Make the band thinner', "What's the price?", 'When will it be ready?']);
  setTimeout(() => $('chatField')?.focus(), 100);
}
function closeChat() { closeModal(); if (chatOrder) navTo(defaultView()); }
function chips(list) { const c = $('chatChips'); if (c) c.innerHTML = list.map(s => `<button class="btn sm" onclick="document.getElementById('chatField').value=this.textContent;DPLA.chatSend()">${s}</button>`).join(''); }
function chatBubble(who, html) {
  const log = $('chatLog'); if (!log) return;
  const d = document.createElement('div'); d.style.maxWidth = '85%';
  if (who === 'user') { d.style.alignSelf = 'flex-end'; d.innerHTML = `<div style="background:var(--gold-dim);border:1px solid var(--gold-dim);padding:10px 14px;border-radius:12px 12px 2px 12px;font-size:13px">${html}</div>`; }
  else { d.style.alignSelf = 'flex-start'; d.innerHTML = `<div style="font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);margin-bottom:5px">Assistant</div><div style="background:var(--surface2);border:1px solid var(--border);padding:11px 14px;border-radius:12px 12px 12px 2px;font-size:13px;line-height:1.6">${html}</div>`; }
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function typing(on) { const log = $('chatLog'); if (!log) return; if (on) { const d = document.createElement('div'); d.id = 'typing'; d.style.alignSelf = 'flex-start'; d.innerHTML = `<div style="background:var(--surface2);border:1px solid var(--border);padding:12px 16px;border-radius:12px;display:flex;gap:4px"><span style="width:5px;height:5px;border-radius:50%;background:var(--muted);animation:bounce 1.2s infinite"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--muted);animation:bounce 1.2s infinite .2s"></span><span style="width:5px;height:5px;border-radius:50%;background:var(--muted);animation:bounce 1.2s infinite .4s"></span></div>`; log.appendChild(d); log.scrollTop = log.scrollHeight; } else $('typing')?.remove(); }

async function chatSend() {
  const field = $('chatField'); const text = field.value.trim(); if (!text) return;
  field.value = ''; chatBubble('user', esc(text));
  await DB.addMessage({ order_id: chatOrder, role: 'client_chat', sender: ME.name || ME.email, text });
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
    if (o.designer_id) await DB.notify({ userId: o.designer_id }, `Revision on ${o.code}: ${structured}`);
    await DB.notify({ role: 'admin' }, `Revision on ${o.code} via chat.`);
    chatBubble('bot', `✓ <b>Logged for your designer:</b><br><span style="color:var(--gold)">${esc(structured)}</span><br><span style="color:var(--faint);font-size:12px">Turnaround 2-3 days. You'll be notified.</span>`);
    toast('Revision sent', 'Designer notified', 'success');
  }
  // If this is the onboarding chat and they've described a piece, set the title
  if (order.title === 'Custom piece' && text.length > 8) {
    await DB.updateOrder(chatOrder, { title: text.slice(0, 60) });
  }
}

async function attachSTL() {
  const input = $('fileInput'); input.value = '';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['stl', 'obj', '3dm'].includes(ext)) { toast('Wrong format', 'Use STL, OBJ, or 3DM', 'error'); return; }
    chatBubble('user', `📎 ${esc(file.name)}`);
    typing(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseByExt(ext, buf.slice(0));
      const existing = await DB.designsForOrder(chatOrder);
      const version = existing.length + 1;
      const path = await DB.uploadFile(chatOrder, version, file);
      const design = await DB.addDesign(chatOrder, { file_name: file.name, format: ext.toUpperCase(), storage_path: path, triangle_count: parsed.triangleCount, dimensions: '' });
      const ord = await DB.updateOrder(chatOrder, { status: 'review' });
      await DB.notify({ role: 'admin' }, `Client attached a CAD file to ${ord.code}.`);
      typing(false);
      chatBubble('bot', `Got it — your design is uploaded and rendering. ${parsed.triangleCount.toLocaleString()} triangles. Close this chat and open the order to spin it in 3D, or tell me any change you'd like.`);
      toast('File received', 'Now visible in 3D', 'success');
    } catch (err) { typing(false); chatBubble('bot', `I couldn't read that file: ${esc(err.message)}. Make sure it's a valid STL, OBJ, or 3DM.`); }
  };
  input.click();
}

// ---------- shared UI ----------
function openModal(html, large) { const box = $('modalBox'); box.className = 'modal' + (large ? ' lg' : ''); box.innerHTML = html; $('modalOverlay').classList.add('active'); }
function closeModal() { $('modalOverlay').classList.remove('active'); $('modalBox').innerHTML = ''; if (activeViewer) { activeViewer.dispose(); activeViewer = null; } }
$('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });

function toast(title, msg, type) { const w = $('toastWrap'); const t = document.createElement('div'); t.className = 'toast ' + (type || ''); t.innerHTML = `<div class="toast-title">${title}</div><div class="toast-msg">${msg || ''}</div>`; w.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200); }

function empty(title, desc, btn, action) { return `<div class="empty"><div class="empty-title">${title}</div><div class="empty-desc">${desc}</div>${btn ? `<button class="btn gold" style="margin-top:20px" onclick="${action}">${btn}</button>` : ''}</div>`; }
function badge(s) { return `<span class="badge ${s}">${statusLabel(s)}</span>`; }
function statusLabel(s) { return { new: 'New', progress: 'In Progress', review: 'Ready for Review', done: 'Done', approved: 'Approved', production: 'In Production' }[s] || s; }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function ago(iso) { const s = Math.floor((Date.now() - new Date(iso)) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }

// expose internal handlers
window.DPLA = { clientOpen, approve, designerOpen, setStatus, resolveRev, upload, adminOpen, assign, setPrice, estimator, recalc, applyEstimate, setPrice2, setLabor, setMarkup, chat: openChat, closeChat, chatSend, attachSTL, closeModal, go: navTo, viewer: null };

// ---------- init ----------
paintLanding();
// If the user opened auth before this module loaded, sync the mode now.
if (window.__pendingAuthMode) { authMode = window.__pendingAuthMode; renderAuthMode(); }
supabase.auth.onAuthStateChange((_e, session) => { if (session && !ME) boot(); });
boot(); // try existing session
