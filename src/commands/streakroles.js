export default {
  name: 'streakroles',
  group: 'economy',
  slash: { group: 'economy', options: [] },
  async execute(context, message, args) {
    try {
      const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
      const isAdmin = member ? member.permissions.has(context.PermissionFlagsBits?.Administrator || 0) : false;
      const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
      if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or bot owner to manage streak roles.');

      const op = (args[0] || '').toLowerCase();
      const storage = context.storage;
      const guildId = message.guild ? message.guild.id : 'global';
      const cfg = await storage.load('streakRoles', {});
      cfg[guildId] = cfg[guildId] || {};

      if (op === 'set') {
        const days = args[1];
        const role = message.mentions.roles && message.mentions.roles.first ? message.mentions.roles.first() : null;
        if (!days || !role) return message.reply('Usage: !streakroles set <days> @role');
        cfg[guildId][String(days)] = role.id;
        await storage.save('streakRoles', cfg);
        return message.reply(`Set streak role for ${days} days -> ${role.name}`);
      } else if (op === 'list') {
        const entries = Object.entries(cfg[guildId] || {});
        if (!entries.length) return message.reply('No streak roles configured.');
        const lines = entries.map(([d, r]) => `• ${d} days => <@&${r}>`);
        return message.reply(lines.join('\n'));
      } else if (op === 'remove') {
        const days = args[1];
        if (!days) return message.reply('Usage: !streakroles remove <days>');
        delete cfg[guildId][String(days)];
        await storage.save('streakRoles', cfg);
        return message.reply(`Removed streak role for ${days} days`);
      }

      return message.reply('Usage: !streakroles set <days> @role | !streakroles remove <days> | !streakroles list');
    } catch (e) {
      console.error('streakroles error', e);
      return message.reply('Error managing streak roles.');
    }
  }
};
