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
