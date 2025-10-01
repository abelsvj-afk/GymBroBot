export default {
  name: 'help',
  description: 'Show help (migrated from commandHandlers)',
  exampleArgs: '',
  notes: 'Shows categorized command summary. Use this to discover commonly-used commands.',
  execute: async (context, message, args) => {
    const { EmbedBuilder } = context;
    const embed = new EmbedBuilder()
      .setTitle("💪 GymBotBro Commands")
      .setDescription("Your accountability partner for fitness and life!")
      .addFields(
        { name: "🏋️ Fitness", value: "`/fitness track` - Log workout\n`/fitness progress` - View stats\n`/fitness leaderboard` - Rankings", inline: true },
        { name: "📋 Habits", value: "`/habits add [habit]` - Track habit\n`/habits habits` - View habits\n`/habits check [habit]` - Check off", inline: true },
        { name: "🤖 Coaching", value: "`/coach coach [question]` - Get advice\n`/coach quote` - Motivation\n`/fitness workoutplan` - Get workout", inline: true },
        { name: "🤝 Partners", value: "`/partners partner [goal|future]` - Find accountability partner\n`/partners leavequeue` - Exit matching queue", inline: true }
      )
      .setColor(0x00AE86);

    return message.reply({ embeds: [embed] });
  }
};
