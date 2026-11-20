// Data store. Uses Azure Cosmos DB (free tier) when COSMOS_CONNECTION_STRING is set,
// otherwise a local JSON file (for development only).
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
  if (!impl) impl = process.env.COSMOS_CONNECTION_STRING ? cosmosStore() : fileStore();
  return impl;
}

module.exports = { store };
