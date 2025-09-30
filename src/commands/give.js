export default {
  name: 'give',
  group: 'economy',
  slash: { group: 'economy', options: [ { name: 'user', type: 'USER', description: 'Who gets the GymCoins?', required: true }, { name: 'amount', type: 'INTEGER', description: 'How many GymCoins?', required: true } ] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const sender = message.author;
      // receiver: if interaction, message.mentions may not exist; support args fallback
      let receiver = null;
      if (message.mentions && message.mentions.users && message.mentions.users.first) receiver = message.mentions.users.first();
      if (!receiver && args && args[0]) {
        // try to resolve as user id
        const maybe = args[0].replace(/[<@!>]/g, '');
        try { receiver = await context.client.users.fetch(maybe); } catch(e) { receiver = null; }
      }
      if (!receiver) return message.reply('Usage: !give @user <amount>');

      const amount = parseInt(args[1] || args[0] || '0', 10);
      if (!amount || amount <= 0) return message.reply('Specify a valid positive amount to give.');
      if (receiver.id === sender.id) return message.reply('❌ You can\'t spot yourself, bro!');

      const economy = await storage.load('economy', {});
      if (!economy[sender.id]) economy[sender.id] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };
      if (!economy[receiver.id]) economy[receiver.id] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };

      if ((economy[sender.id].balance || 0) < amount) return message.reply('💔 You don\'t have enough GymCoins!');

      economy[sender.id].balance -= amount;
      economy[receiver.id].balance += amount;
      await storage.save('economy', economy);

      return message.reply(`✅ ${sender.username} spotted ${receiver.username} with **${amount} GymCoins**!`);
    } catch (e) {
      console.error('give command error', e);
      return message.reply('Error processing transfer.');
    }
  }
};
