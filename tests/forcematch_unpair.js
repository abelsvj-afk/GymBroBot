import { pathToFileURL } from 'url';
import path from 'path';

async function loadCmd(name) {
  const p = path.join(process.cwd(),'src','commands', name + '.js');
  const mod = await import(pathToFileURL(p).href);
  return mod.default;
}

(async function(){
  const fm = await loadCmd('forcematch');
  const up = await loadCmd('unpair');

  const context = { partners: {}, partnerQueue: ['A','B','C'], savePartnersCalled: false, savePartnerQueueCalled: false,
    savePartners: async ()=>{ context.savePartnersCalled = true }, savePartnerQueue: async ()=>{ context.savePartnerQueueCalled = true }
  };

  const message = { author: { id: 'ADMIN' }, guild: null, reply: async (r)=>{ console.log('reply:', r); return r; }, member: { roles: { cache: new Map() } } };

  await fm.execute(context, message, ['A','B']);
  if (!context.partners) { console.error('partners missing'); process.exit(2); }
  const keys = Object.keys(context.partners);
  if (keys.length !== 1) { console.error('expected 1 partner record, got', keys.length); process.exit(2); }
  if (!context.savePartnersCalled) { console.error('savePartners not called'); process.exit(2); }

  // Now unpair by user id
  await up.execute(context, message, ['A']);
  if (Object.keys(context.partners).length !== 0) { console.error('expected 0 partners after unpair'); process.exit(2); }

  console.log('forcematch/unpair smoke test passed');
  process.exit(0);
})();
