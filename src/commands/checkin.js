const _GBB_g = globalThis;
const adminLog = _GBB_g.adminLog || (async () => {});
const awardAchievement = _GBB_g.awardAchievement || (async () => false);
const getOpenAIResponse = _GBB_g.getOpenAIResponse || (async () => '');
const validateModel = _GBB_g.validateModel || (async () => ({ ok: false }));
const saveWeekly = _GBB_g.saveWeekly || (async () => {});
const saveHabits = _GBB_g.saveHabits || (async () => {});
const saveMemory = _GBB_g.saveMemory || (async () => {});

export default {
  name: 'checkin',
  description: 'Daily check-in for economy rewards',
  exampleArgs: '',
  notes: 'Claim your daily GymCoin reward. Cooldown applies.',
  group: 'economy',
  slash: { group: 'economy', options: [] },
  async execute(context, message, args) {
    try {
      const storage = context.storage;
      const userId = message.author.id;
      const now = new Date();
      const zone = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const today = new Date(now.toLocaleString('en-US', { timeZone: zone })).toDateString();

      const economy = await storage.load('economy', {});
      if (!economy[userId]) economy[userId] = { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };

      if (economy[userId].lastCheckin === today) return message.reply('✅ You already checked in today, GymBro!');

      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = new Date(yesterday.toLocaleString('en-US', { timeZone: zone })).toDateString();

      if (economy[userId].lastCheckin === yesterdayStr) {
        economy[userId].streak = (economy[userId].streak || 0) + 1;
      } else {
        economy[userId].streak = 1;
      }

      const baseReward = 50;
      const streakBonus = Math.min((economy[userId].streak || 0) * 10, 70);
      const totalReward = baseReward + streakBonus;

      economy[userId].balance += totalReward;
      economy[userId].lastCheckin = today;
      await storage.save('economy', economy);

      // Award achievements for streak milestones (if bot helper available)
      try {
        if (context && context.awardAchievement) {
          if ((economy[userId].streak || 0) === 7) await context.awardAchievement(message.guild, userId, 'hydrated');
          if ((economy[userId].streak || 0) === 30) await context.awardAchievement(message.guild, userId, 'iron_champion');
        }
      } catch (e) { console.error('achievement award failed', e); }

      // Check for streak milestone roles configuration per guild and award roles if configured
      try {
        if (message.guild) {
          const guildId = message.guild.id;
          const streakRoles = await storage.load('streakRoles', {}); // { [guildId]: { '7': roleId, '30': roleId } }
          const rolesForGuild = streakRoles[guildId] || {};
          const grantIf = (days, roleId) => {
            if (!roleId) return false;
            if (economy[userId].streak === days) return true;
            return false;
          };

          for (const [daysStr, roleId] of Object.entries(rolesForGuild)) {
            const days = parseInt(daysStr, 10);
            if (grantIf(days, roleId)) {
              try {
                const role = message.guild.roles.cache.get(roleId) || null;
                if (role && message.guild.members.me.permissions.has('ManageRoles')) {
                  await message.member.roles.add(role);
                  // notify user
                  await message.reply(`🎉 Milestone! You reached a ${days}-day streak and were awarded the role **${role.name}**.`);
                } else if (role) {
                  await message.reply(`🎉 Milestone reached (${days} days)! An admin needs to grant the role **${role.name}** because I lack Manage Roles permission.`);
                }
              } catch (e) {
                console.error('Failed to grant streak role', e);
              }
            }
          }
        }
      } catch (e) { console.error('streak role check failed', e); }

      return message.reply(`💪 You checked in for your workout today!\n🏆 Streak: **${economy[userId].streak} days**\n💰 Earned: **${totalReward} GymCoins** (Base ${baseReward} + Streak Bonus ${streakBonus})\nTotal: ${economy[userId].balance}`);
    } catch (e) {
      console.error('checkin error', e);
      return message.reply('Error checking in.');
    }
  }
};
