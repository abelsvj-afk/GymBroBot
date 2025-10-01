const _GBB_g = globalThis;
const adminLog = _GBB_g.adminLog || (async () => {});
const awardAchievement = _GBB_g.awardAchievement || (async () => false);
const getOpenAIResponse = _GBB_g.getOpenAIResponse || (async () => '');
const validateModel = _GBB_g.validateModel || (async () => ({ ok: false }));
const saveWeekly = _GBB_g.saveWeekly || (async () => {});
const saveHabits = _GBB_g.saveHabits || (async () => {});
const saveMemory = _GBB_g.saveMemory || (async () => {});

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
