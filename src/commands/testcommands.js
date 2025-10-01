import { EmbedBuilder } from 'discord.js';
import { runCommandChecks } from './health.js';

export default {
  name: 'testcommands',
  description: 'Run a health-style test of every command (admin only)',
  exampleArgs: 'live',
  notes: 'Admin-only. Run without args to simulate tests, or `live` to run against real channels (be cautious).',
  group: 'admin',
  slash: { options: [{ name: 'live', type: 5, description: 'Run live against guild channels (requires admin)', required: false }] },
  async execute(context, message, args) {
    const isAdmin = (message.member && message.member.permissions && message.member.permissions.administrator) || process.env.DEBUG_COMMANDS === '1';
    if (!isAdmin) return message.reply('You must be an admin to run command tests.');

    const live = args && args[0] === 'live';
    const guild = message.guild || (message.channel && message.channel.guild) || null;
    await message.reply('Running command checks — this may take a minute...');
    try {
      const res = await runCommandChecks(context, guild, { simulated: !live, timeoutMs: 10000 });
      const embed = new EmbedBuilder().setTitle('Command Test Results').setTimestamp();
      const pct = res.total ? Math.round((res.passed / res.total) * 100) : 0;
      embed.addFields({ name: `Result`, value: `${res.passed}/${res.total} passed (${pct}%)`, inline: false });
      const sample = res.results.filter(r=>!r.ok).slice(0,6).map(r=>`${r.name||r.file}: ${r.reason||'failed'}`).join('\n') || 'All commands OK';
      embed.addFields({ name: 'Failures / Notes', value: sample, inline: false });
      await message.reply({ embeds: [embed] });
    } catch (e) {
      console.error('testcommands failed', e);
      await message.reply('Command tests failed: ' + String(e).slice(0,200));
    }
  }
};
