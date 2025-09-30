import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

export default class Storage {
  constructor(mongoUri, dataDir = './data') {
    this.mongoUri = mongoUri;
    this.dataDir = dataDir;
    this.mongoClient = null;
    this.mongoDb = null;
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  async connect() {
    if (!this.mongoUri) return false;
    try {
      this.mongoClient = new MongoClient(this.mongoUri);
      await this.mongoClient.connect();
      this.mongoDb = this.mongoClient.db();
      console.log('[Storage] Connected to MongoDB');
      return true;
    } catch (e) {
      console.error('[Storage] Mongo connection failed:', e);
      this.mongoClient = null; this.mongoDb = null;
      return false;
    }
  }

  // Save a named object. If Mongo is available, use a collection with a single doc {_id: '__DATA'}
  async save(key, obj) {
    try {
      if (this.mongoDb) {
        const col = this.mongoDb.collection(key);
        await col.updateOne({ _id: '__DATA' }, { $set: { data: obj, ts: new Date() } }, { upsert: true });
        return true;
      }
      const file = path.join(this.dataDir, `${key}.json`);
      fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
      return true;
    } catch (e) { console.error(`[Storage] save ${key} failed:`, e); return false; }
  }

  // Load a named object, returning fallback if not present
  async load(key, fallback) {
    try {
      if (this.mongoDb) {
        const col = this.mongoDb.collection(key);
        const doc = await col.findOne({ _id: '__DATA' });
        if (doc && typeof doc.data !== 'undefined') return doc.data;
        return fallback;
      }
      const file = path.join(this.dataDir, `${key}.json`);
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
      return fallback;
    } catch (e) { console.error(`[Storage] load ${key} failed:`, e); return fallback; }
  }

  // Simple ping check
  async ping() {
    if (this.mongoDb) {
      try { await this.mongoDb.command({ ping: 1 }); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
    }
    // file-system always 'ok' if writable
    try { const test = path.join(this.dataDir, '__test_write'); fs.writeFileSync(test, 'x'); fs.unlinkSync(test); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
  }
}
