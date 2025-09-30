export default {
  name: 'balance',
  group: 'economy',
  slash: { group: 'economy', options: [{ name: 'user', type: 'USER', description: 'Check another GymBro\'s balance', required: false }] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const user = (message.mentions && message.mentions.users && message.mentions.users.first()) || message.author;
      const economy = await storage.load('economy', {});
      if (!economy[user.id]) economy[user.id] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };
      return message.reply(`🏋️ ${user.username} has **${economy[user.id].balance} GymCoins**`);
    } catch (e) {
      console.error('balance command error', e);
      return message.reply('Error fetching balance.');
    }
  }
};
