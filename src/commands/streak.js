export default {
  name: 'streak',
  group: 'economy',
  slash: { group: 'economy', options: [] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const userId = message.author.id;
      const economy = await storage.load('economy', {});
      if (!economy[userId]) economy[userId] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };
      return message.reply(`🔥 ${message.author.username}, your current workout streak is **${economy[userId].streak} days**!`);
    } catch (e) {
      console.error('streak error', e);
      return message.reply('Error fetching streak.');
    }
  }
};
