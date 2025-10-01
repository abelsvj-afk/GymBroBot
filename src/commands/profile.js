export default {
  name: 'profile',
  description: 'View a user\'s profile and economy stats',
  exampleArgs: '@user',
  notes: 'Optional mention to view another user. Shows balance, streaks, and achievements.',
  group: 'economy',
  slash: { group: 'economy', options: [{ name: 'user', type: 6, description: 'User to view', required: false }] },
  async execute(context, message, args) {
    try {
      const { storage, EmbedBuilder, fitnessWeekly, messageCounts, achievementsStore, client } = context;
      const targetUser = (message.mentions && message.mentions.users && message.mentions.users.first()) || message.author || (args && args[0]) || null;
      const userId = targetUser.id || (targetUser?.user && targetUser.user.id) || (typeof targetUser === 'string' ? targetUser : message.author.id);
      const user = await client.users.fetch(userId).catch(()=>null) || targetUser || message.author;

      const economy = await storage.load('economy', {});
      const econ = economy[userId] || { balance: 0, lastClaim: 0, lastCheckin: null, streak: 0 };
      const weekly = fitnessWeekly[userId] || { yes: 0, no: 0 };
      const msgs = messageCounts[userId] || 0;
      const achs = achievementsStore[userId] || [];

      // Attempt to use a Canvas implementation for a nicer card; prefer @napi-rs/canvas (prebuilt) then fallback to node-canvas
      let Canvas = null;
      try { Canvas = (await import('@napi-rs/canvas')).default || (await import('@napi-rs/canvas')); } catch (e) { Canvas = null; }
      if (!Canvas) {
        try { Canvas = (await import('canvas')).default || (await import('canvas')); } catch (e) { Canvas = null; }
      }

      if (Canvas) {
        try {
          const { createCanvas, loadImage } = Canvas;
          const width = 800, height = 300;
          const canvas = createCanvas(width, height);
          const ctx = canvas.getContext('2d');

          // Background
          ctx.fillStyle = '#0f1724';
          ctx.fillRect(0,0,width,height);

          // Accent bar
          ctx.fillStyle = '#1abc9c';
          ctx.fillRect(0,0,width,60);

          // Avatar circle
          const avatarUrl = user.displayAvatarURL ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
          if (avatarUrl) {
            try {
              const img = await loadImage(avatarUrl);
              const ax = 30, ay = 80, ar = 140;
              // circular clip
              ctx.save();
              ctx.beginPath();
              ctx.arc(ax+ar/2, ay+ar/2, ar/2, 0, Math.PI*2);
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(img, ax, ay, ar, ar);
              ctx.restore();
            } catch (e) { }
          }

          // Username
          ctx.fillStyle = '#ffffff';
          ctx.font = '28px Sans';
          ctx.fillText(user.username || 'Unknown', 200, 110);
          ctx.fillStyle = '#d1d5db';
          ctx.font = '18px Sans';
          ctx.fillText(`#${user.discriminator || '0000'}`, 200, 140);

          // Stats
          ctx.fillStyle = '#ffffff';
          ctx.font = '20px Sans';
          ctx.fillText(`GymCoins: ${econ.balance}`, 200, 180);
          ctx.fillText(`This week: ✅ ${weekly.yes || 0} • ❌ ${weekly.no || 0}`, 200, 210);
          ctx.fillText(`Streak: ${econ.streak || 0} days`, 200, 240);
          ctx.fillText(`Messages: ${msgs}`, 200, 270);

          // Achievements badges (text fallback)
          ctx.fillStyle = '#f59e0b';
          ctx.font = '16px Sans';
          const achText = achs.length ? achs.map(a => a.replace(/_/g,' ')).join(' • ') : 'No achievements yet';
          ctx.fillText(achText.slice(0, 120), 30, 295);

          const buffer = canvas.toBuffer('image/png');
          return message.reply({ files: [{ attachment: buffer, name: 'profile.png' }] });
        } catch (e) {
          console.error('canvas profile generation failed', e);
          // fallthrough to embed
        }
      }

      // Fallback embed
      const embed = new EmbedBuilder()
        .setTitle(`📇 Profile — ${user.username || message.author.username}`)
        .addFields(
          { name: '💰 GymCoins', value: `${econ.balance}`, inline: true },
          { name: '🏋️ This Week', value: `✅ ${weekly.yes || 0} workouts\n❌ ${weekly.no || 0} missed`, inline: true },
          { name: '🔥 Streak', value: `${econ.streak || 0} days`, inline: true },
          { name: '💬 Messages', value: `${msgs}`, inline: true },
          { name: '🏅 Achievements', value: achs.length ? achs.map(a=>a.replace(/_/g,' ')).join(', ') : 'None', inline: false }
        )
        .setColor(0x1abc9c)
        .setTimestamp(new Date());

      return message.reply({ embeds: [embed] });
    } catch (e) {
      console.error('profile command error', e);
      return message.reply('Error loading profile.');
    }
  }
};
