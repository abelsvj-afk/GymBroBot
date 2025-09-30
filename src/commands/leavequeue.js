export default {
  name: 'leavequeue',
  description: 'Leave the partner queue',
  group: 'partners',
  slash: { type: 'subcommand' },
  execute: async (context, message, args) => {
    const { partnerQueue, savePartnerQueue } = context;
    const authorId = message.author.id;
    if (!partnerQueue.includes(authorId)) return message.reply("You're not in the matching queue!");
    const idx = partnerQueue.indexOf(authorId);
    if (idx !== -1) partnerQueue.splice(idx, 1);
    savePartnerQueue();
    return message.reply('You\'ve been removed from the matching queue.');
  }
};
