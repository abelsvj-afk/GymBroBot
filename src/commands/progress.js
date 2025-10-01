const _GBB_g = globalThis;
const adminLog = _GBB_g.adminLog || (async () => {});
const awardAchievement = _GBB_g.awardAchievement || (async () => false);
const getOpenAIResponse = _GBB_g.getOpenAIResponse || (async () => '');
const validateModel = _GBB_g.validateModel || (async () => ({ ok: false }));
const saveWeekly = _GBB_g.saveWeekly || (async () => {});
const saveHabits = _GBB_g.saveHabits || (async () => {});
const saveMemory = _GBB_g.saveMemory || (async () => {});

export default {
  name: 'progress',
  description: 'Show weekly progress',
  exampleArgs: '',
  notes: 'Displays your workouts this week and success rate. Use to check personal stats.',
  group: 'fitness',
  slash: { type: 'subcommand' },
  execute: async (context, message, args) => {
    const { EmbedBuilder, saveWeekly, fitnessWeekly } = context;
    const authorId = message.author.id;
    const data = fitnessWeekly[authorId] || { yes: 0, no: 0 };
    const total = data.yes + data.no;
    const rate = total > 0 ? Math.round((data.yes / total) * 100) : 0;

    const embed = new EmbedBuilder()
      .setTitle(`📈 ${message.author.username}'s Progress`)
      .addFields({ name: 'This Week', value: `✅ ${data.yes} workouts\n❌ ${data.no} missed\nSuccess Rate: ${rate}%`, inline: true })
      .setColor(rate >= 70 ? 0x00FF00 : rate >= 50 ? 0xFFFF00 : 0xFF0000);

    return message.reply({ embeds: [embed] });
  }
};
