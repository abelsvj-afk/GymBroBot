import { EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import os from 'os';

async function runHealthCheck(context, guild) {
  const { storage, validateModel, client, aiHealth } = context;
  const results = [];

  // Quick syntax check for key files so the bot can report basic code issues automatically
  try {
    const { exec } = await import('child_process');
    const execAsync = (cmd) => new Promise((resolve) => {
      exec(cmd, { cwd: process.cwd(), timeout: 7000 }, (err, stdout, stderr) => {
        resolve({ err, stdout: stdout?.toString(), stderr: stderr?.toString() });
      });
    });

    const filesToCheck = ['bot.js', 'src/bot.js', 'src/commands/health.js'];
    const syntaxProblems = [];
    for (const f of filesToCheck) {
      const p = `${process.cwd().replace(/\\/g, '/')}/${f}`;
      // Windows path quoting
      const cmd = `node --check "${p.replace(/"/g,'\"')}"`;
      const res = await execAsync(cmd);
      if (res.err) {
        const msg = (res.stderr || res.stdout || String(res.err)).split('\n').slice(0,6).join('\n');
        syntaxProblems.push({ file: f, error: msg });
      }
    }

    if (syntaxProblems.length) {
      results.push({ key: 'syntax', name: 'Code Syntax', ok: false, note: syntaxProblems.map(s=>`${s.file}: ${s.error.split('\n')[0]}`).join('\n') });
    } else {
      results.push({ key: 'syntax', name: 'Code Syntax', ok: true, note: 'No parse errors detected' });
    }
  } catch (e) {
    results.push({ key: 'syntax', name: 'Code Syntax', ok: false, note: 'Failed to run syntax checks: ' + String(e) });
  }

  // Storage ping
  try {
    const ping = await storage.ping();
    results.push({ key: 'storage', name: 'Storage', ok: !!ping.ok, note: ping.error || 'Filesystem or Mongo reachable' });
  } catch (e) { results.push({ key: 'storage', name: 'Storage', ok: false, note: String(e) }); }

  // Node engine compatibility (check package.json engines)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const engine = pkg.engines && pkg.engines.node;
    const nodeOk = !engine || (engine && process.version && process.version.startsWith(engine.replace('x','')));
    results.push({ key: 'node', name: 'Node Engine', ok: !!nodeOk, note: engine ? `Required: ${engine}, Running: ${process.version}` : 'No engine specified' });
  } catch (e) { results.push({ key: 'node', name: 'Node Engine', ok: false, note: String(e) }); }

  // package.json deps sanity (installed node_modules presence)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    const missing = [];
    for (const d of deps) { if (!fs.existsSync(path.join(process.cwd(), 'node_modules', d))) missing.push(d); }
    results.push({ key: 'deps', name: 'Dependencies', ok: missing.length === 0, note: missing.length ? 'Missing: ' + missing.slice(0,5).join(', ') : 'All deps installed' });
  } catch (e) { results.push({ key: 'deps', name: 'Dependencies', ok: false, note: String(e) }); }

  // Disk space check (simple - free bytes on cwd drive)
  try {
    const diskFree = os.freemem(); // approximate using free memory as proxy (Windows limitation)
    results.push({ key: 'disk', name: 'Free Memory (proxy)', ok: diskFree > 50 * 1024 * 1024, note: `${Math.round(diskFree/1024/1024)} MB free` });
  } catch (e) { results.push({ key: 'disk', name: 'Disk/Memory', ok: false, note: String(e) }); }

  // OpenAI model validation
  try {
    const res = await validateModel(process.env.OPENAI_MODEL || 'gpt-3.5-turbo', 5000);
    results.push({ key: 'openai', name: 'OpenAI', ok: res.ok, note: res.ok ? `${res.duration}ms` : res.error });
  } catch (e) { results.push({ key: 'openai', name: 'OpenAI', ok: false, note: String(e) }); }

  // Scheduler / client readiness
  try {
    const ready = !!(client && client.user && client.guilds.cache.size >= 0);
    results.push({ key: 'scheduler', name: 'Scheduler', ok: ready, note: ready ? `Guilds: ${client.guilds.cache.size}` : 'Client not ready' });
  } catch (e) { results.push({ key: 'scheduler', name: 'Scheduler', ok: false, note: String(e) }); }

  // Mongo detailed check
  try {
    const mongoOk = !!(storage && storage.mongoDb);
    results.push({ key: 'mongo', name: 'MongoDB', ok: mongoOk, note: mongoOk ? 'Connected' : 'Not connected' });
  } catch (e) { results.push({ key: 'mongo', name: 'MongoDB', ok: false, note: String(e) }); }

  // Storage read/write test
  try {
    const testKey = '__health_test_rw';
    await storage.save(testKey, { ts: Date.now() });
    const back = await storage.load(testKey, null);
    results.push({ key: 'rw', name: 'Storage RW', ok: !!back, note: back ? 'OK' : 'Readback failed' });
  } catch (e) { results.push({ key: 'rw', name: 'Storage RW', ok: false, note: String(e) }); }

  // Recent AI errors summary
  try {
    const lastErrors = (aiHealth || []).slice(-10).reverse().filter(e=>e.ok===false).slice(0,3).map(e=>`${new Date(e.ts).toLocaleString()}: ${e.error||e.type}`);
    results.push({ key: 'errors', name: 'Recent AI Errors', ok: lastErrors.length===0, note: lastErrors.length ? lastErrors.join('\n') : 'No recent errors' });
  } catch (e) { results.push({ key: 'errors', name: 'Recent AI Errors', ok: false, note: String(e) }); }

    // Commands health: run a quick simulated check of each command's execute() to ensure they don't crash
    try {
      const cmdCheck = await runCommandChecks(context, guild, { simulated: true, timeoutMs: 8000 });
      const pass = cmdCheck.passed;
      const total = cmdCheck.total;
      const pct = total ? Math.round((pass / total) * 100) : 0;
      results.push({ key: 'commands', name: 'Commands', ok: pct >= 80, note: `${pass}/${total} commands ran successfully (${pct}%)` });
    } catch (e) {
      results.push({ key: 'commands', name: 'Commands', ok: false, note: String(e) });
    }

  // Build embed
  const worst = results.find(r=>!r.ok) ? 'bad' : 'good';
  const colors = { good: 0x2ECC71, warn: 0xF1C40F, bad: 0xE74C3C };
  const embed = new EmbedBuilder()
    .setTitle('🤖 GymBotBro — Health Scan')
    .setTimestamp(new Date())
    .setFooter({ text: 'Automated health scan — updates every 5 minutes' });

  // Determine overall color (if any check failed -> red; if some warnings -> yellow; else green)
  const anyFail = results.some(r=>!r.ok);
  const color = anyFail ? colors.bad : colors.good;
  embed.setColor(color);

  // Add fields with emoji status and helpful debug hints
  for (const r of results) {
    const statusEmoji = r.ok ? '🟢' : '🔴';
    let hint = '';
    if (!r.ok) {
      switch (r.key) {
        case 'openai': hint = 'Check OPENAI_API_KEY, model name, and network connectivity. Use `!testai` to debug.'; break;
        case 'mongo': hint = 'Check MONGO_URI, Atlas/Network access, or Railway plugin settings.'; break;
        case 'storage': hint = 'Check disk write permissions or Mongo connection.'; break;
        case 'rw': hint = 'Storage write/read failed; verify filesystem permissions or Mongo user roles.'; break;
        case 'scheduler': hint = 'Bot may not be fully logged in; check DISCORD_TOKEN and intents.'; break;
        default: hint = 'Investigate logs and admin dashboard.';
      }
    }
    embed.addFields({ name: `${statusEmoji} ${r.name}`, value: `${r.note || ''}${hint ? '\n\n**Debug:** ' + hint : ''}`, inline: false });
  }

  return { embed, results };
}

