export default {
  name: 'topperformers',
  group: 'admin',
  description: 'Show top performers based on health and faith/wealth channel interactions',
  async execute(message, args) {
    try {
      // Check if user is the bot owner
      const OWNER_ID = '547946513876369409';
      if (message.author.id !== OWNER_ID) {
        return message.reply('❌ This command is restricted to the bot owner only.');
      }

      const { EmbedBuilder } = await import('discord.js');
      
      if (!globalThis.channelPersonalities) {
        return message.reply('❌ Channel personalities system not initialized.');
      }

      const limit = parseInt(args[0]) || 10;
      const topPerformers = globalThis.channelPersonalities.getTopPerformers(limit);
      const allStats = globalThis.channelPersonalities.getAllChannelStats();

      if (topPerformers.length === 0) {
        return message.reply('📊 No performance data available yet. Users need to interact with the personality channels first.');
      }

      // Create main leaderboard embed
      const mainEmbed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🏆 Top Performers Leaderboard')
        .setDescription(`Based on interactions with faith, health, wealth, and daily-check channels\n*Faith and wealth interactions have higher priority weighting*`)
        .setTimestamp();

      // Add top performers
      let leaderboard = '';
      const medals = ['🥇', '🥈', '🥉'];
      
      for (let i = 0; i < Math.min(topPerformers.length, 10); i++) {
        const performer = topPerformers[i];
        const medal = medals[i] || `${i + 1}.`;
        
        try {
          const user = await message.client.users.fetch(performer.userId);
          const userName = user ? user.displayName || user.username : `User ${performer.userId}`;
          
          // Calculate days since last activity
          const daysSinceActivity = Math.floor((Date.now() - performer.lastActivity) / (24 * 60 * 60 * 1000));
          const activityStatus = daysSinceActivity === 0 ? '🟢 Active today' : 
                                daysSinceActivity <= 3 ? `🟡 ${daysSinceActivity}d ago` : 
                                `🔴 ${daysSinceActivity}d ago`;
          
          leaderboard += `${medal} **${userName}** (${Math.round(performer.totalScore)} pts) ${activityStatus}\n`;
          
          // Add channel breakdown for top 3
          if (i < 3) {
            const channels = [];
            for (const [channelName, data] of Object.entries(performer.channels)) {
              if (data.responses > 0 || data.checkins > 0) {
                const channelEmoji = channelName === 'faith' ? '🙏' : 
                                   channelName === 'health' ? '💪' :
                                   channelName === 'wealth' ? '💰' : '📅';
                channels.push(`${channelEmoji} ${data.responses + data.checkins}`);
              }
            }
            if (channels.length > 0) {
              leaderboard += `   └ ${channels.join(' • ')}\n`;
            }
          }
        } catch (error) {
          leaderboard += `${medal} User ${performer.userId} (${Math.round(performer.totalScore)} pts)\n`;
        }
      }

      mainEmbed.addFields([
        { name: '👑 Leaderboard', value: leaderboard || 'No data available', inline: false }
      ]);

      // Create stats embed
      const statsEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📊 Channel Activity Statistics')
        .setDescription('Overall engagement across all personality channels');

      const channelStats = [];
      const channelEmojis = { faith: '🙏', health: '💪', wealth: '💰', 'daily-checkins': '📅' };
      
      for (const [channelName, stats] of Object.entries(allStats)) {
        const emoji = channelEmojis[channelName];
        const displayName = channelName.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        channelStats.push({
          name: `${emoji} ${displayName}`,
          value: `👥 ${stats.totalUsers} users\n💬 ${stats.totalResponses} responses\n✅ ${stats.totalCheckins} check-ins\n🔥 ${stats.activeUsers} active (7d)`,
          inline: true
        });
      }

      statsEmbed.addFields(channelStats);

      // Send embeds
      await message.reply({ embeds: [mainEmbed] });
      await message.channel.send({ embeds: [statsEmbed] });

      // Add detailed breakdown for owner
      if (args.includes('detailed') || args.includes('detail')) {
        const detailEmbed = new EmbedBuilder()
          .setColor(0x00AE86)
          .setTitle('🔍 Detailed Performance Breakdown')
          .setDescription('Individual channel performance for top performers');

        let detailedBreakdown = '';
        
        for (let i = 0; i < Math.min(topPerformers.length, 5); i++) {
          const performer = topPerformers[i];
          try {
            const user = await message.client.users.fetch(performer.userId);
            const userName = user ? user.displayName || user.username : `User ${performer.userId}`;
            
            detailedBreakdown += `**${i + 1}. ${userName}** (Total: ${Math.round(performer.totalScore)} pts)\n`;
            
            for (const [channelName, data] of Object.entries(performer.channels)) {
              if (data.responses > 0 || data.checkins > 0) {
                const emoji = channelEmojis[channelName];
                const displayName = channelName.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
                detailedBreakdown += `   ${emoji} ${displayName}: ${data.responses} responses, ${data.checkins} check-ins (${Math.round(data.score)} pts)\n`;
              }
            }
            detailedBreakdown += '\n';
          } catch (error) {
            detailedBreakdown += `**${i + 1}. User ${performer.userId}** (Total: ${Math.round(performer.totalScore)} pts)\n\n`;
          }
        }

        detailEmbed.setDescription(detailedBreakdown || 'No detailed data available');
        await message.channel.send({ embeds: [detailEmbed] });
      }

    } catch (error) {
      console.error('Top performers error:', error);
      await message.reply(`❌ Command failed: ${error.message}`);
    }
  }
};