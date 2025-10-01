/* Command integration tester

This script dynamically imports every command module in src/commands and runs
its `execute(context, message, args)` function with a mocked context and
message. It tries to exercise the command but avoids making external network
calls or writing to real channels. Use this locally to smoke-test commands.

Run with: node tests/run_all_commands.js
*/
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const commandsDir = path.join(process.cwd(),'src','commands');
if (!fs.existsSync(commandsDir)) { console.error('commands dir not found:', commandsDir); process.exit(1); }

const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));

const results = [];

function makeMockContext() {
  // Minimal safe context used by most commands
  // Provide realistic stubs and stores that command modules expect
  class MockEmbed {
    constructor() { this._fields = []; this._title = ''; this._color = null; this._desc = ''; }
    setTitle(t) { this._title = t; return this; }
    setDescription(d) { this._desc = d; return this; }
    addFields(...f) { this._fields.push(...f.flat()); return this; }
    addField(name, value, inline) { this._fields.push({ name, value, inline }); return this; }
    setColor(c) { this._color = c; return this; }
    setTimestamp() { return this; }
  }

  return {
    client: { user: { id: 'BOT' }, guilds: { cache: new Map() }, users: { fetch: async (id)=> ({ id, username: 'MockUser', discriminator: '0000', displayAvatarURL: ()=>null }) } },
    EmbedBuilder: MockEmbed,
    PermissionFlagsBits: {},
    ChannelType: { GuildText: 0 },
    getOpenAIResponse: async (p) => '[mock-openai-response] ' + (p||'').slice(0,60),
    validateModel: async () => ({ ok: true, duration: 10, sample: 'hi' }),
    adminLog: async () => {},
    storage: {
      load: async (k, d) => d,
      save: async (k,v) => {}
    },
    saveHabits: async () => {},
    saveWeekly: async () => {},
    saveMessageCounts: async () => {},
    savePartnerQueue: async () => {},
    awardAchievement: async () => false,
    messageCounts: {},
    achievementsStore: {},
    habitTracker: {},
    fitnessWeekly: {},
    partnerQueue: []
  };
}

function makeMockMessage() {
  const channel = {
    id: 'CHAN',
    send: async (payload) => ({ id: 'MSG', pin: async () => {}, edit: async () => {} }),
    messages: { fetchPins: async () => [] }
  };
  const user = { id: 'USER', username: 'tester' };
  return {
    author: user,
    member: { roles: { cache: new Map() } },
    guild: { id: 'GUILD', channels: { cache: { find: () => channel } }, systemChannel: channel },
    channel,
    content: '',
    reply: async (payload) => ({ id: 'REPLY' }),
    react: async () => {},
    mentions: { users: { first: () => null, size: 0, map: ()=>[] } }
  };
}

(async function(){
  for (const f of files) {
    const p = path.join(commandsDir, f);
    try {
      const mod = await import(pathToFileURL(p).href);
      const def = mod.default;
      if (!def || typeof def.execute !== 'function') { results.push({ file: f, ok: false, reason: 'no default export or execute fn' }); continue; }

      const ctx = makeMockContext();
      const msg = makeMockMessage();
      const args = ['test'];

      try {
        await def.execute(ctx, msg, args);
        results.push({ file: f, ok: true });
      } catch (e) {
        results.push({ file: f, ok: false, reason: String(e).slice(0,200) });
      }
    } catch (e) {
      results.push({ file: f, ok: false, reason: 'import failed: '+String(e).slice(0,200) });
    }
  }

  console.log('Command test results:');
  results.forEach(r => console.log(r.ok ? 'PASS ' : 'FAIL ', r.file, r.reason || ''));
  const failed = results.filter(r => !r.ok);
  console.log('\nSummary: %d total, %d passed, %d failed', results.length, results.length - failed.length, failed.length);
  if (failed.length) process.exit(2); else process.exit(0);
})();