const _GBB_g = globalThis;
const adminLog = _GBB_g.adminLog || (async () => {});
const awardAchievement = _GBB_g.awardAchievement || (async () => false);
const getOpenAIResponse = _GBB_g.getOpenAIResponse || (async () => '');
const validateModel = _GBB_g.validateModel || (async () => ({ ok: false }));
const saveWeekly = _GBB_g.saveWeekly || (async () => {});
const saveHabits = _GBB_g.saveHabits || (async () => {});
const saveMemory = _GBB_g.saveMemory || (async () => {});

export default {
  name: 'health',
  description: 'Run a health diagnostic for the bot (storage, AI, scheduling, mongo)',
  exampleArgs: '',
  notes: 'Admin-only diagnostic. Shows storage, AI, and command check status. Use from admin channels.',
  group: 'admin',
  slash: { options: [] },
  async execute(context, message, args) {
    const guild = message.guild || (message.channel && message.channel.guild) || null;
    const { embed } = await runHealthCheck(context, guild);

    // Try to post/update in #gbb-health if present, otherwise reply with embed
    try {
      if (guild) {
        const ch = guild.channels.cache.find(c => (c.name||'').toLowerCase() === 'gbb-health' && c.type === 0);
        if (ch) {
          // try to find an existing pinned health message
          let pinsRaw;
          try { pinsRaw = await ch.messages.fetchPins(); } catch (err) { pinsRaw = null; }
          // Normalize various return shapes (Collection, Map, Array) into an array we can search
          let pins = [];
          if (pinsRaw) {
            if (Array.isArray(pinsRaw)) pins = pinsRaw;
            else if (typeof pinsRaw.find === 'function') pins = pinsRaw; // Collection-like
            else if (pinsRaw.values && typeof pinsRaw.values === 'function') pins = Array.from(pinsRaw.values());
            else pins = [];
          }
          const existing = (pins && typeof pins.find === 'function') ? pins.find(m => m.author && m.author.id === context.client.user.id && m.embeds && m.embeds[0] && m.embeds[0].title && m.embeds[0].title.includes('GymBotBro — Health Scan')) : null;
          if (existing) {
            await existing.edit({ embeds: [embed] });
            return message.reply('Updated the pinned health scan in #gbb-health');
          }
          const sent = await ch.send({ embeds: [embed] });
          try { await sent.pin(); } catch(e){}
          return message.reply('Posted health scan to #gbb-health');
        }
      }
    } catch (e) { console.error('health command post failed', e); }

    return message.reply({ embeds: [embed] });
  }
};

