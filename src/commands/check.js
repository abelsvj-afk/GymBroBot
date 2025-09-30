export default {
  name: 'check',
  description: 'Check off a habit',
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
    saveHabits();
    return message.reply(`✅ **${habit}** checked off!\n🔥 Streak: ${habitData.streak} days`);
  }
};
