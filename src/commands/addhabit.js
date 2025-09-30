export default {
  name: 'addhabit',
  description: 'Start tracking a habit',
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
    saveHabits();
    return message.reply(`✅ Started tracking: **${habit}**`);
  }
};
