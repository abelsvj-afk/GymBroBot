/**
 * Autonomous Channel Personalities System
 * Handles faith, health, wealth channels with unique AI personalities
 * Rate-limited and context-aware responses
 */

import { EmbedBuilder } from 'discord.js';

// Configuration
const OWNER_ID = '547946513876369409'; // Your Discord ID

// Channel configuration with personalities - ALL NOW AUTONOMOUS
const CHANNEL_PERSONALITIES = {
  'faith': {
    name: 'Faith Guardian',
    personality: `You are Faith Guardian, a warm Christian companion with deep scriptural knowledge. You help users grow spiritually through prayer, Bible study, and fellowship. Check on their prayer life, Bible reading, church involvement, spiritual struggles, and testimonies. Be loving, wise, and always point toward Jesus. Include relevant scripture when appropriate. Ask about specific spiritual disciplines and offer biblical encouragement.`,
    color: 0x8B4513, // Brown
    emoji: '🙏',
    autonomousChecks: true,
    checkInterval: { min: 4, max: 8 }, // 4-8 hours (dynamic)
    nextCheck: Date.now() + (6 * 60 * 60 * 1000), // Initial 6 hours
    topics: ['prayer', 'bible', 'faith', 'jesus', 'god', 'church', 'christian', 'spiritual', 'testimony', 'worship', 'scripture', 'salvation', 'holy spirit', 'discipleship'],
    checkMessages: [
      'how has your prayer life been lately? I\'ve been thinking about your spiritual journey',
      'the Lord has put you on my heart today. How are you feeling spiritually?',
      'how has your Bible reading been going? Any verses speaking to you?',
      'how can I pray for you? What\'s God been teaching you in this season?',
      'how has your walk with Jesus been? Any areas where you need encouragement?',
      'how has worship been for you lately? Is there anything on your heart to share?',
      'how has your relationship with God been developing? Any testimonies to share?',
      'I felt prompted to check on your spiritual wellness. How\'s your heart today?'
    ]
  },
  'health': {
    name: 'Health Coach',
    personality: `You are Health Coach, an energetic wellness mentor focused on physical, mental, and emotional health. You provide workout motivation, nutrition guidance, mental health support, and lifestyle coaching. Check on users' fitness routines, eating habits, sleep, stress levels, and overall wellness. Be encouraging but realistic, and always promote sustainable healthy habits.`,
    color: 0xFF6B6B, // Red
    emoji: '💪',
    autonomousChecks: true,
    checkInterval: { min: 6, max: 12 }, // 6-12 hours (dynamic)
    nextCheck: Date.now() + (8 * 60 * 60 * 1000), // Initial 8 hours
    topics: ['workout', 'fitness', 'health', 'nutrition', 'exercise', 'wellness', 'mental health', 'diet', 'muscle', 'cardio', 'sleep', 'stress'],
    checkMessages: [
      'how has your fitness routine been going? Staying consistent with workouts?',
      'checking in on your wellness journey! How are you feeling physically and mentally?',
      'how\'s your nutrition been lately? Getting enough protein and staying hydrated?',
      'what\'s your energy level like today? How has your sleep been?',
      'how are you managing stress? Remember, mental health is just as important as physical!',
      'any fitness goals you\'re working toward? I\'m here to help you crush them!',
      'checking on your overall wellness - how\'s your body feeling today?',
      'how\'s your mind-body connection? Are you listening to what your body needs?'
    ]
  },
  'wealth': {
    name: 'Wealth Advisor',
    personality: `You are Wealth Advisor, a sophisticated financial mentor with expertise in building lasting wealth. You guide users through budgeting, investing, business building, and financial planning. Check on their financial goals, spending habits, investment progress, income growth, and wealth-building strategies. Be practical, encouraging, and focused on long-term financial success.`,
    color: 0xFFD700, // Gold
    emoji: '💰',
    autonomousChecks: true,
    checkInterval: { min: 12, max: 24 }, // 12-24 hours (dynamic)
    nextCheck: Date.now() + (18 * 60 * 60 * 1000), // Initial 18 hours
    topics: ['money', 'finance', 'investment', 'budget', 'wealth', 'business', 'entrepreneur', 'saving', 'crypto', 'stocks', 'income', 'financial goals'],
    checkMessages: [
      'how are your financial goals progressing? Staying on track with your budget?',
      'checking in on your wealth-building journey! Any new investment opportunities?',
      'how\'s your income growth looking? Working on any side hustles or business ideas?',
      'how are you managing your expenses? Finding ways to optimize your spending?',
      'any market movements catching your attention? How\'s your portfolio doing?',
      'what financial milestone are you working toward next? I\'m here to strategize!',
      'how\'s your emergency fund looking? Building that financial security?',
      'checking on your money mindset - feeling confident about your financial future?'
    ]
  },
  'daily-checkins': {
    name: 'Daily Companion',
    personality: `You are Daily Companion, a supportive accountability partner focused on daily habits and consistent progress. You help users reflect, set intentions, track goals, and maintain momentum. Check on their daily routines, habit consistency, goal progress, and overall life balance. Be encouraging, thoughtful, and help users stay focused on what matters most.`,
    color: 0x9B59B6, // Purple
    emoji: '📅',
    autonomousChecks: true,
    checkInterval: { min: 18, max: 30 }, // 18-30 hours (spans across days)
    nextCheck: Date.now() + (24 * 60 * 60 * 1000), // Initial 24 hours
    topics: ['daily', 'goals', 'progress', 'habits', 'reflection', 'checkin', 'accountability', 'routine', 'consistency', 'productivity'],
    checkMessages: [
      'how has your day been shaping up? Staying consistent with your routines?',
      'checking in on your daily habits! Which ones are feeling easy vs challenging?',
      'how are you progressing toward your goals? Feeling good about your momentum?',
      'what\'s been the highlight of your day so far? Any wins to celebrate?',
      'how\'s your work-life balance been? Taking time for what matters most?',
      'reflecting on your recent progress - what patterns are you noticing?',
      'how are you feeling about your current habits? Ready to level up any areas?',
      'checking your daily rhythm - what\'s working well and what needs adjustment?'
    ]
  }
};

