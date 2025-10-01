export default {
  name: 'partner',
  description: 'Join the accountability partner matching queue or find a partner',
  notes: 'Use to request or find an accountability partner for workouts or goals.',
  group: 'partners',
  exampleArgs: 'goal',
  slash: { options: [{ name: 'type', type: 3, description: 'goal or future', required: true }] },
  execute: async (context, message, args) => {
    const type = args[0]?.toLowerCase();
    if (!type || !['goal','future'].includes(type)) return message.reply('Usage: `/partner type:goal` or `/partner type:future`');
    const { partnerQueue, matches, onboarding, savePartnerQueue } = context;
    const authorId = message.author.id;
    if (partnerQueue.includes(authorId)) return message.reply("You're already in the matching queue!");
    if (matches[authorId]) return message.reply(`You already have a partner! Check <#${matches[authorId]}>`);
    if (onboarding[authorId]?.blockedFromMatching) return message.reply('You are blocked from matching.');
    await message.reply(`Starting ${type} partner onboarding in DMs!`);
    await context.startOnboarding(message.author, type);
  }
};
