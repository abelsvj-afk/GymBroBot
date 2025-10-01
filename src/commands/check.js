// check.js - clean version using helpers.exposed
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
  name: 'check',
  description: 'Check off a habit',
  exampleArgs: 'drink_water',
  notes: 'Marks a habit as completed for today and updates streaks. Use `/habits add` to create a habit first.',
  group: 'habits',
  slash: { type: 'subcommand', options: [{ name: 'habit', type: 3, description: 'habit name', required: true }] },
  execute: async (context, message, args) => {
    const { saveHabits, habitTracker } = context;
    const habit = args.join(' ').trim();
    if (!habit) return message.reply('Usage: `/habits check [habit]`');
    const authorId = message.author.id;
    if (!habitTracker[authorId] || !habitTracker[authorId][habit]) return message.reply('Habit not found! Use `/habits add` first.');
    const today = new Date().toDateString();
    const habitData = habitTracker[authorId][habit];
    if (habitData.lastChecked === today) return message.reply('Already checked off today! ✅');
    habitData.streak += 1;
    habitData.lastChecked = today;
    habitData.total += 1;
    try { await saveHabits(); } catch (e) { /* best-effort */ }
    return message.reply(`✅ **${habit}** checked off!\n🔥 Streak: ${habitData.streak} days`);
  }
};