export { runHealthCheck, runCommandChecks };
// Expose a helper to run command checks (simulated or live)
async function runCommandChecks(context, guild, options = {}) {
  const { simulated = true, timeoutMs = 5000, include = null } = options;
  const commandsDir = path.join(process.cwd(), 'src', 'commands');
  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
  const results = [];

  for (const f of files) {
    const full = path.join(commandsDir, f);
    let mod;
    try {
      mod = await import(pathToFileURL(full).href);
    } catch (e) {
      results.push({ file: f, ok: false, reason: 'import failed: ' + String(e).slice(0,200) });
      continue;
    }
    const def = mod.default;
    if (!def || typeof def.execute !== 'function') { results.push({ file: f, ok: false, reason: 'no execute' }); continue; }
    if (include && !include.includes(def.name)) { results.push({ file: f, ok: true, skipped: true }); continue; }

    // Skip admin-only or obviously destructive commands in simulated mode
    const skipPatterns = ['admin', 'shopadmin', 'delete', 'drop', 'ban'];
    if (simulated && (def.group && def.group.toLowerCase().includes('admin') || skipPatterns.some(p=>def.name && def.name.toLowerCase().includes(p)))) {
      results.push({ file: f, ok: true, skipped: true });
      continue;
    }

    // Build fake context and message similar to the test runner but using context stores so commands exercise same data
    const ctx = Object.assign({}, context);
    const message = {
      author: {
        id: 'health-check',
        username: 'health-check',
        discriminator: '0000',
        displayAvatarURL: (opts) => null
      },
      member: { roles: { cache: new Map() }, permissions: { has: () => false } },
      guild: guild || null,
      channel: { id: 'health-check-channel', send: async ()=>({ id: 'hc' }), messages: { fetchPins: async ()=>[] }, isTextBased: true, permissionsFor: ()=>({ viewable: true }) },
      content: '',
      reply: async () => ({}),
      mentions: { users: { first: ()=>null } }
    };

    // If live, point message.channel to a real channel in guild if possible
    if (!simulated && guild) {
      const ch = guild.channels.cache.find(c=>c.isTextBased && c.permissionsFor && c.viewable);
      if (ch) message.channel = ch;
    }

    let ok = false; let reason = null;
    try {
      const p = def.execute(ctx, message, ['health-check']);
      if (p && typeof p.then === 'function') {
        await Promise.race([p, new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')), timeoutMs))]);
      }
      ok = true;
    } catch (e) { ok = false; reason = String(e).slice(0,300); }
    results.push({ file: f, name: def.name || f, ok, reason });
  }

  const passed = results.filter(r=>r.ok && !r.skipped).length;
  const total = results.filter(r=>!r.skipped).length;
  return { results, passed, total };
}
