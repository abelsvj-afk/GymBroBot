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
  name: 'track',
  description: 'Log a workout (yes/no)',
  exampleArgs: 'yes',
  notes: 'Log whether you worked out. Use `yes` to increment workouts or `no` to record a miss.',
  group: 'fitness',
  slash: { type: 'subcommand', options: [{ name: 'text', type: 3, description: 'yes or no', required: false }] },
  execute: async (context, message, args) => {
    const { saveWeekly, fitnessWeekly } = context;
    const type = args[0]?.toLowerCase();
    if (!type || !['yes', 'no', 'y', 'n'].includes(type)) {
      return message.reply("Usage: `!track yes` or `/fitness track yes` or `!track no`");
    }

    const authorId = message.author.id;
    if (!fitnessWeekly[authorId]) fitnessWeekly[authorId] = { yes: 0, no: 0 };

    const isYes = ['yes', 'y'].includes(type);
    if (isYes) {
      fitnessWeekly[authorId].yes += 1;
      try { await message.react('💪'); } catch {};
      message.reply('Beast mode activated! 🔥');
    } else {
      fitnessWeekly[authorId].no += 1;
      try { await message.react('❌'); } catch {};
      message.reply('Tomorrow is a new day! 🙂');
    }

    try { await saveWeekly(); } catch (e) { /* best-effort save */ }
  }
};
