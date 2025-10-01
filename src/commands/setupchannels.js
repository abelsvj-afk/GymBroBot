export default {
  name: 'setupchannels',
  group: 'admin',
  description: 'Owner-only command to set up personality channels',
  async execute(message, args) {
    try {
      // Check if user is the bot owner
      const OWNER_ID = '547946513876369409'; // Your Discord ID
      if (message.author.id !== OWNER_ID) {
        return message.reply('❌ This command is restricted to the bot owner only.');
      }

      const { EmbedBuilder, ChannelType, PermissionFlagsBits } = await import('discord.js');

      const guild = message.guild;
      if (!guild) {
        return message.reply('❌ This command must be used in a server.');
      }

      // Check if user has manage channels permission
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply('❌ You need Manage Channels permission to use this command.');
      }

      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('🔧 Setting up Personality Channels')
        .setDescription('Creating channels for autonomous AI personalities...')
        .setTimestamp();

      await message.reply({ embeds: [embed] });

      const channelsToCreate = [
        {
          name: 'faith',
          description: '🙏 Christian faith journey, prayer, and spiritual growth',
          topic: 'A space for faith discussions, prayer requests, and spiritual encouragement. The Faith Guardian AI will check on your spiritual journey.'
        },
        {
          name: 'health',
          description: '💪 Health, fitness, and wellness support',
          topic: 'Share your fitness journey, get health tips, and receive motivation from the Health Coach AI.'
        },
        {
          name: 'wealth',
          description: '💰 Financial wisdom and wealth building',
          topic: 'Discuss finances, investments, and wealth-building strategies with the Wealth Advisor AI.'
        },
        {
          name: 'daily-checkins',
          description: '📅 Daily reflections and goal accountability',
          topic: 'Daily check-ins, progress updates, and accountability with the Daily Companion AI.'
        }
      ];

      const results = [];
      const createdChannels = [];

      for (const channelInfo of channelsToCreate) {
        try {
          // Check if channel already exists
          let existingChannel = guild.channels.cache.find(
            ch => ch.name.toLowerCase() === channelInfo.name.toLowerCase()
          );

          if (existingChannel) {
            results.push(`✅ ${channelInfo.name}: Already exists`);
            createdChannels.push(existingChannel);
            continue;
          }

          // Create the channel
          const newChannel = await guild.channels.create({
            name: channelInfo.name,
            type: ChannelType.GuildText,
            topic: channelInfo.topic,
            permissionOverwrites: [
              {
                id: guild.roles.everyone,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory
                ]
              }
            ]
          });

          // Send welcome message to the new channel
          const welcomeEmbed = new EmbedBuilder()
            .setColor(channelInfo.name === 'faith' ? 0x8B4513 :
                     channelInfo.name === 'health' ? 0xFF6B6B :
                     channelInfo.name === 'wealth' ? 0xFFD700 : 0x9B59B6)
            .setTitle(`Welcome to #${channelInfo.name}!`)
            .setDescription(`${channelInfo.description}\n\n${channelInfo.topic}`)
            .addFields(
              {
                name: '🤖 AI Personality',
                value: channelInfo.name === 'faith' ? 'Faith Guardian - Will autonomously check on your spiritual journey' :
                       channelInfo.name === 'health' ? 'Health Coach - Provides fitness and wellness support' :
                       channelInfo.name === 'wealth' ? 'Wealth Advisor - Offers financial guidance' :
                       'Daily Companion - Helps with daily accountability'
              },
              {
                name: '📝 How it works',
                value: 'Simply chat in this channel and the AI will respond when relevant. Each personality has unique knowledge and focus areas.'
              }
            )
            .setFooter({ text: 'Rate limited to prevent spam • AI responses are helpful but not professional advice' })
            .setTimestamp();

          await newChannel.send({ embeds: [welcomeEmbed] });

          results.push(`✅ ${channelInfo.name}: Created successfully`);
          createdChannels.push(newChannel);

        } catch (error) {
          results.push(`❌ ${channelInfo.name}: Failed - ${error.message}`);
        }
      }

      // Send final results
      const resultEmbed = new EmbedBuilder()
        .setColor(createdChannels.length === channelsToCreate.length ? 0x00FF00 : 0xFFFF00)
        .setTitle('🎯 Channel Setup Results')
        .setDescription(results.join('\n'))
        .addFields(
          {
            name: '📊 Summary',
            value: `${createdChannels.length}/${channelsToCreate.length} channels ready`
          },
          {
            name: '🤖 AI Personalities',
            value: 'All personality channels are now monitored by their respective AI companions. They will respond to relevant messages with rate limiting to prevent spam.'
          },
          {
            name: '🙏 Special Feature',
            value: 'The Faith Guardian will autonomously check on users\' spiritual journeys with personalized messages every 24+ hours.'
          }
        )
        .setTimestamp();

      await message.channel.send({ embeds: [resultEmbed] });

    } catch (error) {
      console.error('Setup channels error:', error);
      await message.reply(`❌ Setup failed: ${error.message}`);
    }
  }
};
