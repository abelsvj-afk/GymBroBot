export default {
  name: 'habits',
  description: 'List your habits',
  group: 'habits',
  slash: { type: 'subcommand' },
  execute: async (context, message, args) => {
    const { habitTracker } = context;
    const authorId = message.author.id;
    const userHabits = habitTracker[authorId] || {};
    if (Object.keys(userHabits).length === 0) return message.reply('No habits tracked! Use `/habits add [habit]` to start.');
    let msg = `📋 **${message.author.username}'s Habits:**\n\n`;
    Object.entries(userHabits).forEach(([habit, data]) => {
      const today = new Date().toDateString();
      const checkedToday = data.lastChecked === today ? ' ✅' : '';
      msg += `• **${habit}**: ${data.streak} day streak${checkedToday}\n`;
    });
    return message.reply(msg);
  }
};
