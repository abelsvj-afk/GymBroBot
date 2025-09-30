export default {
  name: 'coach',
  description: 'Ask the coach a question',
  group: 'coach',
  slash: { type: 'subcommand', options: [{ name: 'text', type: 3, description: 'question', required: true }] },
  execute: async (context, message, args) => {
    if (!args.length) return message.reply('Ask me anything about fitness!');
    const question = args.join(' ');
    const prompt = `You are GymBotBro, a fitness coach. Answer this question in 2-3 sentences: "${question}"`;
    try { const response = await context.getOpenAIResponse(prompt); return message.reply(`💪 **Coach says:**\n${response}`); } catch { return message.reply("I'm having trouble thinking right now, try again!"); }
  }
};
