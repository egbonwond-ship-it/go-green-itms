// Platform-independent request handlers. Each handler gets
//   { method, params, query, body, principal }
// and returns { status, body }. Azure Functions (functions/*.js) and the local
// dev server (scripts/dev-server.js) both call into these.
const crypto = require('crypto');
const { store } = require('./store');
const C = require('./constants');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const ok = (body, status = 200) => ({ status, body });
const fail = (status, message) => {
  throw new HttpError(status, message);
};

const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const nowIso = () => new Date().toISOString();

// ---------- identity ----------

function parsePrincipal(headerValue) {
  if (!headerValue) return null;
  try {
    const p = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
    if (!p || !p.userId) return null;
    return p;
  } catch {
    return null;
  }
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Loads (and creates on first sign-in) the user's record and works out their role.
async function currentUser(principal) {
  if (!principal) fail(401, 'Please sign in');
  const db = store();
  const id = `user-${principal.userId}`;
  const email = str(principal.userDetails, 320);
  // Optional: only let people from your own email domain(s) in, e.g. "go-greentechnologies.com".
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(/[,;\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (domains.length && !domains.includes(email.toLowerCase().split('@')[1] || '')) {
    fail(403, 'Your account is not allowed to use this service desk');
  }
  let user = await db.get(id);
  const isAdminByEmail = adminEmails().includes(email.toLowerCase());
  const swaRoles = principal.userRoles || [];
  const now = nowIso();

  if (!user) {
    const anyUser = (await db.list('user')).length > 0;
    user = {
      id,
      kind: 'user',
      userId: principal.userId,
      email,
      name: email.includes('@') ? email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : email,
      provider: principal.identityProvider,
      // The very first person to sign in becomes admin so the system is never locked out.
      role: isAdminByEmail || !anyUser ? 'admin' : 'user',
      createdAt: now,
    };
  }
  const roleBefore = user.role;
  if (isAdminByEmail || swaRoles.includes('admin')) user.role = 'admin';
  else if (swaRoles.includes('agent') && user.role === 'user') user.role = 'agent';

  // Only write lastSeen at most every 10 minutes to save RUs.
  if (!user.lastSeen || user.role !== roleBefore || Date.now() - Date.parse(user.lastSeen) > 10 * 60 * 1000) {
    user.lastSeen = now;
    await db.upsert(user);
  }
  return user;
}

const isAgent = (u) => u.role === 'agent' || u.role === 'admin';
const isAdmin = (u) => u.role === 'admin';
const ref = (u) => (u ? { id: u.id, name: u.name, email: u.email } : null);

// ---------- tickets ----------

function priorityOf(impact, urgency) {
  return C.PRIORITY_MATRIX[impact - 1][urgency - 1];
}

function dueDate(priority, fromIso) {
  return new Date(Date.parse(fromIso) + C.SLA_HOURS[priority] * 3600 * 1000).toISOString();
}

function isOpen(t) {
  return C.OPEN_STATES.includes(t.state);
}

function decorate(t) {
  const breached = isOpen(t) && t.dueAt && Date.now() > Date.parse(t.dueAt);
  return { ...t, slaBreached: !!breached };
}

function canSee(user, t) {
  return isAgent(user) || (t.caller && t.caller.id === user.id) || (t.openedBy && t.openedBy.id === user.id);
}

function summary(t) {
  const { activity, ...rest } = decorate(t);
  return { ...rest, commentCount: (activity || []).length };
}

function activity(by, type, text, changes) {
  return { id: crypto.randomUUID(), at: nowIso(), by: ref(by), type, text: text || '', changes: changes || null };
}

async function newTicket({ type, user, fields, caller }) {
  const db = store();
  const prefix = type === 'request' ? 'REQ' : 'INC';
  const n = await db.nextNumber(prefix);
  const number = `${prefix}${String(n).padStart(7, '0')}`;
  const now = nowIso();
  const impact = Number(fields.impact) || 3;
  const urgency = Number(fields.urgency) || 3;
  const priority = priorityOf(impact, urgency);
  const ticket = {
    id: number,
    kind: type,
    number,
    type,
    shortDescription: fields.shortDescription,
    description: fields.description || '',
    category: fields.category || 'Inquiry / Help',
    subcategory: fields.subcategory || '',
    impact,
    urgency,
    priority,
    state: 'New',
    assignmentGroup: fields.assignmentGroup || 'Service Desk',
    assignedTo: fields.assignedTo || null,
    caller: ref(caller || user),
    openedBy: ref(user),
    contactType: fields.contactType || 'Self-service',
    location: fields.location || '',
    catalogItem: fields.catalogItem || null,
    variables: fields.variables || null,
    createdAt: now,
    updatedAt: now,
    dueAt: dueDate(priority, now),
    resolvedAt: null,
    closedAt: null,
    resolutionCode: '',
    resolutionNotes: '',
    activity: [activity(user, 'system', `${type === 'request' ? 'Request' : 'Incident'} opened`)],
  };
  await db.upsert(ticket);
  return ticket;
}

function validateTicketFields(body) {
  const shortDescription = str(body.shortDescription, 160);
  if (!shortDescription) fail(400, 'Short description is required');
  const impact = Number(body.impact);
  const urgency = Number(body.urgency);
  return {
    shortDescription,
    description: str(body.description, 8000),
    category: oneOf(body.category, Object.keys(C.CATEGORIES), 'Inquiry / Help'),
    subcategory: str(body.subcategory, 80),
    impact: [1, 2, 3].includes(impact) ? impact : 3,
    urgency: [1, 2, 3].includes(urgency) ? urgency : 3,
    assignmentGroup: oneOf(body.assignmentGroup, C.GROUPS, 'Service Desk'),
    contactType: oneOf(body.contactType, C.CONTACT_TYPES, 'Self-service'),
    location: str(body.location, 120),
  };
}

async function resolveAssignee(id) {
  if (!id) return null;
  const u = await store().get(id);
  if (!u || u.kind !== 'user') fail(400, 'Unknown assignee');
  if (!isAgent(u)) fail(400, 'Tickets can only be assigned to agents');
  return ref(u);
}

const routes = {
  // Public: used by uptime checks and the daily keep-alive job. Touches the database
  // so a paused or unreachable database shows up here.
  async health() {
    const started = Date.now();
    await store().get('counter-INC');
    return ok({ ok: true, db: 'up', ms: Date.now() - started, at: nowIso() });
  },

  async me({ principal }) {
    const user = await currentUser(principal);
    return ok({ user: { id: user.id, name: user.name, email: user.email, role: user.role, provider: user.provider } });
  },

  async updateMe({ principal, body }) {
    const user = await currentUser(principal);
    const name = str(body.name, 80);
    if (name) user.name = name;
    await store().upsert(user);
    return ok({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  },

  async meta() {
    return ok({
      categories: C.CATEGORIES,
      groups: C.GROUPS,
      states: C.STATES,
      openStates: C.OPEN_STATES,
      transitions: C.TRANSITIONS,
      priorities: C.PRIORITIES,
      priorityMatrix: C.PRIORITY_MATRIX,
      slaHours: C.SLA_HOURS,
      contactTypes: C.CONTACT_TYPES,
      resolutionCodes: C.RESOLUTION_CODES,
    });
  },

  async listTickets({ principal, query }) {
    const user = await currentUser(principal);
    const types = query.type === 'request' ? ['request'] : query.type === 'incident' ? ['incident'] : ['incident', 'request'];
    let rows = [];
    for (const k of types) rows = rows.concat(await store().list(k));
    rows = rows.filter((t) => canSee(user, t));
    if (query.mine === '1' || !isAgent(user)) {
      if (query.mine === '1' && isAgent(user)) rows = rows.filter((t) => t.assignedTo && t.assignedTo.id === user.id);
      else rows = rows.filter((t) => (t.caller && t.caller.id === user.id) || (t.openedBy && t.openedBy.id === user.id));
    }
    if (query.state === 'open') rows = rows.filter(isOpen);
    else if (query.state) rows = rows.filter((t) => t.state === query.state);
    if (query.priority) rows = rows.filter((t) => String(t.priority) === String(query.priority));
    if (query.group) rows = rows.filter((t) => t.assignmentGroup === query.group);
    if (query.assignedTo === 'none') rows = rows.filter((t) => !t.assignedTo);
    else if (query.assignedTo) rows = rows.filter((t) => t.assignedTo && t.assignedTo.id === query.assignedTo);
    if (query.breached === '1') rows = rows.filter((t) => decorate(t).slaBreached);
    if (query.q) {
      const q = String(query.q).toLowerCase();
      rows = rows.filter((t) =>
        [t.number, t.shortDescription, t.description, t.caller && t.caller.name, t.category]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      );
    }
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return ok({ items: rows.slice(0, 500).map(summary), total: rows.length });
  },

  async createTicket({ principal, body }) {
    const user = await currentUser(principal);
    const fields = validateTicketFields(body);
    let caller = user;
    if (isAgent(user)) {
      if (body.callerId) {
        const c = await store().get(body.callerId);
        if (!c || c.kind !== 'user') fail(400, 'Unknown caller');
        caller = c;
      }
      fields.assignedTo = await resolveAssignee(body.assignedTo);
    } else {
      fields.contactType = 'Self-service';
    }
    const t = await newTicket({ type: 'incident', user, fields, caller });
    return ok(decorate(t), 201);
  },

  async getTicket({ principal, params }) {
    const user = await currentUser(principal);
    const t = await store().get(params.id);
    if (!t || !['incident', 'request'].includes(t.kind) || !canSee(user, t)) fail(404, 'Ticket not found');
    let rows = t.activity || [];
    if (!isAgent(user)) rows = rows.filter((a) => a.type !== 'worknote');
    return ok({ ...decorate(t), activity: rows });
  },

  async updateTicket({ principal, params, body }) {
    const user = await currentUser(principal);
    const db = store();
    const t = await db.get(params.id);
    if (!t || !['incident', 'request'].includes(t.kind) || !canSee(user, t)) fail(404, 'Ticket not found');
    const changes = [];
    const set = (field, label, value, display) => {
      const before = t[field];
      if (JSON.stringify(before) === JSON.stringify(value)) return;
      changes.push({ field: label, from: display ? display(before) : before, to: display ? display(value) : value });
      t[field] = value;
    };
    const name = (r) => (r ? r.name : '(empty)');

    if (!isAgent(user)) {
      // Requesters may only cancel a new ticket, accept (close) or reopen a resolved one.
      const allowed = { New: ['Canceled'], Resolved: ['Closed', 'In Progress'] };
      const keys = Object.keys(body).filter((k) => k !== 'comment');
      if (keys.some((k) => k !== 'state')) fail(403, 'Only the service desk can edit ticket fields');
      if (body.state && !(allowed[t.state] || []).includes(body.state)) fail(403, `You can't move this ticket to ${body.state}`);
    } else {
      if ('shortDescription' in body) {
        const v = str(body.shortDescription, 160);
        if (!v) fail(400, 'Short description is required');
        set('shortDescription', 'Short description', v);
      }
      if ('description' in body) set('description', 'Description', str(body.description, 8000));
      if ('category' in body) set('category', 'Category', oneOf(body.category, Object.keys(C.CATEGORIES), t.category));
      if ('subcategory' in body) set('subcategory', 'Subcategory', str(body.subcategory, 80));
      if ('assignmentGroup' in body) set('assignmentGroup', 'Assignment group', oneOf(body.assignmentGroup, C.GROUPS, t.assignmentGroup));
      if ('location' in body) set('location', 'Location', str(body.location, 120));
      if ('contactType' in body) set('contactType', 'Contact type', oneOf(body.contactType, C.CONTACT_TYPES, t.contactType));
      if ('assignedTo' in body) set('assignedTo', 'Assigned to', await resolveAssignee(body.assignedTo), name);
      if ('impact' in body || 'urgency' in body) {
        const impact = [1, 2, 3].includes(Number(body.impact)) ? Number(body.impact) : t.impact;
        const urgency = [1, 2, 3].includes(Number(body.urgency)) ? Number(body.urgency) : t.urgency;
        set('impact', 'Impact', impact, (v) => C.LEVELS[v]);
        set('urgency', 'Urgency', urgency, (v) => C.LEVELS[v]);
        const p = priorityOf(impact, urgency);
        if (p !== t.priority) {
          set('priority', 'Priority', p, (v) => C.PRIORITIES[v]);
          t.dueAt = dueDate(p, t.createdAt);
        }
      }
      if ('resolutionCode' in body) set('resolutionCode', 'Resolution code', oneOf(body.resolutionCode, C.RESOLUTION_CODES, ''));
      if ('resolutionNotes' in body) set('resolutionNotes', 'Resolution notes', str(body.resolutionNotes, 8000));
    }

    if (body.state && body.state !== t.state) {
      const next = body.state;
      if (!C.STATES.includes(next)) fail(400, 'Unknown state');
      if (!(C.TRANSITIONS[t.state] || []).includes(next)) fail(400, `Can't move from ${t.state} to ${next}`);
      if (next === 'Resolved' && (!t.resolutionCode || !t.resolutionNotes)) {
        fail(400, 'Add a resolution code and resolution notes before resolving');
      }
      if (next === 'In Progress' && !t.assignedTo && isAgent(user)) set('assignedTo', 'Assigned to', ref(user), name);
      set('state', 'State', next);
      if (next === 'Resolved') t.resolvedAt = nowIso();
      if (next === 'Closed' || next === 'Canceled') t.closedAt = nowIso();
      if (next === 'In Progress') {
        t.resolvedAt = null;
      }
    }

    const comment = str(body.comment, 8000);
    if (!changes.length && !comment) return ok(decorate(t));
    t.updatedAt = nowIso();
    t.activity = t.activity || [];
    if (changes.length) t.activity.push(activity(user, 'change', '', changes));
    if (comment) t.activity.push(activity(user, 'comment', comment));
    await db.upsert(t);
    return ok(decorate(t));
  },

  async addComment({ principal, params, body }) {
    const user = await currentUser(principal);
    const db = store();
    const t = await db.get(params.id);
    if (!t || !['incident', 'request'].includes(t.kind) || !canSee(user, t)) fail(404, 'Ticket not found');
    const text = str(body.text, 8000);
    if (!text) fail(400, 'Comment text is required');
    const internal = !!body.internal && isAgent(user);
    t.activity = t.activity || [];
    const entry = activity(user, internal ? 'worknote' : 'comment', text);
    t.activity.push(entry);
    t.updatedAt = nowIso();
    await db.upsert(t);
    return ok(entry, 201);
  },

  // ---------- service catalog ----------

  async listCatalog({ principal, query }) {
    const user = await currentUser(principal);
    let items = await store().list('catalog');
    if (!items.length) items = await seedCatalog();
    if (!(isAdmin(user) && query.all === '1')) items = items.filter((i) => i.active !== false);
    items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return ok({ items });
  },

  async saveCatalogItem({ principal, params, body }) {
    const user = await currentUser(principal);
    if (!isAdmin(user)) fail(403, 'Only admins can manage the catalog');
    const db = store();
    let item = params.id ? await db.get(params.id) : null;
    if (params.id && (!item || item.kind !== 'catalog')) fail(404, 'Catalog item not found');
    const name = str(body.name, 100);
    if (!name) fail(400, 'Name is required');
    const fields = Array.isArray(body.fields)
      ? body.fields.slice(0, 20).map((f) => ({
          name: str(f.name, 40).replace(/[^a-zA-Z0-9_]/g, '_') || 'field',
          label: str(f.label, 100) || 'Field',
          type: oneOf(f.type, ['text', 'textarea', 'select', 'date', 'number', 'checkbox'], 'text'),
          required: !!f.required,
          options: Array.isArray(f.options) ? f.options.map((o) => str(o, 80)).filter(Boolean).slice(0, 30) : [],
        }))
      : [];
    item = {
      ...(item || { id: `cat-${crypto.randomUUID()}`, kind: 'catalog', createdAt: nowIso() }),
      name,
      category: str(body.category, 60) || 'General',
      icon: str(body.icon, 8) || '📦',
      description: str(body.description, 1000),
      fulfillmentGroup: oneOf(body.fulfillmentGroup, C.GROUPS, 'Service Desk'),
      deliveryDays: Math.max(0, Math.min(90, Number(body.deliveryDays) || 2)),
      approvalRequired: !!body.approvalRequired,
      active: body.active !== false,
      fields,
      updatedAt: nowIso(),
    };
    await db.upsert(item);
    return ok(item, params.id ? 200 : 201);
  },

  async deleteCatalogItem({ principal, params }) {
    const user = await currentUser(principal);
    if (!isAdmin(user)) fail(403, 'Only admins can manage the catalog');
    await store().remove(params.id);
    return ok({ deleted: params.id });
  },

  async orderCatalogItem({ principal, params, body }) {
    const user = await currentUser(principal);
    const item = await store().get(params.id);
    if (!item || item.kind !== 'catalog' || item.active === false) fail(404, 'Catalog item not found');
    const input = body.variables || {};
    const variables = {};
    for (const f of item.fields || []) {
      let v = input[f.name];
      if (f.type === 'checkbox') v = !!v;
      else v = str(v == null ? '' : String(v), 2000);
      if (f.required && (v === '' || v === false)) fail(400, `${f.label} is required`);
      if (f.type === 'select' && v && !f.options.includes(v)) fail(400, `${f.label} has an invalid value`);
      variables[f.name] = { label: f.label, value: v };
    }
    const t = await newTicket({
      type: 'request',
      user,
      fields: {
        shortDescription: `${item.name}${body.forWhom ? ` for ${str(body.forWhom, 80)}` : ''}`,
        description: str(body.notes, 4000),
        category: 'Request',
        subcategory: item.category,
        // Requests land at 4 - Low, or 3 - Moderate when marked urgent.
        impact: 2,
        urgency: Number(body.urgency) === 2 ? 2 : 3,
        assignmentGroup: item.fulfillmentGroup,
        catalogItem: { id: item.id, name: item.name, approvalRequired: !!item.approvalRequired },
        variables,
      },
    });
    // Catalog SLA is the item's delivery time rather than the incident matrix.
    t.dueAt = new Date(Date.parse(t.createdAt) + Math.max(1, item.deliveryDays) * 86400000).toISOString();
    await store().upsert(t);
    return ok(decorate(t), 201);
  },

  // ---------- users ----------

  async listUsers({ principal }) {
    const user = await currentUser(principal);
    if (!isAgent(user)) fail(403, 'Agents only');
    const users = (await store().list('user')).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      provider: u.provider,
      lastSeen: u.lastSeen,
    }));
    users.sort((a, b) => a.name.localeCompare(b.name));
    return ok({ items: users });
  },

  async updateUser({ principal, params, body }) {
    const user = await currentUser(principal);
    if (!isAdmin(user)) fail(403, 'Only admins can change roles');
    const db = store();
    const u = await db.get(params.id);
    if (!u || u.kind !== 'user') fail(404, 'User not found');
    if ('role' in body) {
      const role = oneOf(body.role, ['user', 'agent', 'admin'], null);
      if (!role) fail(400, 'Unknown role');
      if (u.id === user.id && role !== 'admin') fail(400, "You can't remove your own admin role");
      u.role = role;
    }
    if ('name' in body && str(body.name, 80)) u.name = str(body.name, 80);
    await db.upsert(u);
    return ok({ id: u.id, name: u.name, email: u.email, role: u.role });
  },

  // ---------- dashboard ----------

  async stats({ principal }) {
    const user = await currentUser(principal);
    let rows = [...(await store().list('incident')), ...(await store().list('request'))].filter((t) => canSee(user, t));
    if (!isAgent(user)) rows = rows.filter((t) => t.caller && t.caller.id === user.id);
    const open = rows.filter(isOpen);
    const count = (list, key) =>
      list.reduce((acc, t) => {
        const k = typeof key === 'function' ? key(t) : t[key];
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push({
        date: d,
        opened: rows.filter((t) => (t.createdAt || '').slice(0, 10) === d).length,
        resolved: rows.filter((t) => (t.resolvedAt || '').slice(0, 10) === d).length,
      });
    }
    const resolved = rows.filter((t) => t.resolvedAt);
    const avgHours = resolved.length
      ? resolved.reduce((s, t) => s + (Date.parse(t.resolvedAt) - Date.parse(t.createdAt)), 0) / resolved.length / 3600000
      : null;
    return ok({
      total: rows.length,
      open: open.length,
      openIncidents: open.filter((t) => t.type === 'incident').length,
      openRequests: open.filter((t) => t.type === 'request').length,
      unassigned: open.filter((t) => !t.assignedTo).length,
      mine: open.filter((t) => t.assignedTo && t.assignedTo.id === user.id).length,
      breached: open.filter((t) => decorate(t).slaBreached).length,
      critical: open.filter((t) => t.priority <= 2).length,
      avgResolutionHours: avgHours,
      byState: count(rows, 'state'),
      byPriority: count(open, 'priority'),
      byGroup: count(open, 'assignmentGroup'),
      byCategory: count(open, 'category'),
      trend: days,
      recent: rows
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, 8)
        .map(summary),
    });
  },
};

async function seedCatalog() {
  const db = store();
  const out = [];
  for (const item of C.SEED_CATALOG) {
    const doc = {
      id: `cat-${crypto.randomUUID()}`,
      kind: 'catalog',
      active: true,
      approvalRequired: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...item,
    };
    await db.upsert(doc);
    out.push(doc);
  }
  return out;
}

// Wraps a route so errors become clean JSON responses.
async function run(name, req) {
  try {
    return await routes[name](req);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: 'Something went wrong on the server' } };
  }
}

module.exports = { run, routes, parsePrincipal };
