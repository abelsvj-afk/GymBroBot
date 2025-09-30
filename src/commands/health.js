import { EmbedBuilder } from 'discord.js';

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

export default {
  name: 'health',
  description: 'Run a health diagnostic for the bot (storage, AI, scheduling, mongo)',
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
          const pins = await ch.messages.fetchPinned();
          const existing = pins.find(m => m.author && m.author.id === context.client.user.id && m.embeds && m.embeds[0] && m.embeds[0].title && m.embeds[0].title.includes('GymBotBro — Health Scan'));
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

export { runHealthCheck };
