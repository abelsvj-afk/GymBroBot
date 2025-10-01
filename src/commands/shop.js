export default {
  name: 'shop',
  description: 'Show available shop items',
  notes: 'Displays purchasable items and their IDs. Use `/economy buy <item>` to purchase.',
  group: 'economy',
  slash: { group: 'economy', options: [] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const guildId = message.guild ? message.guild.id : (args[0] || 'global');
      const shop = await storage.load('shop', {});
      const items = (shop[guildId] || []).slice(0, 50);
      if (!items.length) return message.reply('This server has no shop items configured. Admins can add items with `!shopadmin add`');

      const lines = items.map(it => `• **${it.id}** — ${it.name} — ${it.price} Coins — ${it.type}${it.description ? ' — ' + it.description : ''}`);
      return message.reply({ embeds: [{ title: '🏬 GymBro Shop', description: lines.join('\n'), color: 0xffcc00 }] });
    } catch (e) {
      console.error('shop error', e);
      return message.reply('Error fetching shop.');
    }
  }
};
