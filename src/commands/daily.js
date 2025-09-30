export default {
  name: 'daily',
  group: 'economy',
  slash: { group: 'economy', options: [] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const userId = message.author.id;
      const now = Date.now();
      const economy = await storage.load('economy', {});
      if (!economy[userId]) economy[userId] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };
      if (now - (economy[userId].lastClaim || 0) < 86400000) {
        const hours = Math.ceil((86400000 - (now - (economy[userId].lastClaim || 0))) / 3600000);
        return message.reply(`⏳ You already grabbed your daily protein shake! Come back in ${hours}h.`);
      }
      const reward = 100;
      economy[userId].balance += reward;
      economy[userId].lastClaim = now;
      await storage.save('economy', economy);
      return message.reply(`💪 You claimed your daily **${reward} GymCoins**!\nTotal: ${economy[userId].balance}`);
    } catch (e) {
      console.error('daily command error', e);
      return message.reply('Error claiming daily reward.');
    }
  }
};
