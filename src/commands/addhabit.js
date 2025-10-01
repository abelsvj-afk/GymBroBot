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
  name: 'addhabit',
  description: 'Start tracking a habit',
  exampleArgs: 'drink_water',
  notes: 'Creates a new habit to track. Use `/habits check <habit>` to mark progress and `/habits` to view.',
  group: 'habits',
  slash: { type: 'subcommand', options: [{ name: 'habit', type: 3, description: 'habit name', required: true }] },
  execute: async (context, message, args) => {
    const { saveHabits, habitTracker } = context;
    const habit = args.join(' ').trim();
    if (!habit) return message.reply('Usage: `/habits add [habit]`');
    const authorId = message.author.id;
    if (!habitTracker[authorId]) habitTracker[authorId] = {};
    if (habitTracker[authorId][habit]) return message.reply("You're already tracking that habit!");
    habitTracker[authorId][habit] = { streak: 0, lastChecked: null, total: 0 };
  try { await saveHabits(); } catch(e) { /* best-effort save */ }
  return message.reply(`✅ Started tracking: **${habit}**`);
  }
};
