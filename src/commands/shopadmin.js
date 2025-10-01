export default {
  name: 'shopadmin',
  description: 'Admin tools for managing the shop',
  notes: 'Admin-only: add/remove items or adjust prices. Use with care.',
  group: 'economy',
  slash: { group: 'economy', options: [] },
  async execute(context, message, args) {
    try {
      // admin-only operations: add/remove/list
  const member = (message.guild && message.guild.members && typeof message.guild.members.fetch === 'function') ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
      const isAdmin = member ? member.permissions.has(context.PermissionFlagsBits?.Administrator || 0) : false;
      const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
      if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or bot owner to manage shop items.');

      const op = args[0]?.toLowerCase();
      const storage = context.storage;
      const guildId = message.guild ? message.guild.id : 'global';

      const shop = await storage.load('shop', {});
      shop[guildId] = shop[guildId] || [];

      if (op === 'add') {
        const id = (args[1] || `item-${Date.now()}`).toString();
        const price = parseInt(args[2] || '0', 10) || 0;
        const type = args[3] || 'misc';
        // if adding role: usage: !shopadmin add <id> <price> role @role [durationHours] <name...>
        let nameStartIndex = 4;
        const meta = {};
        if (type === 'role') {
          const r = message.mentions.roles && message.mentions.roles.first ? message.mentions.roles.first() : null;
          if (r) meta.roleId = r.id;
          // optionally parse duration
          const possibleDuration = args[4];
          if (possibleDuration && !possibleDuration.startsWith('<@') && !isNaN(parseInt(possibleDuration, 10))) {
            meta.duration = parseInt(possibleDuration, 10); // hours
            nameStartIndex = 5;
          }
        }
        const name = args.slice(nameStartIndex).join(' ') || `Item ${id}`;
        shop[guildId].push({ id, name, price, type, description: '', meta });
        await storage.save('shop', shop);
        return message.reply(`Added shop item ${id} - ${name} (${price} Coins)`);
      } else if (op === 'list') {
        const items = shop[guildId] || [];
        if (!items.length) return message.reply('No items in shop.');
        const lines = items.map(it => `• ${it.id} — ${it.name} — ${it.price} Coins — ${it.type}`);
        return message.reply(lines.join('\n'));
      } else if (op === 'remove') {
        const id = args[1];
        if (!id) return message.reply('Usage: !shopadmin remove <id>');
        shop[guildId] = (shop[guildId] || []).filter(i => String(i.id) !== String(id));
        await storage.save('shop', shop);
        return message.reply(`Removed ${id}`);
      }

      return message.reply('Usage: !shopadmin add <id> <price> <type> <name...> | !shopadmin remove <id> | !shopadmin list');
    } catch (e) {
      console.error('shopadmin error', e);
      return message.reply('Error in shopadmin.');
    }
  }
};
