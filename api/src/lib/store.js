// Data store. Picks, in this order:
//   0. Azure Table Storage when AZURE_TABLES_CONNECTION_STRING is set
//   1. Supabase (free Postgres) when SUPABASE_URL and SUPABASE_SERVICE_KEY are set
//   2. Azure Cosmos DB (free tier) when COSMOS_CONNECTION_STRING is set
//   3. a local JSON file (development only)
//
// Every record lives in ONE container, partitioned by /id, with a `kind` field:
//   incident | request | catalog | user | counter
const fs = require('fs');
const path = require('path');

let impl;

function cosmosStore() {
  const { CosmosClient } = require('@azure/cosmos');
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  const dbName = process.env.COSMOS_DATABASE || 'itms';
  const containerName = process.env.COSMOS_CONTAINER || 'records';
  let containerPromise;

  function container() {
    if (!containerPromise) {
      containerPromise = (async () => {
        // Shared database throughput of 400 RU/s stays inside the 1000 RU/s free tier.
        const { database } = await client.databases.createIfNotExists({ id: dbName, throughput: 400 });
        const { container } = await database.containers.createIfNotExists({
          id: containerName,
          partitionKey: { paths: ['/id'] },
        });
        return container;
      })().catch((e) => {
        containerPromise = null;
        throw e;
      });
    }
    return containerPromise;
  }

  return {
    async get(id) {
      const c = await container();
      try {
        const { resource } = await c.item(id, id).read();
        return resource || null;
      } catch (e) {
        if (e.code === 404) return null;
        throw e;
      }
    },
    async list(kind) {
      const c = await container();
      const { resources } = await c.items
        .query({ query: 'SELECT * FROM c WHERE c.kind = @kind', parameters: [{ name: '@kind', value: kind }] })
        .fetchAll();
      return resources;
    },
    async upsert(doc) {
      const c = await container();
      const { resource } = await c.items.upsert(doc);
      return resource;
    },
    async remove(id) {
      const c = await container();
      try {
        await c.item(id, id).delete();
      } catch (e) {
        if (e.code !== 404) throw e;
      }
    },
    async nextNumber(prefix) {
      const c = await container();
      const id = `counter-${prefix}`;
      for (let attempt = 0; attempt < 10; attempt++) {
        let doc = null;
        try {
          ({ resource: doc } = await c.item(id, id).read());
        } catch (e) {
          if (e.code !== 404) throw e;
        }
        if (!doc) {
          try {
            await c.items.create({ id, kind: 'counter', value: 1001 });
            return 1001;
          } catch (e) {
            if (e.code === 409) continue;
            throw e;
          }
        }
        const value = doc.value + 1;
        try {
          await c.item(id, id).replace(
            { ...doc, value },
            { accessCondition: { type: 'IfMatch', condition: doc._etag } }
          );
          return value;
        } catch (e) {
          if (e.code === 412) continue; // someone else incremented first, retry
          throw e;
        }
      }
      throw new Error('Could not allocate a ticket number, please retry');
    },
  };
}

// Supabase: one table `records (id text pk, kind text, doc jsonb)`, created by db/supabase-setup.sql.
// Talks to Supabase's REST API with the server-side secret key, so no extra npm packages are needed.
function supabaseStore() {
  let url = process.env.SUPABASE_URL.trim().replace(/\/+$/, '');
  // Accept a bare project ref ("abcdefghijklmnopqrst") or a host without https://.
  if (!/^https?:\/\//i.test(url)) url = `https://${url.includes('.') ? url : `${url.toLowerCase()}.supabase.co`}`;
  const base = url.replace(/\/rest\/v1$/, '') + '/rest/v1';
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // legacy service_role JWT

  async function call(path, opts = {}) {
    const res = await fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  const enc = encodeURIComponent;
  return {
    async get(id) {
      const rows = await call(`/records?id=eq.${enc(id)}&select=doc`);
      return rows.length ? rows[0].doc : null;
    },
    async list(kind) {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const rows = await call(`/records?kind=eq.${enc(kind)}&select=doc&order=id&limit=1000&offset=${offset}`);
        rows.forEach((r) => out.push(r.doc));
        if (rows.length < 1000) return out;
      }
    },
    async upsert(doc) {
      await call('/records?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: doc.id, kind: doc.kind, doc }),
      });
      return doc;
    },
    async remove(id) {
      await call(`/records?id=eq.${enc(id)}`, { method: 'DELETE' });
    },
    async nextNumber(prefix) {
      return Number(await call('/rpc/next_number', { method: 'POST', body: JSON.stringify({ p_prefix: prefix }) }));
    },
  };
}

