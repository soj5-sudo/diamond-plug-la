// ===== Data layer — matches YOUR pasted schema (users + auth_id) =====
import { supabase } from './config.js';

export const DB = {
  // ---- pricing ----
  async getPricing() {
    const { data } = await supabase.from('pricing').select('config').eq('id', 1).single();
    return data?.config || null;
  },
  async savePricing(config) {
    await supabase.from('pricing').update({ config, updated_at: new Date().toISOString() }).eq('id', 1);
  },

  // ---- users (your table: id, auth_id, name, email, role) ----
  async myProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    let { data } = await supabase.from('users').select('*').eq('auth_id', user.id).maybeSingle();
    if (!data) {
      const byEmail = await supabase.from('users').select('*').eq('email', user.email).maybeSingle();
      if (byEmail.data) {
        await supabase.from('users').update({ auth_id: user.id }).eq('id', byEmail.data.id);
        data = byEmail.data;
      }
    }
    return data;
  },
  async profilesByRole(role) {
    const { data } = await supabase.from('users').select('*').eq('role', role).order('created_at');
    return data || [];
  },
  async profile(id) {
    const { data } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    return data;
  },

  // ---- orders ----
  async createOrder(clientId, title) {
    const code = 'DPLA-' + (1000 + Math.floor(Math.random() * 9000));
    const { data, error } = await supabase.from('orders')
      .insert({ code, client_id: clientId, title, status: 'new' })
      .select().single();
    if (error) throw error;
    return data;
  },
  async order(id) {
    const { data } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
    return data;
  },
  async ordersForClient(cid) {
    const { data } = await supabase.from('orders').select('*').eq('client_id', cid).order('updated_at', { ascending: false });
    return data || [];
  },
  async ordersForDesigner(did) {
    const { data } = await supabase.from('orders').select('*').eq('designer_id', did).order('updated_at', { ascending: false });
    return data || [];
  },
  async allOrders() {
    const { data } = await supabase.from('orders').select('*').order('updated_at', { ascending: false });
    return data || [];
  },
  async updateOrder(id, patch) {
    patch.updated_at = new Date().toISOString();
    const { data } = await supabase.from('orders').update(patch).eq('id', id).select().single();
    return data;
  },

  // ---- designs (your table uses 'stats' jsonb) ----
  async designsForOrder(oid) {
    const { data } = await supabase.from('designs').select('*').eq('order_id', oid).order('version');
    return data || [];
  },
  async latestDesign(oid) {
    const ds = await this.designsForOrder(oid);
    return ds.length ? ds[ds.length - 1] : null;
  },
  async addDesign(orderId, d) {
    const existing = await this.designsForOrder(orderId);
    const row = {
      order_id: orderId,
      version: existing.length + 1,
      file_name: d.file_name,
      format: d.format,
      storage_path: d.storage_path,
      stats: { triangles: d.triangle_count ?? null, dims: d.dimensions ?? null },
      uploaded_by: d.uploaded_by ?? null
    };
    const { data, error } = await supabase.from('designs').insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async uploadFile(orderId, version, file) {
    const safe = file.name.replace(/[^\w.\-]/g, '_');
    const path = `${orderId}/v${version}-${safe}`;
    const { error } = await supabase.storage.from('designs').upload(path, file, { upsert: true });
    if (error) throw error;
    return path;
  },
  async downloadFile(path) {
    const { data, error } = await supabase.storage.from('designs').download(path);
    if (error) throw error;
    return await data.arrayBuffer();
  },

  // ---- revisions ----
  async addRevision(r) {
    const { data } = await supabase.from('revisions').insert({ status: 'open', ...r }).select().single();
    return data;
  },
  async revisionsForOrder(oid) {
    const { data } = await supabase.from('revisions').select('*').eq('order_id', oid).order('created_at', { ascending: false });
    return data || [];
  },
  async resolveRevision(id) {
    await supabase.from('revisions').update({ status: 'addressed' }).eq('id', id);
  },

  // ---- messages ----
  async addMessage(m) {
    await supabase.from('messages').insert(m);
  },
  async messagesForOrder(oid) {
    const { data } = await supabase.from('messages').select('*').eq('order_id', oid).order('created_at');
    return data || [];
  },

  // ---- notifications (your table: user_id + role) ----
  async notify(target, text) {
    await supabase.from('notifications').insert({ user_id: target.userId || null, role: target.role || null, text });
  },
  async myNotifs(profile) {
    const { data } = await supabase.from('notifications').select('*')
      .or(`user_id.eq.${profile.id},role.eq.${profile.role}`)
      .order('created_at', { ascending: false });
    return data || [];
  },
  async unread(profile) {
    const ns = await this.myNotifs(profile);
    return ns.filter(n => !n.read).length;
  },
  async markRead(profile) {
    await supabase.from('notifications').update({ read: true })
      .or(`user_id.eq.${profile.id},role.eq.${profile.role}`).eq('read', false);
  }
};

// ===== pricing engine =====
export function estimatePrice(p, inp) {
  const metalRate = p.metals[inp.metal] ?? 50;
  const metalCost = metalRate * (parseFloat(inp.weight) || 0);
  const stoneRate = p.stonePerCarat[inp.stone] ?? 0;
  const clar = p.clarityMult[inp.clarity] ?? 1;
  const col = p.colorMult[inp.color] ?? 1;
  const cut = p.cutMult[inp.cut] ?? 1;
  const stoneCost = stoneRate * (parseFloat(inp.carat) || 0) * clar * col * cut * (parseInt(inp.stoneCount) || 1);
  const labor = p.laborBase * (p.complexityMult[inp.complexity] ?? 1);
  const subtotal = metalCost + stoneCost + labor;
  const total = subtotal * (1 + p.markupPct / 100);
  const r = n => Math.round(n * 100) / 100;
  return { metalCost: r(metalCost), stoneCost: r(stoneCost), labor: r(labor), subtotal: r(subtotal), markup: r(total - subtotal), total: r(total) };
}
export const money = n => n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