// Rate limiting
const userLastResponse = new Map();
const RATE_LIMIT_MS = 60000; // 1 minute between responses per user per channel

// Faith autonomous check data
const faithCheckData = new Map();

class ChannelPersonalities {
  constructor(client, storage) {
    this.client = client;
    this.storage = storage;
    this.setupEventListeners();
    this.startAutonomousChecks();
  }

  setupEventListeners() {
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      const channelName = message.channel.name?.toLowerCase();
      const personality = CHANNEL_PERSONALITIES[channelName];

      if (personality) {
        await this.handleChannelMessage(message, personality);
      }
    });
  }

  async handleChannelMessage(message, personality) {
    try {
      // Rate limiting
      const userId = message.author.id;
      const channelId = message.channel.id;
      const rateLimitKey = `${userId}-${channelId}`;

      const lastResponse = userLastResponse.get(rateLimitKey);
      if (lastResponse && Date.now() - lastResponse < RATE_LIMIT_MS) {
        return; // Rate limited
      }

      // Check if message contains relevant topics
      const messageContent = message.content.toLowerCase();
      const isRelevant = personality.topics.some(topic =>
        messageContent.includes(topic)
      ) || messageContent.length > 50; // Long messages are likely seeking help

      if (!isRelevant && Math.random() > 0.3) {
        return; // Only respond to 30% of non-relevant messages
      }

      // Generate AI response
      const response = await this.generatePersonalityResponse(message, personality);
      if (response) {
        await message.reply(response);
        userLastResponse.set(rateLimitKey, Date.now());

        // Update channel user data
        this.updateChannelUserData(userId, message.channel.name?.toLowerCase());
      }

    } catch (error) {
      console.error(`Channel personality error (${personality.name}):`, error);
    }
  }

  async generatePersonalityResponse(message, personality) {
    try {
      if (typeof globalThis.getOpenAIResponse !== 'function') {
        return null;
      }

      const context = `
You are ${personality.name} responding in the ${message.channel.name} channel.
${personality.personality}

User: ${message.author.displayName}
Message: ${message.content}

Respond helpfully and stay in character. Keep responses concise but meaningful (1-3 sentences).
`;

      const response = await globalThis.getOpenAIResponse(context, 'system');

      // Create embed response
      const embed = new EmbedBuilder()
        .setColor(personality.color)
        .setAuthor({
          name: personality.name,
          iconURL: this.client.user.displayAvatarURL()
        })
        .setDescription(`${personality.emoji} ${response}`)
        .setTimestamp();

      return { embeds: [embed] };

    } catch (error) {
      console.error('AI response generation error:', error);
      return null;
    }
  }

  startAutonomousChecks() {
    // Start autonomous check-ins for all channels with dynamic timing
    setInterval(async () => {
      await this.runAllAutonomousChecks();
    }, 30 * 60 * 1000); // Check every 30 minutes for due check-ins
  }

  async runAllAutonomousChecks() {
    const now = Date.now();

    for (const [channelName, personality] of Object.entries(CHANNEL_PERSONALITIES)) {
      if (!personality.autonomousChecks) continue;

      if (now >= personality.nextCheck) {
        await this.performAutonomousCheck(channelName, personality);

        // Set next check time with dynamic interval
        const minMs = personality.checkInterval.min * 60 * 60 * 1000;
        const maxMs = personality.checkInterval.max * 60 * 60 * 1000;
        const randomInterval = minMs + Math.random() * (maxMs - minMs);
        personality.nextCheck = now + randomInterval;

        console.log(`[${personality.name}] Next check in ${Math.round(randomInterval / (60 * 60 * 1000))} hours`);
      }
    }
  }

  async performAutonomousCheck(channelName, personality) {
    try {
      // Find all channels with this name across guilds
      const channels = this.client.channels.cache.filter(
        channel => channel.name?.toLowerCase() === channelName && channel.type === 0
      );

      if (channels.size === 0) return;

      // Get users to check (prioritize owner + active users)
      const usersToCheck = new Set();

      // Always include owner for faith and wealth channels (high priority)
      if (['faith', 'wealth'].includes(channelName)) {
        usersToCheck.add(OWNER_ID);
      }

      // Add other active users from this channel's data
      const channelData = this.getChannelUserData(channelName);
      Array.from(channelData.entries())
        .filter(([userId, data]) => {
          const timeSinceLastCheck = Date.now() - (data.lastCheck || 0);
          const daysSinceLastCheck = timeSinceLastCheck / (24 * 60 * 60 * 1000);
          return daysSinceLastCheck >= 1; // At least 1 day since last check
        })
        .sort((a, b) => (b[1].responseCount || 0) - (a[1].responseCount || 0)) // Sort by activity
        .slice(0, channelName === 'faith' ? 3 : 2) // Faith gets 3 users, others get 2
        .forEach(([userId]) => usersToCheck.add(userId));

      // Send check-ins to each channel
      for (const channel of channels.values()) {
        for (const userId of usersToCheck) {
          await this.sendPersonalizedCheckIn(channel, userId, personality, channelName);
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between users
        }
      }

    } catch (error) {
      console.error(`Autonomous check error (${personality.name}):`, error);
    }
  }

  async faithAutonomousCheck() {
    try {
      const faithPersonality = CHANNEL_PERSONALITIES['faith'];
      if (!faithPersonality.autonomousChecks) return;

      // Find faith channel in all guilds
      const faithChannels = this.client.channels.cache.filter(
        channel => channel.name?.toLowerCase() === 'faith' && channel.type === 0
      );

      if (faithChannels.size === 0) return;

      // Always include owner for faith check-ins, plus other active users
      const usersToCheck = new Set();

      // Always add owner if they have interacted with faith channels
      usersToCheck.add(OWNER_ID);

      // Add other users who haven't been checked recently
      Array.from(faithCheckData.entries())
        .filter(([userId, data]) => {
          const timeSinceLastCheck = Date.now() - (data.lastCheck || 0);
          return timeSinceLastCheck > 24 * 60 * 60 * 1000; // 24 hours
        })
        .slice(0, 2) // Max 2 additional users besides owner
        .forEach(([userId]) => usersToCheck.add(userId));

      // Send check-ins to each faith channel
      for (const faithChannel of faithChannels.values()) {
        for (const userId of usersToCheck) {
          const userData = faithCheckData.get(userId) || {};
          await this.sendFaithCheckIn(faithChannel, userId, userData);
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay between users
        }
      }

    } catch (error) {
      console.error('Faith autonomous check error:', error);
    }
  }

  async sendPersonalizedCheckIn(channel, userId, personality, channelName) {
    try {
      const user = await this.client.users.fetch(userId);
      if (!user) return;

      const randomMessage = personality.checkMessages[Math.floor(Math.random() * personality.checkMessages.length)];
      const personalizedMessage = `${user}, ${randomMessage} ${personality.emoji}`;

      const embed = new EmbedBuilder()
        .setColor(personality.color)
        .setAuthor({
          name: personality.name,
          iconURL: this.client.user.displayAvatarURL()
        })
        .setDescription(`${personality.emoji} ${personalizedMessage}`)
        .setFooter({ text: `Autonomous ${channelName} check-in • Your engagement matters!` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      // Update user data for this channel
      const channelData = this.getChannelUserData(channelName);
      const userData = channelData.get(userId) || {};
      channelData.set(userId, {
        ...userData,
        lastCheck: Date.now(),
        checkCount: (userData.checkCount || 0) + 1
      });

    } catch (error) {
      console.error(`${personality.name} check-in error:`, error);
    }
  }

  getChannelUserData(channelName) {
    if (!this.channelUserData) this.channelUserData = {};
    if (!this.channelUserData[channelName]) this.channelUserData[channelName] = new Map();
    return this.channelUserData[channelName];
  }

  updateChannelUserData(userId, channelName) {
    const channelData = this.getChannelUserData(channelName);
    const existing = channelData.get(userId) || {};
    channelData.set(userId, {
      ...existing,
      lastActivity: Date.now(),
      responseCount: (existing.responseCount || 0) + 1
    });
  }

  // Method to get all channel stats (for owner command and top performers)
  getAllChannelStats() {
    const stats = {};

    for (const channelName of ['faith', 'health', 'wealth', 'daily-checkins']) {
      const channelData = this.getChannelUserData(channelName);
      stats[channelName] = {
        totalUsers: channelData.size,
        activeUsers: Array.from(channelData.values()).filter(
          data => Date.now() - (data.lastActivity || 0) < 7 * 24 * 60 * 60 * 1000
        ).length,
        totalCheckins: Array.from(channelData.values()).reduce(
          (sum, data) => sum + (data.checkCount || 0), 0
        ),
        totalResponses: Array.from(channelData.values()).reduce(
          (sum, data) => sum + (data.responseCount || 0), 0
        )
      };
    }

    return stats;
  }

  // Get top performers across all channels
  getTopPerformers(limit = 10) {
    const performers = new Map();

    // Weight factors (faith and wealth get higher priority as requested)
    const weights = {
      faith: 3.0,      // Highest priority
      wealth: 2.5,     // High priority
      health: 2.0,     // Medium-high priority
      'daily-checkins': 1.5  // Base priority
    };

    for (const [channelName, weight] of Object.entries(weights)) {
      const channelData = this.getChannelUserData(channelName);

      for (const [userId, userData] of channelData.entries()) {
        if (!performers.has(userId)) {
          performers.set(userId, {
            userId,
            totalScore: 0,
            channels: {},
            lastActivity: 0
          });
        }

        const performer = performers.get(userId);
        const responses = userData.responseCount || 0;
        const checkins = userData.checkCount || 0;
        const channelScore = (responses * 2 + checkins) * weight;

        performer.totalScore += channelScore;
        performer.channels[channelName] = {
          responses,
          checkins,
          score: channelScore,
          lastActivity: userData.lastActivity || 0
        };
        performer.lastActivity = Math.max(performer.lastActivity, userData.lastActivity || 0);
      }
    }

    return Array.from(performers.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit);
  }
}

export default ChannelPersonalities;
