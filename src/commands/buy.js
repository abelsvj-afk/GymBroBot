export default {
  name: 'buy',
  group: 'economy',
  slash: { group: 'economy', options: [ { name: 'item', type: 'STRING', description: 'Item id to buy', required: true } ] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const guildId = message.guild ? message.guild.id : 'global';
      const userId = message.author.id;
      const itemId = args[0] || (args[1] ? args[1] : null);
      if (!itemId) return message.reply('Usage: !buy <item-id>');

      const shop = await storage.load('shop', {});
      const items = shop[guildId] || [];
      const item = items.find(i => String(i.id) === String(itemId) || (i.name && i.name.toLowerCase() === String(itemId).toLowerCase()));
      if (!item) return message.reply('Item not found in shop. Use `!shop` to list items.');

      const economy = await storage.load('economy', {});
      if (!economy[userId]) economy[userId] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };
      if ((economy[userId].balance || 0) < item.price) return message.reply('You do not have enough GymCoins.');

      economy[userId].balance -= item.price;
      await storage.save('economy', economy);

      // apply the item: currently support type 'role' and 'rename' (fun privileges require additional permissions)
      if (item.type === 'role' && message.guild) {
        try {
          const role = message.guild.roles.cache.get(item.meta?.roleId);
          if (role) {
            await message.member.roles.add(role);
            // If item.meta.duration (in hours) present, record temporary grant
            if (item.meta && item.meta.duration && Number(item.meta.duration) > 0) {
              const expiresAt = Date.now() + Number(item.meta.duration) * 3600 * 1000;
              const grants = await storage.load('tempRoleGrants', {});
              grants[message.guild.id] = grants[message.guild.id] || {};
              grants[message.guild.id][message.author.id] = grants[message.guild.id][message.author.id] || [];
              grants[message.guild.id][message.author.id].push({ roleId: role.id, expiresAt });
              await storage.save('tempRoleGrants', grants);
            }
          }
          message.reply(`✅ You bought **${item.name}** and were granted the role ${role ? role.name : item.meta?.roleId}`);
        } catch (e) {
          console.error('buy role apply error', e);
          message.reply('Purchase completed but failed to apply the role. Contact an admin.');
        }
      } else if (item.type === 'rename') {
        // store pending rename claim so an admin or a background job can apply (requires ManageNicknames)
        const claims = await storage.load('renameClaims', {});
        claims[userId] = { item: item.id, requestedAt: Date.now(), guildId };
        await storage.save('renameClaims', claims);
        message.reply(`✅ Purchase recorded: ${item.name}. An admin or the bot will apply this rename shortly.`);
      } else {
        message.reply(`✅ Purchase recorded: ${item.name}.`);
      }

    } catch (e) {
      console.error('buy error', e);
      return message.reply('Error purchasing item.');
    }
  }
};
