export default {
  name: 'checkin',
  group: 'economy',
  slash: { group: 'economy', options: [] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const userId = message.author.id;
      const now = new Date();
      const zone = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const today = new Date(now.toLocaleString('en-US', { timeZone: zone })).toDateString();

      const economy = await storage.load('economy', {});
      if (!economy[userId]) economy[userId] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };

      if (economy[userId].lastCheckin === today) return message.reply('✅ You already checked in today, GymBro!');

      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = new Date(yesterday.toLocaleString('en-US', { timeZone: zone })).toDateString();

      if (economy[userId].lastCheckin === yesterdayStr) {
        economy[userId].streak = (economy[userId].streak || 0) + 1;
      } else {
        economy[userId].streak = 1;
      }

      const baseReward = 50;
      const streakBonus = Math.min((economy[userId].streak || 0) * 10, 70);
      const totalReward = baseReward + streakBonus;

      economy[userId].balance += totalReward;
      economy[userId].lastCheckin = today;
      await storage.save('economy', economy);

      return message.reply(`💪 You checked in for your workout today!\n🏆 Streak: **${economy[userId].streak} days**\n💰 Earned: **${totalReward} GymCoins** (Base ${baseReward} + Streak Bonus ${streakBonus})\nTotal: ${economy[userId].balance}`);
    } catch (e) {
      console.error('checkin error', e);
      return message.reply('Error checking in.');
    }
  }
};
