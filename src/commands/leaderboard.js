export default {
  name: 'leaderboard',
  description: 'Show weekly leaderboard',
  group: 'fitness',
  slash: { type: 'subcommand' },
  execute: async (context, message, args) => {
    const { fitnessWeekly } = context;
    const sorted = Object.entries(fitnessWeekly).sort((a,b)=> (b[1].yes||0) - (a[1].yes||0));
    if (!sorted.length) return message.reply('No fitness data recorded this week.');
    let msg = '🏆 **WEEKLY LEADERBOARD** 🏆\n\n';
    const medals = ['🥇','🥈','🥉'];
    sorted.slice(0,5).forEach(([userId, data], i)=>{ msg += `${medals[i]||'🔹'} <@${userId}> - ${data.yes} workouts\n`; });
    return message.reply(msg);
  }
};