// Azure Table Storage: table `itmsrecords`, PartitionKey = kind, RowKey = id.
// Documents are stored as JSON split across doc0..docN string properties (64 KB limit each).
function tableStore() {
  const { TableClient } = require('@azure/data-tables');
  const client = TableClient.fromConnectionString(
    process.env.AZURE_TABLES_CONNECTION_STRING,
    process.env.AZURE_TABLE_NAME || 'itmsrecords'
  );
  let ready;
  const ensure = () => (ready = ready || client.createTable().catch((e) => { ready = null; throw e; }));
  const CHUNK = 30000; // characters per property, safely under the 64 KB (UTF-16) limit
  const kindOf = (id) =>
    id.startsWith('INC') ? 'incident' : id.startsWith('REQ') ? 'request' : id.startsWith('cat-') ? 'catalog'
      : id.startsWith('user-') ? 'user' : id.startsWith('counter-') ? 'counter' : 'other';
  const pack = (doc) => {
    const json = JSON.stringify(doc);
    const e = { partitionKey: doc.kind || kindOf(doc.id), rowKey: doc.id, parts: Math.ceil(json.length / CHUNK) || 1 };
    for (let i = 0; i < e.parts; i++) e[`doc${i}`] = json.slice(i * CHUNK, (i + 1) * CHUNK);
    return e;
  };
  const unpack = (e) => {
    let json = '';
    for (let i = 0; i < (e.parts || 1); i++) json += e[`doc${i}`] || '';
    return JSON.parse(json);
  };
  const notFound = (e) => e.statusCode === 404;
  return {
    async get(id) {
      await ensure();
      try {
        return unpack(await client.getEntity(kindOf(id), id));
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async list(kind) {
      await ensure();
      const out = [];
      const safe = String(kind).replace(/'/g, "''");
      for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${safe}'` } })) out.push(unpack(e));
      return out;
    },
    async upsert(doc) {
      await ensure();
      if (doc.kind && doc.kind !== kindOf(doc.id)) throw new Error(`id ${doc.id} does not match kind ${doc.kind}`);
      await client.upsertEntity(pack(doc), 'Replace');
      return doc;
    },
    async remove(id) {
      await ensure();
      try {
        await client.deleteEntity(kindOf(id), id);
      } catch (e) {
        if (!notFound(e)) throw e;
      }
    },
    async nextNumber(prefix) {
      await ensure();
      const id = `counter-${prefix}`;
      for (let attempt = 0; attempt < 10; attempt++) {
        let e = null;
        try {
          e = await client.getEntity('counter', id);
        } catch (err) {
          if (!notFound(err)) throw err;
        }
        if (!e) {
          try {
            await client.createEntity({ partitionKey: 'counter', rowKey: id, value: 1001 });
            return 1001;
          } catch (err) {
            if (err.statusCode === 409) continue;
            throw err;
          }
        }
        const value = Number(e.value) + 1;
        try {
          await client.updateEntity({ partitionKey: 'counter', rowKey: id, value }, 'Replace', { etag: e.etag });
          return value;
        } catch (err) {
          if (err.statusCode === 412) continue;
          throw err;
        }
      }
      throw new Error('Could not allocate a ticket number, please retry');
    },
  };
}

function fileStore() {
  const file = process.env.LOCAL_DATA_FILE || path.join(__dirname, '..', '..', 'data', 'local-db.json');
  let data = null;
  function load() {
    if (data) return data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      data = {};
    }
    return data;
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
  return {
    async get(id) {
      return clone(load()[id]);
    },
    async list(kind) {
      return Object.values(load()).filter((d) => d.kind === kind).map(clone);
    },
    async upsert(doc) {
      load()[doc.id] = clone(doc);
      save();
      return clone(doc);
    },
    async remove(id) {
      delete load()[id];
      save();
    },
    async nextNumber(prefix) {
      const id = `counter-${prefix}`;
      const d = load();
      const value = d[id] ? d[id].value + 1 : 1001;
      d[id] = { id, kind: 'counter', value };
      save();
      return value;
    },
  };
}

function store() {
  if (!impl) {
    if (process.env.AZURE_TABLES_CONNECTION_STRING) impl = tableStore();
    else if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) impl = supabaseStore();
    else if (process.env.COSMOS_CONNECTION_STRING) impl = cosmosStore();
    else impl = fileStore();
  }
  return impl;
}

module.exports = { store };
