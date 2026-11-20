/* GO-Green IT Service Desk front end. Plain JavaScript, no build step. */
(() => {
  'use strict';

  const LOGO_REMOTE = 'https://www.go-greentechnologies.com/logo-full.svg';
  const LOGO_LOCAL = 'assets/logo-full.svg';
  const state = { me: null, meta: null, users: null, catalog: null, counts: {} };
  const $app = document.getElementById('app');

  // ---------- helpers ----------
  const esc = (v) =>
    String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const initials = (n) => (n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const isAgent = () => state.me && ['agent', 'admin'].includes(state.me.role);
  const isAdmin = () => state.me && state.me.role === 'admin';
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const ago = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  };
  const due = (t) => {
    if (!t.dueAt || !state.meta.openStates.includes(t.state)) return '';
    const ms = Date.parse(t.dueAt) - Date.now();
    const h = Math.abs(ms) / 3600000;
    const txt = h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
    return ms < 0 ? `<span class="sla-bad">Breached ${txt} ago</span>` : `<span class="muted">Due in ${txt}</span>`;
  };
  const prioBadge = (p) => `<span class="badge prio prio-${p}">${esc(state.meta.priorities[p])}</span>`;
  const stateBadge = (s) => `<span class="badge st-${esc(s.replace(/\s+/g, '-'))}">${esc(s)}</span>`;
  const options = (list, sel, blank) =>
    (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
    list.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('');
  const levels = [[1, '1 - High'], [2, '2 - Medium'], [3, '3 - Low']];

  function toast(msg, err) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `show${err ? ' err' : ''}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.className = ''), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api/${path}`, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (res.status === 401) {
      renderLogin();
      throw new Error('Please sign in');
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  const logoImg = (cls = 'logo') =>
    `<img class="${cls}" src="${LOGO_REMOTE}" alt="GO-Green Technologies" onerror="this.onerror=null;this.src='${LOGO_LOCAL}'">`;

  // ---------- login ----------
  function renderLogin() {
    const back = encodeURIComponent(location.pathname + location.hash);
    $app.innerHTML = `
      <div class="login">
        <div class="hero">
          <div style="font-family:var(--font-heading);letter-spacing:.12em;font-size:12px;color:#9cc7ad">VOICE · DATA · POWER · SECURITY</div>
          <div>
            <h1>IT support that keeps your business <span class="sun">powered</span>, <span class="sun">secure</span> and <span class="sun">connected</span>.</h1>
            <p style="max-width:440px;color:#b9d6c4">Report an issue, request a service and track every ticket in one place.</p>
          </div>
          <div style="font-size:12px;color:#7fa48f">SMARTER SYSTEMS. A GREENER FUTURE.</div>
        </div>
        <div class="panel">
          <div class="box">
            ${logoImg()}
            <h2>Sign in to the Service Desk</h2>
            <a class="btn primary" href="/.auth/login/aad?post_login_redirect_uri=${back}">Sign in with Microsoft</a>
            <a class="btn" href="/.auth/login/github?post_login_redirect_uri=${back}">Sign in with GitHub</a>
            <p class="hint">Use your work Microsoft 365 account. New users are added automatically as requesters.</p>
          </div>
        </div>
      </div>`;
  }

  // ---------- shell ----------
  function navLink(href, icon, label, count) {
    const active = location.hash === href || (href !== '#/' && location.hash.startsWith(href + '/'));
    return `<a href="${href}" class="${active ? 'active' : ''}"><span>${icon}</span><span>${esc(label)}</span>${count != null ? `<span class="count">${count}</span>` : ''}</a>`;
  }

  function shell(content) {
    const me = state.me;
    const c = state.counts;
    const nav = isAgent()
      ? `
        <div class="section">Service Desk</div>
        ${navLink('#/', '📊', 'Dashboard')}
        ${navLink('#/new', '➕', 'Create incident')}
        ${navLink('#/queue', '👤', 'Assigned to me', c.mine)}
        ${navLink('#/unassigned', '📥', 'Unassigned', c.unassigned)}
        <div class="section">Records</div>
        ${navLink('#/incidents', '🚨', 'Incidents', c.openIncidents)}
        ${navLink('#/requests', '📦', 'Requests', c.openRequests)}
        ${navLink('#/breached', '⏰', 'SLA breached', c.breached)}
        <div class="section">Self-service</div>
        ${navLink('#/catalog', '🛒', 'Service catalog')}
        ${navLink('#/my', '🗂️', 'My tickets')}
        ${isAdmin() ? `<div class="section">Administration</div>${navLink('#/admin/catalog', '🧰', 'Catalog items')}${navLink('#/admin/users', '👥', 'Users & roles')}` : ''}`
      : `
        <div class="section">Self-service</div>
        ${navLink('#/', '🏠', 'Home')}
        ${navLink('#/new', '🛠️', 'Report an issue')}
        ${navLink('#/catalog', '🛒', 'Request something')}
        ${navLink('#/my', '🗂️', 'My tickets')}`;
    $app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <button class="menu-btn" aria-label="Menu" id="menuBtn">☰</button>
          <a href="#/">${logoImg()}</a>
          <span class="product">IT Service Desk</span>
          <form class="search" id="globalSearch"><input name="q" placeholder="Search tickets (number, text, caller)…" aria-label="Search"></form>
          <div class="user">
            <span class="role-pill">${esc(me.role)}</span>
            <span class="name">${esc(me.name)}</span>
            <span class="avatar" title="${esc(me.email)}">${esc(initials(me.name))}</span>
            <a class="btn small" href="/.auth/logout?post_logout_redirect_uri=/">Sign out</a>
          </div>
        </header>
        <nav class="sidebar">${nav}<div class="tagline">SMARTER SYSTEMS.<br>A GREENER FUTURE.</div></nav>
        <main class="main" id="main">${content}</main>
      </div>`;
    document.getElementById('menuBtn').onclick = () => document.querySelector('.shell').classList.toggle('nav-open');
    document.getElementById('globalSearch').onsubmit = (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      location.hash = `#/${isAgent() ? 'incidents' : 'my'}?q=${encodeURIComponent(q)}`;
    };
  }

  async function refreshCounts() {
    try {
      state.counts = await api('stats');
    } catch {}
  }

  // ---------- pages ----------
  function bars(obj, labelFn, max) {
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<div class="empty">Nothing open</div>';
    const top = max || Math.max(...entries.map((e) => e[1]));
    return `<div class="bars">${entries
      .map(([k, v]) => `<div class="bar"><span>${labelFn ? labelFn(k) : esc(k)}</span><div class="track"><div class="fill" style="width:${(v / top) * 100}%"></div></div><span class="n">${v}</span></div>`)
      .join('')}</div>`;
  }

  function ticketTable(items, opts = {}) {
    if (!items.length) return `<div class="empty">${opts.empty || 'No tickets found'}</div>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th>Number</th><th>Short description</th>${opts.caller !== false ? '<th>Caller</th>' : ''}<th>Priority</th><th>State</th><th>Assigned to</th><th>SLA</th><th>Updated</th></tr></thead>
      <tbody>${items
        .map(
          (t) => `<tr class="click" data-href="#/ticket/${esc(t.id)}">
            <td class="num"><a href="#/ticket/${esc(t.id)}">${esc(t.number)}</a></td>
            <td>${esc(t.shortDescription)}<div class="hint">${esc(t.category)}${t.subcategory ? ' · ' + esc(t.subcategory) : ''} · ${esc(t.assignmentGroup)}</div></td>
            ${opts.caller !== false ? `<td>${esc(t.caller ? t.caller.name : '')}</td>` : ''}
            <td>${prioBadge(t.priority)}</td>
            <td>${stateBadge(t.state)}</td>
            <td>${t.assignedTo ? esc(t.assignedTo.name) : '<span class="muted">(unassigned)</span>'}</td>
            <td>${due(t)}</td>
            <td title="${esc(fmtDate(t.updatedAt))}">${esc(ago(t.updatedAt))}</td>
          </tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  function bindRows() {
    document.querySelectorAll('tr.click').forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest('a')) return;
        location.hash = tr.dataset.href;
      };
    });
  }

  async function pageDashboard() {
    const s = state.counts.trend ? state.counts : await api('stats');
    state.counts = s;
    if (!isAgent()) return pageHome(s);
    const maxTrend = Math.max(1, ...s.trend.map((d) => Math.max(d.opened, d.resolved)));
    shell(`
      <div class="page-head"><h1>Service desk overview</h1><div class="actions"><a class="btn primary" href="#/new">➕ New incident</a></div></div>
      <div class="grid kpis">
        <a class="card kpi" href="#/incidents?state=open"><div class="v">${s.openIncidents}</div><div class="l">Open incidents</div></a>
        <a class="card kpi" href="#/requests?state=open"><div class="v">${s.openRequests}</div><div class="l">Open requests</div></a>
        <a class="card kpi sun" href="#/unassigned"><div class="v">${s.unassigned}</div><div class="l">Unassigned</div></a>
        <a class="card kpi" href="#/queue"><div class="v">${s.mine}</div><div class="l">Assigned to me</div></a>
        <a class="card kpi warn" href="#/incidents?state=open&priority=1"><div class="v">${s.critical}</div><div class="l">Critical / High open</div></a>
        <a class="card kpi warn" href="#/breached"><div class="v">${s.breached}</div><div class="l">SLA breached</div></a>
        <div class="card kpi"><div class="v">${s.avgResolutionHours == null ? '–' : s.avgResolutionHours < 48 ? s.avgResolutionHours.toFixed(1) + 'h' : (s.avgResolutionHours / 24).toFixed(1) + 'd'}</div><div class="l">Avg. time to resolve</div></div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card"><div class="row"><h3>Opened vs resolved, last 14 days</h3><span class="spacer"></span><div class="legend"><span><i style="background:var(--brand-600)"></i>Opened</span><span><i style="background:var(--sun-500)"></i>Resolved</span></div></div>
          <div class="trend">${s.trend
            .map(
              (d) => `<div class="col" title="${esc(d.date)}: ${d.opened} opened, ${d.resolved} resolved"><div class="pair"><div class="o" style="height:${(d.opened / maxTrend) * 100}%"></div><div class="r" style="height:${(d.resolved / maxTrend) * 100}%"></div></div><span class="d">${esc(d.date.slice(8))}</span></div>`
            )
            .join('')}</div></div>
        <div class="card"><h3>Open by priority</h3>${bars(s.byPriority, (k) => prioBadge(k))}</div>
        <div class="card"><h3>Open by assignment group</h3>${bars(s.byGroup)}</div>
        <div class="card"><h3>Open by category</h3>${bars(s.byCategory)}</div>
      </div>
      <div class="card" style="margin-top:16px"><h3>Recently updated</h3>${ticketTable(s.recent)}</div>`);
    bindRows();
  }

  function pageHome(s) {
    shell(`
      <div class="card" style="background:linear-gradient(120deg,var(--brand-900),var(--brand-700));color:#e7f2eb;border:0;padding:28px">
        <h1 style="color:#fff">Hi ${esc(state.me.name.split(' ')[0])}, how can we help?</h1>
        <p style="margin:0 0 16px;color:#b9d6c4">Report something that's broken, or request something new.</p>
        <div class="row"><a class="btn sun" href="#/new">🛠️ Report an issue</a><a class="btn" href="#/catalog">🛒 Browse the service catalog</a></div>
      </div>
      <div class="grid kpis" style="margin-top:16px">
        <a class="card kpi" href="#/my?state=open"><div class="v">${s.open}</div><div class="l">Your open tickets</div></a>
        <a class="card kpi sun" href="#/my?state=Resolved"><div class="v">${s.byState.Resolved || 0}</div><div class="l">Awaiting your confirmation</div></a>
        <a class="card kpi" href="#/my"><div class="v">${s.total}</div><div class="l">All your tickets</div></a>
      </div>
      <div class="card" style="margin-top:16px"><h3>Your recent tickets</h3>${ticketTable(s.recent, { caller: false, empty: 'You have no tickets yet' })}</div>`);
    bindRows();
  }

  async function pageList(kind, hashQuery) {
    const q = new URLSearchParams(hashQuery || '');
    const presets = {
      incidents: { title: 'Incidents', type: 'incident' },
      requests: { title: 'Requests', type: 'request' },
      queue: { title: 'Assigned to me', mine: '1', state: q.get('state') || 'open' },
      unassigned: { title: 'Unassigned', assignedTo: 'none', state: 'open' },
      breached: { title: 'SLA breached', breached: '1' },
      my: { title: 'My tickets' },
    };
    const p = presets[kind];
    const params = new URLSearchParams();
    const filt = {
      type: p.type || q.get('type') || '',
      state: q.get('state') ?? p.state ?? (kind === 'my' ? '' : 'open'),
      priority: q.get('priority') || '',
      group: q.get('group') || '',
      q: q.get('q') || '',
    };
    Object.entries({ ...filt, mine: p.mine, assignedTo: p.assignedTo, breached: p.breached }).forEach(([k, v]) => v && params.set(k, v));
    const data = await api(`tickets?${params}`);
    const m = state.meta;
    shell(`
      <div class="page-head"><h1>${esc(p.title)}</h1><span class="muted">${data.total} record${data.total === 1 ? '' : 's'}</span>
        <div class="actions">${kind === 'requests' ? '<a class="btn primary" href="#/catalog">🛒 New request</a>' : '<a class="btn primary" href="#/new">➕ New incident</a>'}</div></div>
      <div class="card">
        <form class="filters" id="filters">
          <input name="q" placeholder="Search…" value="${esc(filt.q)}">
          ${!p.type ? `<select name="type">${options([['incident', 'Incidents'], ['request', 'Requests']], filt.type, 'All types')}</select>` : ''}
          <select name="state">${options([['open', 'All open'], ...m.states.map((s) => [s, s])], filt.state, 'Any state')}</select>
          <select name="priority">${options(Object.entries(m.priorities), filt.priority, 'Any priority')}</select>
          ${isAgent() ? `<select name="group">${options(m.groups, filt.group, 'Any group')}</select>` : ''}
          <button class="btn">Filter</button>
        </form>
        ${ticketTable(data.items, { caller: kind !== 'my' })}
      </div>`);
    bindRows();
    document.getElementById('filters').onsubmit = (e) => {
      e.preventDefault();
      const fd = new URLSearchParams(new FormData(e.target));
      [...fd.keys()].forEach((k) => !fd.get(k) && fd.delete(k));
      if (!fd.has('state')) fd.set('state', '');
      location.hash = `#/${kind}?${fd}`;
    };
  }

  async function ensureUsers() {
    if (isAgent() && !state.users) state.users = (await api('users')).items;
    return state.users || [];
  }

  async function pageNew() {
    const m = state.meta;
    const users = await ensureUsers();
    const agents = users.filter((u) => u.role !== 'user');
    const cats = Object.keys(m.categories).filter((c) => c !== 'Request');
    shell(`
      <div class="page-head"><h1>${isAgent() ? 'New incident' : 'Report an issue'}</h1></div>
      <form class="card form" id="newForm">
        ${isAgent() ? `<label class="f"><span>Caller</span><select name="callerId">${options(users.map((u) => [u.id, `${u.name} (${u.email})`]), state.me.id)}</select></label>
        <label class="f"><span>Contact type</span><select name="contactType">${options(m.contactTypes, 'Phone')}</select></label>` : ''}
        <label class="f"><span>Category</span><select name="category" id="cat">${options(cats, 'Inquiry / Help')}</select></label>
        <label class="f"><span>Subcategory</span><select name="subcategory" id="subcat"></select></label>
        <label class="f"><span>Impact <span class="hint">how many people are affected</span></span><select name="impact" id="impact">${options([[1, '1 - High (whole site / many users)'], [2, '2 - Medium (a team)'], [3, '3 - Low (just me)']], 3)}</select></label>
        <label class="f"><span>Urgency <span class="hint">how soon it must be fixed</span></span><select name="urgency" id="urgency">${options([[1, '1 - High (work has stopped)'], [2, '2 - Medium (slowed down)'], [3, '3 - Low (can wait)']], 3)}</select></label>
        <div class="full row"><span class="muted">Calculated priority:</span> <span id="prio"></span></div>
        <label class="f full"><span>Short description <span class="req">*</span></span><input name="shortDescription" required maxlength="160" placeholder="e.g. Inverter beeping and no power in office 2"></label>
        <label class="f full"><span>Description</span><textarea name="description" placeholder="What happened, when it started, any error messages…"></textarea></label>
        <label class="f"><span>Location</span><input name="location" placeholder="Site, floor or room"></label>
        ${isAgent() ? `<label class="f"><span>Assignment group</span><select name="assignmentGroup">${options(m.groups, 'Service Desk')}</select></label>
        <label class="f"><span>Assigned to</span><select name="assignedTo">${options(agents.map((u) => [u.id, u.name]), '', '(unassigned)')}</select></label>` : ''}
        <div class="full row"><button class="btn primary" id="submitBtn">Submit</button><a class="btn" href="#/">Cancel</a></div>
      </form>`);
    const cat = document.getElementById('cat');
    const sub = document.getElementById('subcat');
    const fillSub = () => (sub.innerHTML = options(m.categories[cat.value] || [], '', '— none —'));
    const prio = () => {
      const p = m.priorityMatrix[document.getElementById('impact').value - 1][document.getElementById('urgency').value - 1];
      document.getElementById('prio').innerHTML = `${prioBadge(p)} <span class="hint">target resolution ${m.slaHours[p]}h</span>`;
    };
    cat.onchange = fillSub;
    document.getElementById('impact').onchange = prio;
    document.getElementById('urgency').onchange = prio;
    fillSub();
    prio();
    document.getElementById('newForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      try {
        const t = await api('tickets', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        toast(`${t.number} created`);
        refreshCounts();
        location.hash = `#/ticket/${t.id}`;
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    };
  }

  async function pageTicket(id) {
    const t = await api(`tickets/${encodeURIComponent(id)}`);
    const m = state.meta;
    const users = await ensureUsers();
    const agents = users.filter((u) => u.role !== 'user');
    const agent = isAgent();
    const flow = ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'];
    const stepIdx = flow.indexOf(t.state);
    const statusbar =
      t.state === 'Canceled'
        ? `<div class="statusbar"><div class="step now">Canceled</div></div>`
        : `<div class="statusbar">${flow.map((s, i) => `<div class="step ${i < stepIdx ? 'done' : i === stepIdx ? 'now' : ''}">${s}</div>`).join('')}</div>`;

    const allowed = agent ? m.transitions[t.state] : { New: ['Canceled'], Resolved: ['Closed', 'In Progress'] }[t.state] || [];
    const label = (s) =>
      ({ 'In Progress': t.state === 'Resolved' ? (agent ? 'Reopen' : 'Not fixed, reopen') : 'Start work', 'On Hold': 'Put on hold', Resolved: 'Resolve', Closed: agent ? 'Close' : 'Confirm fixed & close', Canceled: 'Cancel ticket' })[s] || s;
    const actionBtns = allowed
      .map((s) => `<button class="btn ${s === 'Resolved' || (s === 'Closed' && !agent) ? 'primary' : s === 'Canceled' ? 'danger' : ''}" data-state="${esc(s)}">${esc(label(s))}</button>`)
      .join('');
    const readOnly = !agent || ['Closed', 'Canceled'].includes(t.state);
    const dis = readOnly ? 'disabled' : '';

    const vars =
      t.variables && Object.keys(t.variables).length
        ? `<div class="card"><h3>Request details${t.catalogItem ? ` · ${esc(t.catalogItem.name)}` : ''}</h3>${t.catalogItem && t.catalogItem.approvalRequired ? '<p class="hint">⚠️ This item needs manager approval before fulfilment.</p>' : ''}<dl class="vars">${Object.values(t.variables)
            .map((v) => `<dt>${esc(v.label)}</dt><dd>${v.value === true ? 'Yes' : v.value === false ? 'No' : esc(v.value) || '<span class="muted">—</span>'}</dd>`)
            .join('')}</dl></div>`
        : '';

    const feed = [...(t.activity || [])].reverse().map((a) => {
      const who = a.by ? a.by.name : 'System';
      const kind = { worknote: 'Work note', comment: 'Comment', change: 'Updated', system: '' }[a.type];
      return `<li class="${esc(a.type)}"><span class="avatar">${esc(initials(who))}</span><div class="body">
        <div class="meta"><b>${esc(who)}</b> ${kind ? '· ' + kind : ''} · <span title="${esc(fmtDate(a.at))}">${esc(ago(a.at))}</span></div>
        ${a.text ? `<div class="text">${esc(a.text)}</div>` : ''}
        ${a.changes ? `<ul class="changes">${a.changes.map((c) => `<li><b>${esc(c.field)}</b>: ${esc(c.from ?? '(empty)') || '(empty)'} → ${esc(c.to ?? '(empty)') || '(empty)'}</li>`).join('')}</ul>` : ''}
      </div></li>`;
    });

    const details = agent
      ? `<form class="card form" id="editForm">
          <label class="f full"><span>Short description</span><input name="shortDescription" value="${esc(t.shortDescription)}" ${dis}></label>
          <label class="f full"><span>Description</span><textarea name="description" ${dis}>${esc(t.description)}</textarea></label>
          <label class="f"><span>Category</span><select name="category" id="cat" ${dis}>${options(Object.keys(m.categories), t.category)}</select></label>
          <label class="f"><span>Subcategory</span><select name="subcategory" id="subcat" ${dis}></select></label>
          <label class="f"><span>Impact</span><select name="impact" ${dis}>${options(levels, t.impact)}</select></label>
          <label class="f"><span>Urgency</span><select name="urgency" ${dis}>${options(levels, t.urgency)}</select></label>
          <label class="f"><span>Assignment group</span><select name="assignmentGroup" ${dis}>${options(m.groups, t.assignmentGroup)}</select></label>
          <label class="f"><span>Assigned to</span><div class="row" style="flex-wrap:nowrap"><select name="assignedTo" ${dis}>${options(agents.map((u) => [u.id, u.name]), t.assignedTo ? t.assignedTo.id : '', '(unassigned)')}</select>${readOnly ? '' : '<button type="button" class="btn small" id="assignMe">Me</button>'}</div></label>
          <label class="f"><span>Location</span><input name="location" value="${esc(t.location)}" ${dis}></label>
          <label class="f"><span>Contact type</span><select name="contactType" ${dis}>${options(m.contactTypes, t.contactType)}</select></label>
          <label class="f"><span>Resolution code</span><select name="resolutionCode" ${dis}>${options(m.resolutionCodes, t.resolutionCode, '— select —')}</select></label>
          <label class="f full"><span>Resolution notes</span><textarea name="resolutionNotes" ${dis} placeholder="What fixed it? Shown to the caller.">${esc(t.resolutionNotes)}</textarea></label>
          ${readOnly ? '' : '<div class="full row"><button class="btn primary">Save</button></div>'}
        </form>`
      : `<div class="card"><h3>Description</h3><div style="white-space:pre-wrap">${esc(t.description) || '<span class="muted">No description</span>'}</div>
          ${t.resolutionNotes ? `<h3 style="margin-top:16px">Resolution</h3><div class="hint">${esc(t.resolutionCode)}</div><div style="white-space:pre-wrap">${esc(t.resolutionNotes)}</div>` : ''}</div>`;

    shell(`
      <div class="page-head">
        <h1>${esc(t.number)}</h1>${prioBadge(t.priority)} ${stateBadge(t.state)} ${t.slaBreached ? '<span class="badge" style="color:var(--p1)">SLA breached</span>' : ''}
        <div class="actions">${actionBtns}</div>
      </div>
      <h2 style="font-weight:500;margin-top:-6px">${esc(t.shortDescription)}</h2>
      ${statusbar}
      <div class="ticket-grid">
        <div>
          ${vars}
          ${details}
          <div class="card">
            <div class="tabs">${agent ? '<button class="on" data-tab="worknote">Work note (internal)</button><button data-tab="comment">Comment to caller</button>' : '<button class="on" data-tab="comment">Add a comment</button>'}</div>
            <form id="commentForm"><textarea name="text" placeholder="${agent ? 'Only agents can see work notes…' : 'Add more information or ask a question…'}" required></textarea>
            <div class="row" style="margin-top:8px"><button class="btn primary">Post</button></div></form>
          </div>
          <div class="card"><h3>Activity</h3><ul class="feed">${feed.join('') || '<li class="muted">No activity yet</li>'}</ul></div>
        </div>
        <div>
          <div class="card"><dl class="props">
            <dt>Type</dt><dd>${t.type === 'request' ? 'Service request' : 'Incident'}</dd>
            <dt>Caller</dt><dd>${esc(t.caller ? t.caller.name : '')}<div class="hint">${esc(t.caller ? t.caller.email : '')}</div></dd>
            <dt>Opened</dt><dd>${esc(fmtDate(t.createdAt))}${t.openedBy && t.caller && t.openedBy.id !== t.caller.id ? `<div class="hint">by ${esc(t.openedBy.name)}</div>` : ''}</dd>
            <dt>Priority</dt><dd>${prioBadge(t.priority)}</dd>
            <dt>Due</dt><dd>${esc(fmtDate(t.dueAt))}<div>${due(t)}</div></dd>
            <dt>Group</dt><dd>${esc(t.assignmentGroup)}</dd>
            <dt>Assigned to</dt><dd>${t.assignedTo ? esc(t.assignedTo.name) : '<span class="muted">(unassigned)</span>'}</dd>
            <dt>Category</dt><dd>${esc(t.category)}${t.subcategory ? ' / ' + esc(t.subcategory) : ''}</dd>
            ${t.location ? `<dt>Location</dt><dd>${esc(t.location)}</dd>` : ''}
            ${t.resolvedAt ? `<dt>Resolved</dt><dd>${esc(fmtDate(t.resolvedAt))}</dd>` : ''}
            ${t.closedAt ? `<dt>Closed</dt><dd>${esc(fmtDate(t.closedAt))}</dd>` : ''}
          </dl></div>
        </div>
      </div>`);

    let tab = agent ? 'worknote' : 'comment';
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab;
        document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
        document.querySelector('#commentForm textarea').placeholder = tab === 'worknote' ? 'Only agents can see work notes…' : 'The caller will see this comment…';
      };
    });
    document.getElementById('commentForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`tickets/${encodeURIComponent(id)}/comments`, { method: 'POST', body: { text: e.target.text.value, internal: tab === 'worknote' } });
        toast('Posted');
        pageTicket(id);
      } catch (err) {
        toast(err.message, true);
      }
    };

    const editForm = document.getElementById('editForm');
    const formBody = () => (editForm && !readOnly ? Object.fromEntries(new FormData(editForm)) : {});
    if (editForm) {
      const cat = document.getElementById('cat');
      const sub = document.getElementById('subcat');
      const fillSub = (sel) => (sub.innerHTML = options(m.categories[cat.value] || [], sel, '— none —'));
      cat.onchange = () => fillSub('');
      fillSub(t.subcategory);
      const me = document.getElementById('assignMe');
      if (me) me.onclick = () => (editForm.assignedTo.value = state.me.id);
      editForm.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api(`tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: formBody() });
          toast('Saved');
          refreshCounts();
          pageTicket(id);
        } catch (err) {
          toast(err.message, true);
        }
      };
    }
    document.querySelectorAll('[data-state]').forEach((b) => {
      b.onclick = async () => {
        const next = b.dataset.state;
        if (next === 'Canceled' && !confirmInline(b, 'Click again to cancel')) return;
        try {
          await api(`tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...formBody(), state: next } });
          toast(`${t.number} → ${next}`);
          refreshCounts();
          pageTicket(id);
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  }

  // Two-click confirm without a browser dialog.
  function confirmInline(btn, text) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = old;
    }, 3000);
    return false;
  }

  async function loadCatalog(all) {
    return (await api(`catalog${all ? '?all=1' : ''}`)).items;
  }

  async function pageCatalog(hashQuery) {
    const items = await loadCatalog();
    const cat = new URLSearchParams(hashQuery || '').get('c') || '';
    const cats = [...new Set(items.map((i) => i.category))];
    const shown = cat ? items.filter((i) => i.category === cat) : items;
    shell(`
      <div class="page-head"><h1>Service catalog</h1><span class="muted">Order hardware, software, access and services</span>
        ${isAdmin() ? '<div class="actions"><a class="btn" href="#/admin/catalog">🧰 Manage items</a></div>' : ''}</div>
      <div class="chips"><a class="chip ${!cat ? 'on' : ''}" href="#/catalog">All</a>${cats.map((c) => `<a class="chip ${c === cat ? 'on' : ''}" href="#/catalog?c=${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>
      <div class="cat-grid">${shown
        .map(
          (i) => `<a class="card cat-item" href="#/catalog/${esc(i.id)}"><div class="icon">${esc(i.icon)}</div><h3>${esc(i.name)}</h3><p>${esc(i.description)}</p>
          <div class="foot"><span>${esc(i.category)}</span><span>~${i.deliveryDays} day${i.deliveryDays === 1 ? '' : 's'}</span></div></a>`
        )
        .join('') || '<div class="empty">No catalog items yet</div>'}</div>`);
  }

  function fieldInput(f) {
    const req = f.required ? 'required' : '';
    const n = `v_${esc(f.name)}`;
    if (f.type === 'textarea') return `<textarea name="${n}" ${req}></textarea>`;
    if (f.type === 'select') return `<select name="${n}" ${req}>${options(f.options, '', '— select —')}</select>`;
    if (f.type === 'checkbox') return `<input type="checkbox" name="${n}" value="1">`;
    return `<input type="${f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}" name="${n}" ${req}>`;
  }

  async function pageOrder(id) {
    const items = await loadCatalog();
    const item = items.find((i) => i.id === id);
    if (!item) return notFound();
    shell(`
      <div class="page-head"><a href="#/catalog" class="btn small">← Catalog</a></div>
      <div class="ticket-grid">
        <form class="card form" id="orderForm">
          <div class="full row"><div class="cat-item"><div class="icon">${esc(item.icon)}</div></div><div><h1 style="margin:0">${esc(item.name)}</h1><div class="muted">${esc(item.description)}</div></div></div>
          ${(item.fields || [])
            .map((f) => `<label class="f ${f.type === 'textarea' ? 'full' : ''}"><span>${esc(f.label)} ${f.required ? '<span class="req">*</span>' : ''}</span>${fieldInput(f)}</label>`)
            .join('')}
          <label class="f"><span>Urgency</span><select name="urgency">${options([[3, 'Normal'], [2, 'Urgent']], 3)}</select></label>
          <label class="f full"><span>Additional notes</span><textarea name="notes"></textarea></label>
          <div class="full row"><button class="btn primary" id="orderBtn">Submit request</button></div>
        </form>
        <div class="card"><dl class="props">
          <dt>Category</dt><dd>${esc(item.category)}</dd>
          <dt>Delivery</dt><dd>About ${item.deliveryDays} business day${item.deliveryDays === 1 ? '' : 's'}</dd>
          <dt>Fulfilled by</dt><dd>${esc(item.fulfillmentGroup)}</dd>
          <dt>Approval</dt><dd>${item.approvalRequired ? 'Manager approval needed' : 'Not needed'}</dd>
        </dl></div>
      </div>`);
    document.getElementById('orderForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const variables = {};
      (item.fields || []).forEach((f) => (variables[f.name] = f.type === 'checkbox' ? fd.has(`v_${f.name}`) : fd.get(`v_${f.name}`) || ''));
      const btn = document.getElementById('orderBtn');
      btn.disabled = true;
      try {
        const t = await api(`catalog/${encodeURIComponent(id)}/order`, { method: 'POST', body: { variables, notes: fd.get('notes'), urgency: fd.get('urgency') } });
        toast(`${t.number} submitted`);
        refreshCounts();
        location.hash = `#/ticket/${t.id}`;
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    };
  }

  async function pageAdminCatalog() {
    if (!isAdmin()) return notFound();
    const items = await loadCatalog(true);
    shell(`
      <div class="page-head"><h1>Catalog items</h1><div class="actions"><a class="btn primary" href="#/admin/catalog/new">➕ New item</a></div></div>
      <div class="card table-wrap"><table><thead><tr><th></th><th>Name</th><th>Category</th><th>Fulfilment group</th><th>Delivery</th><th>Active</th></tr></thead><tbody>
      ${items
        .map(
          (i) => `<tr class="click" data-href="#/admin/catalog/${esc(i.id)}"><td>${esc(i.icon)}</td><td><a href="#/admin/catalog/${esc(i.id)}">${esc(i.name)}</a></td><td>${esc(i.category)}</td><td>${esc(i.fulfillmentGroup)}</td><td>${i.deliveryDays}d</td><td>${i.active === false ? 'No' : 'Yes'}</td></tr>`
        )
        .join('')}</tbody></table></div>`);
    bindRows();
  }

  async function pageAdminCatalogEdit(id) {
    if (!isAdmin()) return notFound();
    const isNew = id === 'new';
    const item = isNew
      ? { name: '', category: 'General', icon: '📦', description: '', fulfillmentGroup: 'Service Desk', deliveryDays: 2, approvalRequired: false, active: true, fields: [] }
      : (await loadCatalog(true)).find((i) => i.id === id);
    if (!item) return notFound();
    const fieldRow = (f = { name: '', label: '', type: 'text', required: false, options: [] }) => `
      <div class="field-row">
        <input data-k="label" placeholder="Label" value="${esc(f.label)}">
        <input data-k="name" placeholder="key" value="${esc(f.name)}">
        <select data-k="type">${options(['text', 'textarea', 'select', 'date', 'number', 'checkbox'], f.type)}</select>
        <input data-k="options" placeholder="Options, comma separated" value="${esc((f.options || []).join(', '))}">
        <label class="row"><input type="checkbox" data-k="required" ${f.required ? 'checked' : ''}> Req.</label>
        <button type="button" class="btn small danger" data-remove>✕</button>
      </div>`;
    shell(`
      <div class="page-head"><a href="#/admin/catalog" class="btn small">← Catalog items</a><h1>${isNew ? 'New catalog item' : esc(item.name)}</h1></div>
      <form class="card form" id="catForm">
        <label class="f"><span>Name <span class="req">*</span></span><input name="name" value="${esc(item.name)}" required></label>
        <label class="f"><span>Category</span><input name="category" value="${esc(item.category)}"></label>
        <label class="f"><span>Icon (emoji)</span><input name="icon" value="${esc(item.icon)}" maxlength="8"></label>
        <label class="f"><span>Fulfilment group</span><select name="fulfillmentGroup">${options(state.meta.groups, item.fulfillmentGroup)}</select></label>
        <label class="f"><span>Delivery time (days)</span><input name="deliveryDays" type="number" min="0" max="90" value="${item.deliveryDays}"></label>
        <div class="f row" style="align-self:end"><label class="row"><input type="checkbox" name="approvalRequired" ${item.approvalRequired ? 'checked' : ''}> Needs approval</label><label class="row"><input type="checkbox" name="active" ${item.active !== false ? 'checked' : ''}> Active</label></div>
        <label class="f full"><span>Description</span><textarea name="description">${esc(item.description)}</textarea></label>
        <div class="full"><h3>Questions on the order form</h3><div id="fields">${(item.fields || []).map(fieldRow).join('')}</div>
          <button type="button" class="btn small" id="addField">➕ Add question</button></div>
        <div class="full row"><button class="btn primary">Save</button>${isNew ? '' : '<span class="spacer"></span><button type="button" class="btn danger" id="delBtn">Delete item</button>'}</div>
      </form>`);
    const fields = document.getElementById('fields');
    fields.onclick = (e) => e.target.matches('[data-remove]') && e.target.closest('.field-row').remove();
    document.getElementById('addField').onclick = () => fields.insertAdjacentHTML('beforeend', fieldRow());
    const del = document.getElementById('delBtn');
    if (del)
      del.onclick = async () => {
        if (!confirmInline(del, 'Click again to delete')) return;
        await api(`catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('Deleted');
        location.hash = '#/admin/catalog';
      };
    document.getElementById('catForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        name: f.name.value,
        category: f.category.value,
        icon: f.icon.value,
        description: f.description.value,
        fulfillmentGroup: f.fulfillmentGroup.value,
        deliveryDays: Number(f.deliveryDays.value),
        approvalRequired: f.approvalRequired.checked,
        active: f.active.checked,
        fields: [...fields.querySelectorAll('.field-row')].map((r) => {
          const g = (k) => r.querySelector(`[data-k="${k}"]`);
          const label = g('label').value.trim();
          return {
            label,
            name: g('name').value.trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
            type: g('type').value,
            required: g('required').checked,
            options: g('options').value.split(',').map((s) => s.trim()).filter(Boolean),
          };
        }).filter((x) => x.label),
      };
      try {
        await api(isNew ? 'catalog' : `catalog/${encodeURIComponent(id)}`, { method: isNew ? 'POST' : 'PUT', body });
        toast('Saved');
        location.hash = '#/admin/catalog';
      } catch (err) {
        toast(err.message, true);
      }
    };
  }

  async function pageUsers() {
    if (!isAdmin()) return notFound();
    state.users = null;
    const users = await ensureUsers();
    shell(`
      <div class="page-head"><h1>Users & roles</h1></div>
      <div class="card">
        <p class="hint">People appear here after they first sign in. <b>User</b> can raise and track their own tickets. <b>Agent</b> works the queue. <b>Admin</b> also manages the catalog and roles.</p>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Sign-in</th><th>Last seen</th><th>Role</th></tr></thead><tbody>
        ${users
          .map(
            (u) => `<tr><td><div class="row"><span class="avatar">${esc(initials(u.name))}</span>${esc(u.name)}</div></td><td>${esc(u.email)}</td><td>${esc(u.provider)}</td><td>${esc(ago(u.lastSeen))}</td>
            <td><select data-user="${esc(u.id)}" ${u.id === state.me.id ? 'disabled' : ''}>${options([['user', 'User'], ['agent', 'Agent'], ['admin', 'Admin']], u.role)}</select></td></tr>`
          )
          .join('')}</tbody></table></div>
      </div>`);
    document.querySelectorAll('[data-user]').forEach((s) => {
      s.onchange = async () => {
        try {
          await api(`users/${encodeURIComponent(s.dataset.user)}`, { method: 'PATCH', body: { role: s.value } });
          state.users = null;
          toast('Role updated');
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  }

  function notFound() {
    shell(`<div class="card empty"><h2>Page not found</h2><a href="#/">Back to the dashboard</a></div>`);
  }

  // ---------- router ----------
  async function route() {
    const hash = location.hash || '#/';
    const [pathPart, query] = hash.slice(1).split('?');
    const parts = pathPart.split('/').filter(Boolean);
    try {
      if (!parts.length) return await pageDashboard();
      const [a, b] = parts;
      if (['incidents', 'requests', 'queue', 'unassigned', 'breached', 'my'].includes(a)) return await pageList(a, query);
      if (a === 'new') return await pageNew();
      if (a === 'ticket' && b) return await pageTicket(decodeURIComponent(b));
      if (a === 'catalog' && b) return await pageOrder(decodeURIComponent(b));
      if (a === 'catalog') return await pageCatalog(query);
      if (a === 'admin' && b === 'catalog' && parts[2]) return await pageAdminCatalogEdit(decodeURIComponent(parts[2]));
      if (a === 'admin' && b === 'catalog') return await pageAdminCatalog();
      if (a === 'admin' && b === 'users') return await pageUsers();
      notFound();
    } catch (err) {
      if (err.message === 'Please sign in') return;
      shell(`<div class="card empty"><h2>Couldn't load this page</h2><p>${esc(err.message)}</p><a href="#/">Back to the dashboard</a></div>`);
    }
  }

  async function boot() {
    try {
      const [{ user }, meta] = await Promise.all([api('me'), api('meta')]);
      state.me = user;
      state.meta = meta;
    } catch (err) {
      if (err.message !== 'Please sign in') $app.innerHTML = `<div class="boot">Couldn't reach the service desk API: ${esc(err.message)}</div>`;
      return;
    }
    await refreshCounts();
    window.addEventListener('hashchange', () => {
      window.scrollTo(0, 0);
      route();
    });
    route();
  }

  boot();
})();
