import helpers from '../helpers.js';
const _ex = helpers.exposed || {};
const adminLog = _ex.adminLog || globalThis.adminLog || (async () => {});
const awardAchievement = _ex.awardAchievement || globalThis.awardAchievement || (async () => false);
const getOpenAIResponse = _ex.getOpenAIResponse || globalThis.getOpenAIResponse || (async () => '');
const validateModel = _ex.validateModel || globalThis.validateModel || (async () => ({ ok: false }));
const saveWeekly = _ex.saveWeekly || globalThis.saveWeekly || (async () => {});
const saveHabits = _ex.saveHabits || globalThis.saveHabits || (async () => {});
const saveMemory = _ex.saveMemory || globalThis.saveMemory || (async () => {});

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
