const _GBB_g = globalThis;
const adminLog = _GBB_g.adminLog || (async () => {});
const awardAchievement = _GBB_g.awardAchievement || (async () => false);
const getOpenAIResponse = _GBB_g.getOpenAIResponse || (async () => '');
const validateModel = _GBB_g.validateModel || (async () => ({ ok: false }));
const saveWeekly = _GBB_g.saveWeekly || (async () => {});
const saveHabits = _GBB_g.saveHabits || (async () => {});
const saveMemory = _GBB_g.saveMemory || (async () => {});

export default {
  name: 'coach',
  description: 'Ask the coach a question',
  exampleArgs: 'how do i build a push-up progression',
  notes: 'Ask for short coaching advice. Responses are AI-generated; be concise in your prompt for best results.',
  group: 'coach',
  slash: { type: 'subcommand', options: [{ name: 'text', type: 3, description: 'question', required: true }] },
  execute: async (context, message, args) => {
    if (!args.length) return message.reply('Ask me anything about fitness!');
    const question = args.join(' ');
    const prompt = `You are GymBotBro, a fitness coach. Answer this question in 2-3 sentences: "${question}"`;
    try { const response = await context.getOpenAIResponse(prompt); return message.reply(`💪 **Coach says:**\n${response}`); } catch { return message.reply("I'm having trouble thinking right now, try again!"); }
  }
};
