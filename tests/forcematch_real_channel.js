import { pathToFileURL } from 'url';
import path from 'path';

async function loadCmd(name) {
  const p = path.join(process.cwd(),'src','commands', name + '.js');
  const mod = await import(pathToFileURL(p).href);
  return mod.default;
}

class MockChannel {
  constructor(id){ this.id = id; this.name = 'partner-mock'; this.permissionOverwrites = { edit: async ()=>{}, create: async ()=>{} }; this.guild = null; }
  async send(t){ this._last = t; return { pin: async ()=>{} }; }
  async delete(){ this._deleted = true; }
}

class MockGuild {
  constructor(){ this.channels = { create: async (name, opts)=> { const c = new MockChannel('realch_'+name); c.guild = this; this._created = c; if (!this.channels.cache) this.channels.cache = new Map(); this.channels.cache.set(c.id, c); return c; } }; this.roles = { everyone: { id: 'everyone' } }; }
}

(async function(){
  const fm = await loadCmd('forcematch');
  const up = await loadCmd('unpair');

  const guild = new MockGuild();
  const context = { partners: {}, partnerQueue: ['X','Y'], client: { users: { fetch: async (id)=> ({ id, send: async ()=>{} }) } } };
  const message = { author: { id: 'ADMIN' }, guild, member: { roles: { cache: new Map() } }, reply: async (r)=>{ console.log('reply:', r); return r; } };

  await fm.execute(context, message, ['X','Y']);
  const keys = Object.keys(context.partners);
  if (keys.length !== 1) { console.error('expected 1 partner record, got', keys.length); process.exit(2); }

  const recKey = keys[0];
  // Now unpair by channel id
  await up.execute(context, message, [recKey]);
  if (Object.keys(context.partners).length !== 0) { console.error('expected 0 partners after unpair'); process.exit(2); }
  console.log('forcematch real-channel test passed');
  process.exit(0);
})();
