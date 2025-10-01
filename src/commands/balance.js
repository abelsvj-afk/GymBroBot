const _GBB_g = globalThis;
const adminLog = _GBB_g.adminLog || (async () => {});
const awardAchievement = _GBB_g.awardAchievement || (async () => false);
const getOpenAIResponse = _GBB_g.getOpenAIResponse || (async () => '');
const validateModel = _GBB_g.validateModel || (async () => ({ ok: false }));
const saveWeekly = _GBB_g.saveWeekly || (async () => {});
const saveHabits = _GBB_g.saveHabits || (async () => {});
const saveMemory = _GBB_g.saveMemory || (async () => {});

export default {
  name: 'balance',
  description: 'Show a user\'s GymCoin balance',
  exampleArgs: '@user',
  notes: 'Use this to check your or another member\'s GymCoin balance. Mention a user to check theirs.',
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
