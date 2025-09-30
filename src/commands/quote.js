export default {
  name: 'quote',
  description: 'Random motivational quote',
  group: 'coach',
  slash: { type: 'subcommand' },
  execute: async (context, message, args) => {
    const quotes = [
      "Rise and grind! Today's your day to be better than yesterday.",
      "Your body can stand almost anything. It's your mind you have to convince.",
      "Success isn't given. It's earned in the gym.",
      "The pain you feel today will be the strength you feel tomorrow.",
      "Don't wish for it, work for it.",
      "Be stronger than your excuses."
    ];
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return message.reply(quote);
  }
};
