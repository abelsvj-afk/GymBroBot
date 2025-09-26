


// ------------------ Core Setup ------------------
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { OpenAI } = require('openai');
const cron = require('node-cron');
const axios = require('axios');
const express = require('express');

// ------------------ Express Keep-Alive Server ------------------
const app = express();
app.get('/', (req, res) => res.send('GymBotBro is alive!'));
app.listen(process.env.PORT || 3000, () => console.log('Server running'));

// ------------------ Environment Check ------------------
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "✅ Exists" : "❌ Missing");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ Exists" : "❌ Missing");
console.log("NEWS_API_KEY:", process.env.NEWS_API_KEY ? "✅ Exists" : "❌ Missing");
console.log("YOUTUBE_API_KEY:", process.env.YOUTUBE_API_KEY ? "✅ Exists" : "❌ Missing");

if (!process.env.DISCORD_TOKEN || !process.env.OPENAI_API_KEY) {
  console.error("Critical environment variables missing! Exiting...");
  process.exit(1);
}

// ------------------ Data Storage ------------------
const DATA_DIR = ".";
const DATA_FILES = {
  memory: path.join(DATA_DIR, "conversationmemory.json"),
  birthdays: path.join(DATA_DIR, "birthdays.json"),
  fitnessWeekly: path.join(DATA_DIR, "fitnessWeekly.json"),
  fitnessMonthly: path.join(DATA_DIR, "fitnessMonthly.json"),
  partnerQueue: path.join(DATA_DIR, "partnerQueue.json"),
  partners: path.join(DATA_DIR, "partners.json"),
  strikes: path.join(DATA_DIR, "strikes.json"),
  habits: path.join(DATA_DIR, "habits.json"),
  challenges: path.join(DATA_DIR, "challenges.json")
};

// Data storage objects
const memory = {};
const birthdays = {};
const fitnessWeekly = {};
const fitnessMonthly = {};
let partnerQueue = [];
const partners = {};
const strikes = {};
const habitTracker = {};
const challenges = {};

// Strike system configuration
const STRIKE_CONFIG = {
  warnCount: 1,
  muteCount: 2,
  endPartnerCount: 3,
  banCount: 4,
  muteDurationMs: 2 * 60 * 60 * 1000, // 2 hours
  exposureUnlocks: [5, 10, 15]
};

// ------------------ Data Management Functions ------------------
function loadData() {
  try {
    if (fs.existsSync(DATA_FILES.memory)) Object.assign(memory, JSON.parse(fs.readFileSync(DATA_FILES.memory, 'utf8')));
    if (fs.existsSync(DATA_FILES.birthdays)) Object.assign(birthdays, JSON.parse(fs.readFileSync(DATA_FILES.birthdays, 'utf8')));
    if (fs.existsSync(DATA_FILES.fitnessWeekly)) Object.assign(fitnessWeekly, JSON.parse(fs.readFileSync(DATA_FILES.fitnessWeekly, 'utf8')));
    if (fs.existsSync(DATA_FILES.fitnessMonthly)) Object.assign(fitnessMonthly, JSON.parse(fs.readFileSync(DATA_FILES.fitnessMonthly, 'utf8')));
    if (fs.existsSync(DATA_FILES.partnerQueue)) partnerQueue = JSON.parse(fs.readFileSync(DATA_FILES.partnerQueue, 'utf8'));
    if (fs.existsSync(DATA_FILES.partners)) Object.assign(partners, JSON.parse(fs.readFileSync(DATA_FILES.partners, 'utf8')));
    if (fs.existsSync(DATA_FILES.strikes)) Object.assign(strikes, JSON.parse(fs.readFileSync(DATA_FILES.strikes, 'utf8')));
    if (fs.existsSync(DATA_FILES.habits)) Object.assign(habitTracker, JSON.parse(fs.readFileSync(DATA_FILES.habits, 'utf8')));
    if (fs.existsSync(DATA_FILES.challenges)) Object.assign(challenges, JSON.parse(fs.readFileSync(DATA_FILES.challenges, 'utf8')));
    console.log("Data loaded successfully");
  } catch (e) {
    console.error("Error loading data:", e);
  }
}

// Save functions
function saveMemory() { try { fs.writeFileSync(DATA_FILES.memory, JSON.stringify(memory, null, 2)); } catch (e) { console.error("Save memory error:", e); } }
function saveBirthdays() { try { fs.writeFileSync(DATA_FILES.birthdays, JSON.stringify(birthdays, null, 2)); } catch (e) { console.error("Save birthdays error:", e); } }
function saveWeekly() { try { fs.writeFileSync(DATA_FILES.fitnessWeekly, JSON.stringify(fitnessWeekly, null, 2)); } catch (e) { console.error("Save weekly error:", e); } }
function saveMonthly() { try { fs.writeFileSync(DATA_FILES.fitnessMonthly, JSON.stringify(fitnessMonthly, null, 2)); } catch (e) { console.error("Save monthly error:", e); } }
function savePartnerQueue() { try { fs.writeFileSync(DATA_FILES.partnerQueue, JSON.stringify(partnerQueue, null, 2)); } catch (e) { console.error("Save queue error:", e); } }
function savePartners() { try { fs.writeFileSync(DATA_FILES.partners, JSON.stringify(partners, null, 2)); } catch (e) { console.error("Save partners error:", e); } }
function saveStrikes() { try { fs.writeFileSync(DATA_FILES.strikes, JSON.stringify(strikes, null, 2)); } catch (e) { console.error("Save strikes error:", e); } }
function saveHabits() { try { fs.writeFileSync(DATA_FILES.habits, JSON.stringify(habitTracker, null, 2)); } catch (e) { console.error("Save habits error:", e); } }
function saveChallenges() { try { fs.writeFileSync(DATA_FILES.challenges, JSON.stringify(challenges, null, 2)); } catch (e) { console.error("Save challenges error:", e); } }

// ------------------ Helper Functions ------------------
function ensureStrikeRecord(guildId, userId) {
  if (!strikes[guildId]) strikes[guildId] = {};
  if (!strikes[guildId][userId]) strikes[guildId][userId] = { count: 0, history: [], blockedFromMatching: false, mutedUntil: null };
  return strikes[guildId][userId];
}

function isModeratorMember(member) {
  try {
    return member.permissions.has(PermissionsBitField.Flags.ManageMessages);
  } catch {
    return false;
  }
}

async function notifyLoggingChannel(guild, content) {
  const logChannel = guild.channels.cache.find(ch => 
    (ch.name || "").toLowerCase().includes("log") || (ch.name || "").toLowerCase() === "mod-logs"
  );
  if (logChannel) {
    try {
      if (typeof content === "string") {
        await logChannel.send(content);
      } else {
        await logChannel.send({ embeds: [content] });
      }
    } catch (e) {
      console.error("Log channel send error:", e);
    }
  }
}

// ------------------ Discord Client Setup ------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// ------------------ OpenAI Setup ------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------------------ OpenAI wrapper ------------------
async function getOpenAIResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 450,
    });
    return response.choices[0].message.content.trim();
  } catch (e) {
    console.error("OpenAI error:", e?.response?.data || e.message);
    return "Sorry, something went wrong with AI.";
  }
}

// ------------------ External API Functions ------------------
async function getRandomFitnessVideos(count = 2) {
  const fitnessQueries = [
    "men's mobility workout",
    "stretching for men mobility",
    "calisthenics for men",
    "bodybuilding strength training men",
    "home muscle building men",
    "ab workout men",
    "hybrid athlete men's running training",
    "leg training for runners injury prevention"
  ];

  try {
    if (!process.env.YOUTUBE_API_KEY) return ["YouTube API key not configured"];
    
    const { google } = require('googleapis');
    const youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });
    
    const q = fitnessQueries[Math.floor(Math.random() * fitnessQueries.length)];
    const res = await youtube.search.list({
      part: "snippet",
      q,
      maxResults: 10,
      type: "video",
      relevanceLanguage: "en",
    });
    
    const items = res.data.items || [];
    if (!items.length) return ["No fitness videos found today."];
    
    const shuffled = items.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).map(i => `🏋️‍♂️ ${i.snippet.title}\nhttps://www.youtube.com/watch?v=${i.id.videoId}`);
  } catch (e) {
    console.error("YouTube error:", e.message);
    return ["Error fetching videos from YouTube."];
  }
}

async function getHealthNews() {
  if (!process.env.NEWS_API_KEY) return "No News API key provided.";
  try {
    const res = await axios.get(
      `https://newsapi.org/v2/top-headlines?category=health&language=en&apiKey=${process.env.NEWS_API_KEY}`
    );
    const top = res.data.articles?.[0];
    return top
      ? `🩺 **${top.title}**\n${top.description || ""}\n${top.url}`
      : "No health news today.";
  } catch (e) {
    console.error("News error:", e.message);
    return "Could not fetch health news.";
  }
}

// ------------------ Leaderboard Functions ------------------
function buildLeaderboardMessage() {
  let leaderboardMsg = "**   Fitness Leaderboard (Daily Snapshot)   **\n\n";
  const sorted = Object.entries(fitnessMonthly).sort(
    (a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no)
  );
  if (sorted.length === 0) leaderboardMsg += "No data yet.";
  sorted.forEach(([uid, data], idx) => {
    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
    const flair = idx < 3 ? medals[idx] : "  ";
    const weeklyCount = fitnessWeekly[uid] ? fitnessWeekly[uid].yes : 0;
    leaderboardMsg += `${flair} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no} (Weekly: ✅${weeklyCount})\n`;
  });
  return leaderboardMsg;
}

async function updateLeaderboardChannel() {
  const leaderboardChannel = client.channels.cache.find(ch => (ch.name || "").toLowerCase() === "leaderboard");
  if (!leaderboardChannel) return;
  const msg = buildLeaderboardMessage();
  try {
    try {
      await leaderboardChannel.bulkDelete(10);
    } catch (e) {
      /* ignore */
    }
    await leaderboardChannel.send({ content: msg });
  } catch (e) {
    console.error("updateLeaderboardChannel error:", e);
  }
}

// ------------------ Partner System Functions ------------------
async function findOrCreateAccountabilityCategory(guild) {
  const existing = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && (c.name || "").toLowerCase() === "accountability partners"
  );
  if (existing) return existing;
  try {
    const cat = await guild.channels.create({
      name: "Accountability Partners",
      type: ChannelType.GuildCategory,
      reason: "Create category for accountability partner private channels"
    });
    return cat;
  } catch (e) {
    console.error("Error creating category:", e);
    return null;
  }
}

async function createPartnerChannel(guild, userAId, userBId, options = {}) {
  try {
    const category = await findOrCreateAccountabilityCategory(guild);
    const userA = await guild.members.fetch(userAId).catch(() => null);
    const userB = await guild.members.fetch(userBId).catch(() => null);
    
    const safeName = `partner-${userA ? userA.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0,8) : userAId.slice(0,6)}-${userB ? userB.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0,8) : userBId.slice(0,6)}`.slice(0,90);
    
    const modRole = guild.roles.cache.find(r => {
      try { return r.permissions.has && r.permissions.has(PermissionsBitField.Flags.ManageMessages); } catch { return false; }
    });

    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: userAId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: userBId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] },
    ];
    
    if (modRole) permissionOverwrites.push({ 
      id: modRole.id, 
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] 
    });

    const channel = await guild.channels.create({
      name: safeName,
      type: ChannelType.GuildText,
      parent: category ? category.id : undefined,
      permissionOverwrites
    });

    partners[channel.id] = {
      users: [userAId, userBId],
      createdAt: new Date().toISOString(),
      type: options.type || "goal",
      exposureLevel: 0,
      hiddenInfo: options.hiddenInfo || {},
      blocked: false,
      checkins: 0
    };
    savePartners();

    try { (await client.users.fetch(userAId)).send(`✅ You were paired with <@${userBId}>. Private channel: ${channel.toString()}`); } catch {}
    try { (await client.users.fetch(userBId)).send(`✅ You were paired with <@${userAId}>. Private channel: ${channel.toString()}`); } catch {}

    const rulesEmbed = new EmbedBuilder()
      .setTitle("Welcome to your Accountability Channel")
      .setDescription(`Welcome <@${userAId}> and <@${userBId}>!\nThis channel is private between the two of you and moderators. Follow the rules pinned here.\nType \`!endpartner\` to end this pairing when you're done.`)
      .addFields(
        { name: "Guidelines", value: "Be kind • Encourage • Respect personal boundaries" },
        { name: "Important", value: "**No contacting each other outside this channel. Violations will be removed and may result in strikes or ban.**" },
      )
      .setColor(0x00AE86)
      .setTimestamp();

    const msg = await channel.send({ embeds: [rulesEmbed] });
    try { await msg.pin(); } catch {}

    return channel;
  } catch (e) {
    console.error("createPartnerChannel error:", e);
    return null;
  }
}

async function endPartnerChannel(channelObj, reason = "User requested end") {
  try {
    if (!partners[channelObj.id]) return false;
    const users = partners[channelObj.id].users || [];
    delete partners[channelObj.id];
    savePartners();
    for (const uid of users) {
      try { (await client.users.fetch(uid)).send(`Your accountability pairing in ${channelObj.name} has been ended. Reason: ${reason}`); } catch {}
    }
    await channelObj.delete(`Partner ended: ${reason}`).catch(e => console.error("Failed to delete partner channel:", e.message));
    return true;
  } catch (e) {
    console.error("endPartnerChannel error:", e);
    return false;
  }
}

// ------------------ Strike System ------------------
async function applyStrike({ guild, userId, issuerId = null, reason = "Violation", channel = null, immediateBan = false }) {
  try {
    const guildId = guild.id;
    const sr = ensureStrikeRecord(guildId, userId);
    const time = new Date().toISOString();

    if (immediateBan) {
      sr.count += 1;
      sr.history.push({ time, reason: `${reason} (Immediate ban)`, issuer: issuerId });
      sr.blockedFromMatching = true;
      saveStrikes();
      try { (await client.users.fetch(userId)).send(`You have been banned from ${guild.name} for violating partner contact rules: ${reason}`); } catch {}
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          await guild.members.ban(userId, { reason: `Immediate ban: ${reason}` });
        } else {
          await notifyLoggingChannel(guild, `❗ Tried to ban <@${userId}> but missing BanMembers permission.`);
        }
      } catch (e) {
        console.error("Immediate ban failed:", e);
      }
      const embed = new EmbedBuilder().setTitle("Immediate Ban Executed")
        .setDescription(`<@${userId}> was banned for contacting partner outside private channel.\nReason: ${reason}`)
        .setColor(0xff0000)
        .setTimestamp();
      await notifyLoggingChannel(guild, embed);
      return;
    }

    sr.count += 1;
    sr.history.push({ time, reason, issuer: issuerId, channelId: channel ? channel.id : null });
    saveStrikes();

    if (sr.count >= STRIKE_CONFIG.warnCount && sr.count < STRIKE_CONFIG.muteCount) {
      try { (await client.users.fetch(userId)).send(`⚠️ Warning in ${guild.name}: ${reason}\nThis is strike ${sr.count}. Repeated violations will escalate.`); } catch {}
      const embed = new EmbedBuilder().setTitle("Strike Issued")
        .setDescription(`<@${userId}> has been issued a warning (strike ${sr.count}).\nReason: ${reason}`)
        .setColor(0xffa500)
        .setTimestamp();
      await notifyLoggingChannel(guild, embed);
    }

    if (sr.count >= STRIKE_CONFIG.muteCount && sr.count < STRIKE_CONFIG.endPartnerCount) {
      let mutedRole = guild.roles.cache.find(r => r.name === "Muted");
      if (!mutedRole) {
        try { mutedRole = await guild.roles.create({ name: "Muted", reason: "Create muted role for strikes" }); } catch (e) { console.error("Could not create Muted role:", e); mutedRole = null; }
      }
      if (mutedRole) {
        for (const [id, ch] of guild.channels.cache) {
          try { if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice) await ch.permissionOverwrites.edit(mutedRole, { SendMessages: false, AddReactions: false }, { reason: "Mute role update for strikes" }); } catch {}
        }
      }
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && mutedRole) {
          await member.roles.add(mutedRole, `Temporary mute - strike ${sr.count}`);
          sr.mutedUntil = Date.now() + STRIKE_CONFIG.muteDurationMs;
          saveStrikes();
          try { (await client.users.fetch(userId)).send(`⏳ You have been temporarily muted in ${guild.name} for ${STRIKE_CONFIG.muteDurationMs / (60*60*1000)} hours due to: ${reason}`); } catch {}
          await notifyLoggingChannel(guild, `🔇 <@${userId}> muted for ${STRIKE_CONFIG.muteDurationMs/1000/60/60}h (strike ${sr.count}).`);
        }
      } catch (e) { console.error("Mute assignment error:", e); }
    }

    if (sr.count >= STRIKE_CONFIG.endPartnerCount && sr.count < STRIKE_CONFIG.banCount) {
      sr.blockedFromMatching = true;
      saveStrikes();
      for (const [chanId, meta] of Object.entries(partners)) {
        if (meta.users && meta.users.includes(userId)) {
          const ch = await client.channels.fetch(chanId).catch(() => null);
          if (ch) await endPartnerChannel(ch, `Ended due to repeated violations by <@${userId}>`);
          else { delete partners[chanId]; savePartners(); }
        }
      }
      await notifyLoggingChannel(
        guild,
        new EmbedBuilder().setTitle("Partner Ended & Blocked")
        .setDescription(`<@${userId}> had partner channels ended and is blocked from future matching (strike ${sr.count}).`)
        .setColor(0xff4500)
        .setTimestamp()
      );
      try { (await client.users.fetch(userId)).send(`⛔ Your partner pairing(s) have been ended and you are blocked from future pairings due to repeated violations.`); } catch {}
    }

    if (sr.count >= STRIKE_CONFIG.banCount) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
          await guild.members.ban(userId, { reason: `Reached strike threshold (${sr.count}).` });
          await notifyLoggingChannel(guild, new EmbedBuilder().setTitle("User Banned")
            .setDescription(`<@${userId}> was banned for reaching ${sr.count} strikes.`)
            .setColor(0xff0000)
            .setTimestamp());
        } else await notifyLoggingChannel(guild, `Attempted ban for <@${userId}> but missing permission.`);
      } catch (e) { console.error("Ban attempt error:", e); }
    }
  } catch (e) { console.error("applyStrike error:", e); }
}

// ------------------ Command Handlers ------------------
const commandHandlers = {
  // !test
  async test(message) {
    try {
      const videos = await getRandomFitnessVideos(2);
      if (!videos || !Array.isArray(videos) || videos.length === 0) return message.reply("No content found for testing.");
      for (const v of videos) await message.channel.send(v);
    } catch (e) {
      console.error("!test error:", e);
      return message.reply("Error running test.");
    }
  },

  // !leaderboard
  async leaderboard(message, channelName) {
    if (channelName !== "leaderboard") return message.reply("Please run `!leaderboard` in the #leaderboard channel only.");
    try {
      const msg = buildLeaderboardMessage();
      return message.channel.send({ content: msg });
    } catch (e) {
      console.error("!leaderboard error:", e);
      return message.reply("Error generating leaderboard.");
    }
  },

  // !coach
  async coach(message, args) {
    const raw = args.join(" ").trim();
    const topic = raw || "motivation and accountability for daily goals";
    const coachPersona = `
You are GymBotBro's Coach persona. Blend three tones:
1) The disciplined coach (clear, strategic, action-oriented),
2) The motivational speaker (energetic, encouraging, vivid),
3) The empathetic friend (understanding, human, warms failure into growth).
User request: "${topic}"
Keep response concise (6-10 sentences), include 2 quick action steps the user can do today, one small affirmation line, and a short practical tip about staying consistent with habits.
Do not lecture. Be direct, positive, and human. Use occasional emojis but not more than 3.
`;
    try {
      const coachReply = await getOpenAIResponse(coachPersona);
      return message.reply(coachReply);
    } catch (e) {
      console.error("!coach error:", e);
      return message.reply("Coach is offline right now. Try again soon.");
    }
  },

  // !progress
  async progress(message) {
    try {
      const authorId = message.author.id;
      const weekly = fitnessWeekly[authorId] || { yes: 0, no: 0 };
      const monthly = fitnessMonthly[authorId] || { yes: 0, no: 0 };
      const streak = weekly.yes - weekly.no;
      const reply = `   **Your Progress**
Weekly → ✅ ${weekly.yes} | ❌ ${weekly.no}
Monthly → ✅ ${monthly.yes} | ❌ ${monthly.no}
Streak (weekly yes - no): ${streak}
Keep going — consistency builds results!`;
      return message.reply(reply);
    } catch (e) {
      console.error("!progress error:", e);
      return message.reply("Couldn't fetch your progress right now.");
    }
  },

  // !addhabit
  async addhabit(message, args) {
    const habit = args.join(" ").trim();
    if (!habit) return message.reply("Usage: `!addhabit [habit name]`");
    
    const authorId = message.author.id;
    if (!habitTracker[authorId]) habitTracker[authorId] = {};
    if (habitTracker[authorId][habit]) return message.reply("You already have this habit tracked!");
    
    habitTracker[authorId][habit] = { streak: 0, lastChecked: null, total: 0 };
    saveHabits();
    return message.reply(`Added habit: "${habit}". Use \`!check ${habit}\` to track it daily!`);
  },

  // !check
  async check(message, args) {
    const habit = args.join(" ").trim();
    const authorId = message.author.id;
    
    if (!habitTracker[authorId] || !habitTracker[authorId][habit]) {
      return message.reply("Habit not found. Use `!addhabit [habit]` first.");
    }
    
    const today = new Date().toDateString();
    const habitData = habitTracker[authorId][habit];
    
    if (habitData.lastChecked === today) {
      return message.reply("Already checked off today!");
    }
    
    habitData.lastChecked = today;
    habitData.streak += 1;
    habitData.total += 1;
    saveHabits();
    
    return message.reply(`${habit} checked! Streak: ${habitData.streak} days`);
  },

  // !habits
  async habits(message) {
    const authorId = message.author.id;
    if (!habitTracker[authorId] || Object.keys(habitTracker[authorId]).length === 0) {
      return message.reply("No habits tracked yet. Use `!addhabit [habit]` to start!");
    }
    
    let msg = `**Your Habits:**\n`;
    Object.entries(habitTracker[authorId]).forEach(([habit, data]) => {
      const today = new Date().toDateString();
      const checkedToday = data.lastChecked === today ? " ✅" : "";
      msg += `• ${habit}: ${data.streak} day streak (${data.total} total)${checkedToday}\n`;
    });
    return message.reply(msg);
  },

  // !findpartner
  async findpartner(message) {
    try {
      if (!message.guild) return message.reply("This command must be used from your server, not DMs.");
      
      const authorId = message.author.id;
      // Check if already paired
      const alreadyPaired = Object.values(partners).some(p => p.users && p.users.includes(authorId));
      if (alreadyPaired) return message.reply("You already have an active accountability partner. Use `!endpartner` to end it first.");
      if (partnerQueue.some(q => q.id === authorId)) return message.reply("You're already in the partner queue.");
      
      // DM prompt to choose goal or future
      try {
        const dm = await message.author.send("Which partner type would you like? Reply with `goal` or `future`. Type `cancel` to cancel.");
        await message.reply("I sent you a DM to choose your partner type. Reply there with `goal` or `future` (or `cancel`).");
        const filter = m => m.author.id === authorId;
        const collected = await dm.channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
        let selection = "goal";
        if (collected && collected.first()) {
          const resp = collected.first().content.toLowerCase();
          if (resp.startsWith("future")) selection = "future";
          if (resp.startsWith("cancel")) return dm.channel.send("Partner request cancelled.");
        } else {
          await dm.channel.send("No response received — added to queue as Goal Partner by default.");
        }
        partnerQueue.push({ id: authorId, type: selection, joinedAt: new Date().toISOString() });
        savePartnerQueue();
        await dm.channel.send(`You've been added to the partner queue as **${selection}**. Standby.`);
        await message.channel.send("You're added to the partner queue (check your DMs).");
      } catch (e) {
        // Fallback: add as goal
        partnerQueue.push({ id: authorId, type: "goal", joinedAt: new Date().toISOString() });
        savePartnerQueue();
        return message.reply("Couldn't DM you — you've been added to the queue as a Goal Partner.");
      }
    } catch (e) {
      console.error("!findpartner error:", e);
      return message.reply("Something went wrong trying to find a partner. Try again later.");
    }
  },

  // !cancelpartner
  async cancelpartner(message) {
    const authorId = message.author.id;
    const idx = partnerQueue.findIndex(x => x.id === authorId);
    if (idx === -1) return message.reply("You're not in the partner queue.");
    partnerQueue.splice(idx, 1);
    savePartnerQueue();
    return message.reply("You've been removed from the partner queue.");
  },

  // !endpartner
  async endpartner(message) {
    try {
      const authorId = message.author.id;
      const entry = Object.entries(partners).find(([chanId, info]) => info.users.includes(authorId));
      if (!entry) return message.reply("You don't appear to have an active partner channel.");
      const [chanId] = entry;
      const channelObj = message.guild.channels.cache.get(chanId) || await client.channels.fetch(chanId).catch(() => null);
      if (!channelObj) {
        delete partners[chanId];
        savePartners();
        return message.reply("Partner channel not found. Your pairing has been cleared.");
      }
      await endPartnerChannel(channelObj, `Ended by user ${message.author.tag}`);
      return message.reply("Your accountability pairing has been ended and the private channel has been removed.");
    } catch (e) {
      console.error("!endpartner error:", e);
      return message.reply("Something went wrong trying to end your partner pairing.");
    }
  },

  // !setgoal
  async setgoal(message, args) {
    const goalNumber = parseInt(args[0]);
    if (isNaN(goalNumber) || goalNumber <= 0) {
      return message.reply("Please provide a valid number for your weekly workout goal, e.g., `!setgoal 5`.");
    }

    const authorId = message.author.id;
    if (!memory.goals) memory.goals = {};
    memory.goals[authorId] = goalNumber;
    saveMemory();

    return message.reply(`✅ Your weekly workout goal has been set to **${goalNumber}** workouts! Use \`!goal\` to track your progress.`);
  },

  // !goal
  async goal(message) {
    const authorId = message.author.id;
    const goal = memory.goals?.[authorId];
    if (!goal) return message.reply("No goal set. Use `!setgoal [number]` to set a weekly workout goal.");

    const current = fitnessWeekly[authorId]?.yes || 0;
    const percent = Math.min(Math.round((current / goal) * 100), 100);
    const completed = Math.floor(percent / 10);
    const remaining = 10 - completed;
    const bar = "█".repeat(completed) + "░".repeat(remaining);

    // Status + message setup
    let statusEmoji = "🏋️";  // default
    let message_text = "";

    if (percent >= 100) {
      statusEmoji = "🏆";
      message_text = " - GOAL CRUSHED! 💯";
    } else if (percent >= 80) {
      statusEmoji = "🔥";
      message_text = " - Almost there!";
    } else if (percent >= 50) {
      statusEmoji = "⚡";
      message_text = " - Keep pushing!";
    } 

    return message.reply(`${statusEmoji} **Weekly Goal Progress**
${current}/${goal} workouts (${percent}%)${message_text}
[${bar}]`);
  },

  // !quote
  async quote(message) {
    const quotes = [
      "Discipline is choosing between what you want now and what you want most.",
      "The cave you fear to enter holds the treasure you seek.",
      "You are one workout away from a good mood.",
      "Champions train, losers complain.",
      "Your only competition is who you were yesterday.",
      "Excellence is not a skill, it's an attitude.",
      "Pain is temporary, quitting lasts forever.",
      "The body achieves what the mind believes.",
      "Strength doesn't come from comfort zones.",
      "Every rep counts, every day matters."
    ];
    
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return message.reply(`   ${quote}`);
  },

  // !stats
  async stats(message) {
    const authorId = message.author.id;
    const weekly = fitnessWeekly[authorId] || { yes: 0, no: 0 };
    const monthly = fitnessMonthly[authorId] || { yes: 0, no: 0 };
    const habits = habitTracker[authorId] || {};

    // Calculate position in leaderboard
    const sorted = Object.entries(fitnessMonthly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    const position = sorted.findIndex(([uid]) => uid === authorId) + 1;

    let msg = `🏆 **${message.author.username}'s Stats** \n`;

    msg += `**Fitness:**\n`;
    msg += `• This week: ✅${weekly.yes} ❌${weekly.no}\n`;
    msg += `• This month: ✅${monthly.yes} ❌${monthly.no}\n`;
    msg += `• Success rate: ${monthly.yes + monthly.no > 0 ? Math.round((monthly.yes / (monthly.yes + monthly.no)) * 100) : 0}%\n`;
    msg += `• Leaderboard position: ${position > 0 ? `#${position}` : 'Unranked'}\n\n`;

    if (Object.keys(habits).length > 0) {
      msg += `**Habits:**\n`;
      Object.entries(habits).forEach(([habit, data]) => {
        const today = new Date().toDateString();
        const checkedToday = data.lastChecked === today ? " ✅" : "";
        msg += `• ${habit}: ${data.streak} day streak (${data.total} total)${checkedToday}\n`;
      });
    } else {
      msg += `**Habits:** None tracked yet. Use \`!addhabit [habit]\` to start!\n`;
    }

    // Show active challenges
    const userChallenges = Object.entries(challenges).filter(([id, chal]) =>
      chal.participants.includes(authorId) && chal.guildId === message.guild?.id
    );

    if (userChallenges.length > 0) {
      msg += `\n**Active Challenges:** ${userChallenges.length}\n`;
      userChallenges.slice(0, 3).forEach(([id, chal]) => {
        msg += `• ${chal.name}\n`;
      });
    }

    return message.reply(msg);
  },

  // !challenge create
  async challengeCreate(message, args) {
    const member = await message.guild?.members.fetch(message.author.id).catch(() => null);
    if (!member || !isModeratorMember(member)) {
      return message.reply("Only moderators can create challenges.");
    }

    const challengeText = args.join(" ").trim();
    if (!challengeText) return message.reply("Usage: `!challenge create [challenge description]`");

    const challengeId = Date.now().toString();
    challenges[challengeId] = {
      name: challengeText,
      participants: [],
      createdAt: new Date().toISOString(),
      createdBy: message.author.id,
      guildId: message.guild.id
    };
    saveChallenges();

    const embed = new EmbedBuilder()
      .setTitle("🏆 NEW CHALLENGE CREATED!")
      .setDescription(challengeText)
      .setColor(0x00AE86)
      .setFooter({ text: `React with 💪 to join! ID: ${challengeId}` });

    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react('💪');
  },

  // !challenge join
  async challengeJoin(message, args) {
    const challengeId = args[0];
    const challenge = challenges[challengeId];

    if (!challenge) return message.reply("Challenge not found. Use `!challenges` to see active challenges.");
    if (challenge.participants.includes(message.author.id)) return message.reply("You're already in this challenge!");

    challenge.participants.push(message.author.id);
    saveChallenges();
    return message.reply(`You've joined the challenge: "${challenge.name}"! Good luck!`);
  },

  // !challenges
  async challenges(message) {
    const guildChallenges = Object.entries(challenges).filter(([id, chal]) =>
      chal.guildId === message.guild?.id
    );

    if (!guildChallenges.length) return message.reply("No active challenges.");

    let msg = `🏆 Active Challenges:\n`;
    guildChallenges.forEach(([id, chal]) => {
      msg += `• **${chal.name}** (${chal.participants.length} participants) - ID: ${id}\n`;
    });
    msg += `\nUse \`!challenge join [ID]\` to join a challenge!`;

    return message.reply(msg);
  },

  // !workoutplan
  async workoutplan(message, args) {
    const type = args[0]?.toLowerCase();
    const plans = {
      push: `**Push Day:**
• Push-ups: 3x12
• Pike Push-ups: 3x8
• Tricep Dips: 3x10
• Plank: 3x30s
• Diamond Push-ups: 2x8`,
      pull: `**Pull Day:**
• Pull-ups: 3x5-8
• Inverted Rows: 3x10
• Face Pulls: 3x12
• Dead Hang: 3x20s
• Bicep Curls: 3x12`,
      legs: `**Leg Day:**
• Squats: 3x15
• Lunges: 3x10 each leg
• Calf Raises: 3x15
• Wall Sit: 3x30s
• Bulgarian Split Squats: 2x8 each`,
      cardio: `**Cardio:**
• 20min run/walk
• Burpees: 3x5
• Jumping Jacks: 3x20
• High Knees: 3x30s
• Mountain Climbers: 3x15`,
      core: `**Core:**
• Plank: 3x45s
• Crunches: 3x20
• Russian Twists: 3x15
• Leg Raises: 3x12
• Dead Bug: 2x10 each`
    };

    if (plans[type]) {
      return message.reply(`${plans[type]}\n\n*Adjust reps based on your level. Rest 60-90s between sets.*`);
    } else {
      return message.reply("Available plans: `!workoutplan push/pull/legs/cardio/core`");
    }
  },

  // !resetprogress
  async resetprogress(message) {
    try {
      const authorId = message.author.id;
      fitnessWeekly[authorId] = { yes: 0, no: 0 };
      fitnessMonthly[authorId] = { yes: 0, no: 0 };
      saveWeekly();
      saveMonthly();
      return message.reply("Your weekly and monthly progress has been reset. Fresh start   ");
    } catch (e) {
      console.error("!resetprogress error:", e);
      return message.reply("Couldn't reset your progress right now.");
    }
  },

  // !setbirthday
  async setbirthday(message, args) {
    const date = args[0];
    if (!date || !/^\d{2}-\d{2}$/.test(date)) return message.reply("Please provide your birthday in MM-DD format, e.g., `setbirthday 09-23`");
    birthdays[message.author.id] = `${new Date().getFullYear()}-${date}`;
    saveBirthdays();
    return message.reply(`Got it! Your birthday has been saved as ${date}.   `);
  },

  // !birthdays
  async birthdays(message, channelName) {
    if (channelName !== "general") return message.reply("You can only run `!birthdays` in the #general channel.");
    const entries = Object.entries(birthdays);
    if (!entries.length) return message.channel.send("No birthdays stored yet.");
    let out = "**Saved Birthdays:**\n";
    entries.forEach(([uid, d]) => out += `<@${uid}> → ${d}\n`);
    return message.channel.send({ content: out });
  },

  // Moderator commands
  async strike(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this command.");

      const mention = message.mentions.users.first();
      if (!mention)
        return await message.reply("Please mention a user to strike: `!strike @user [reason]`");

      const reason = args.slice(1).join(" ") || "Violation";

      await applyStrike({
        guild: message.guild,
        userId: mention.id,
        issuerId: message.author.id,
        reason,
        channel: message.channel,
      });

      return await message.reply(`Strike applied to <@${mention.id}> for: ${reason}`);
    } catch (e) {
      console.error("!strike error:", e);
      return await message.reply("Couldn't apply strike. Check bot permissions.");
    }
  },

  async strikes(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this command.");

      const mention = message.mentions.users.first();
      if (!mention) return await message.reply("Please mention a user: `!strikes @user`");

      const rec = strikes[message.guild.id]?.[mention.id] ?? { count: 0, history: [] };

      let out = `⚖️ Strikes for <@${mention.id}>: ${rec.count}\nRecent history:\n`;
      rec.history.slice(-10).forEach(
        (h) => (out += `- ${h.time}: ${h.reason} (by ${h.issuer ? `<@${h.issuer}>` : "system"})\n`)
      );

      return await message.reply(out);
    } catch (e) {
      console.error("!strikes error:", e);
      return await message.reply("Couldn't fetch strikes.");
    }
  },

  async clearstrikes(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this command.");

      const mention = message.mentions.users.first();
      if (!mention) return await message.reply("Please mention a user: `!clearstrikes @user`");

      if (strikes[message.guild.id]?.[mention.id]) {
        delete strikes[message.guild.id][mention.id];
        saveStrikes();
        await notifyLoggingChannel(
          message.guild,
          `✅ <@${mention.id}>'s strikes cleared by <@${message.author.id}>.`
        );
        return await message.reply(`Strikes for <@${mention.id}> cleared.`);
      } else {
        return await message.reply("User has no strikes recorded.");
      }
    } catch (e) {
      console.error("!clearstrikes error:", e);
      return await message.reply("Couldn't clear strikes.");
    }
  },

  async blockpair(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this command.");

      const mention = message.mentions.users.first();
      if (!mention) return await message.reply("Please mention a user: `!blockpair @user`");

      const rec = ensureStrikeRecord(message.guild.id, mention.id);
      rec.blockedFromMatching = true;
      saveStrikes();

      return await message.reply(`<@${mention.id}> has been blocked from future pairings.`);
    } catch (e) {
      console.error("!blockpair error:", e);
      return await message.reply("Couldn't block user from pairing.");
    }
  },

  async unblockpair(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this command.");

      const mention = message.mentions.users.first();
      if (!mention) return await message.reply("Please mention a user: `!unblockpair @user`");

      const rec = ensureStrikeRecord(message.guild.id, mention.id);
      rec.blockedFromMatching = false;
      saveStrikes();

      return await message.reply(`<@${mention.id}> has been unblocked for future pairings.`);
    } catch (e) {
      console.error("!unblockpair error:", e);
      return await message.reply("Couldn't unblock user from pairing.");
    }
  },

  async teststrike(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this test.");

      const mention = message.mentions.users.first();
      if (!mention) return await message.reply("Please mention a user: `!teststrike @user`");

      await applyStrike({
        guild: message.guild,
        userId: mention.id,
        issuerId: message.author.id,
        reason: "Test strike",
      });

      return await message.reply(`Test strike applied to <@${mention.id}>.`);
    } catch (e) {
      console.error("!teststrike error:", e);
      return await message.reply("Test strike failed.");
    }
  },

  async testpair(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this test.");

      const mentions = message.mentions.users.map((u) => u.id);
      if (!mentions || mentions.length < 2)
        return await message.reply("Please mention two users: `!testpair @user1 @user2`");

      const ch = await createPartnerChannel(message.guild, mentions[0], mentions[1], { type: "goal" });
      return await message.reply(`Test pairing created: ${ch ? ch.toString() : "failed"}`);
    } catch (e) {
      console.error("!testpair error:", e);
      return await message.reply("Test pair failed.");
    }
  },

  async testdata(message) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this test.");

      const dataStatus = {
        memory: Object.keys(memory).length,
        birthdays: Object.keys(birthdays).length,
        fitnessWeekly: Object.keys(fitnessWeekly).length,
        fitnessMonthly: Object.keys(fitnessMonthly).length,
        partnerQueue: partnerQueue.length,
        partners: Object.keys(partners).length,
        strikes: Object.keys(strikes).length,
        habitTracker: Object.keys(habitTracker).length,
        challenges: Object.keys(challenges).length
      };
      return message.reply(`Data status:\n${JSON.stringify(dataStatus, null, 2)}`);
    } catch (e) {
      console.error("!testdata error:", e);
      return message.reply("Error checking data status.");
    }
  },

  async testhabits(message) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member))
        return await message.reply("You must be a moderator to run this test.");

      const authorId = message.author.id;
      if (!habitTracker[authorId]) habitTracker[authorId] = {};
      habitTracker[authorId]["test-habit"] = { streak: 3, lastChecked: new Date().toDateString(), total: 10 };
      saveHabits();
      return message.reply("Test habit created! Check with `!habits`");
    } catch (e) {
      console.error("!testhabits error:", e);
      return message.reply("Error creating test habit.");
    }
  },

  async checkinTest(message, channelName) {
    if (channelName !== "daily-check-ins") return message.reply("Please run `!checkin-test` in the #daily-check-ins channel for safety.");
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member)) return message.reply("You must be a moderator to run this test.");
    } catch (e) {
      console.error("!checkin-test member fetch error:", e);
      return message.reply("Error verifying moderator status.");
    }

    const leaderboardChannel = client.channels.cache.find(ch => (ch.name || "").toLowerCase() === "leaderboard");
    if (!leaderboardChannel) return message.reply("No #leaderboard channel found.");

    const sorted = Object.entries(fitnessWeekly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    let msg = `   WEEKLY FITNESS TEST DUMP   \n`;
    msg += `\n   Weekly Top 5 (TEST):\n`;

    if (sorted.length) msg += `   <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += `\n   Weekly Top 5 (TEST):\n`;

    const medals = ["  ", "  ", "  ", "  ️", "  "];
    sorted.slice(0, 5).forEach(([uid, data], idx) => {
      msg += `${medals[idx] || "  "} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`;
    });

    try { await leaderboardChannel.send({ content: msg }); } catch (e) { console.error("!checkin-test send error:", e); }

    // Reset weekly fitness
    for (const uid in fitnessWeekly) fitnessWeekly[uid] = { yes: 0, no: 0 };
    saveWeekly();

    message.reply("Check-in test completed: weekly snapshot posted to #leaderboard and weekly data reset.");
  }
};

// ------------------ Message Event Handler ------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const guild = message.guild;
  const channel = message.channel;
  const authorId = message.author.id;
  const channelName = ((channel.name || "") + "").toLowerCase();

  // Memory tracking
  if (!memory[channelName]) memory[channelName] = {};
  if (!memory[channelName][authorId]) memory[channelName][authorId] = [];
  memory[channelName][authorId].push(message.content);
  saveMemory();

  // ------------------ Strict Detection: Partner Contact Outside Channel ------------------
  try {
    if (guild && partners) {
      const partnerEntry = Object.entries(partners).find(([chanId, meta]) => meta.users && meta.users.includes(authorId));
      if (partnerEntry) {
        const [partnerChanId, meta] = partnerEntry;
        const otherUserId = meta.users.find(u => u !== authorId);
        // If message not in partner channel and mentions or contains partner ID -> immediate ban
        if (channel.id !== partnerChanId) {
          const mentionsPartner = message.mentions.users.has(otherUserId);
          const containsPartnerId = otherUserId && message.content.includes(otherUserId);
          if (mentionsPartner || containsPartnerId) {
            try { await message.delete(); } catch {}
            await applyStrike({ guild, userId: authorId, issuerId: client.user.id, reason: `Contacted partner <@${otherUserId}> outside private channel`, channel, immediateBan: true });
            return;
          }
        }
      }
    }
  } catch (e) {
    console.error("outside partner check error:", e);
  }

  // Enhanced Daily check-ins tracking
  if (channelName === "daily-check-ins") {
    try {
      if (!fitnessWeekly[authorId]) fitnessWeekly[authorId] = { yes: 0, no: 0 };
      if (!fitnessMonthly[authorId]) fitnessMonthly[authorId] = { yes: 0, no: 0 };

      const content = message.content.toLowerCase();
      const positiveWords = ['workout', 'gym', 'ran', 'lifted', 'exercise', 'trained', 'done', 'completed', 'finished', 'yes', '✅', 'crushed', 'smashed', 'cardio', 'weights', 'pushups', 'pullups', 'squats'];
      const negativeWords = ['rest day', 'skipped', 'missed', 'no workout', 'didn\'t', 'failed', 'no', '❌', 'sick', 'injured'];
      
      const hasPositive = positiveWords.some(word => content.includes(word));
      const hasNegative = negativeWords.some(word => content.includes(word));
      
      if (hasPositive && !hasNegative) {
        fitnessWeekly[authorId].yes += 1;
        fitnessMonthly[authorId].yes += 1;
        const encouragements = ['Beast mode!', 'Keep crushing it!', 'Unstoppable!', 'Champion mindset!'];
        message.react('💪');
        setTimeout(() => message.reply(encouragements[Math.floor(Math.random() * encouragements.length)]), 1000);
      } else if (hasNegative && !hasPositive) {
        fitnessWeekly[authorId].no += 1;
        fitnessMonthly[authorId].no += 1;
        message.react('❌');
        setTimeout(() => message.reply('Tomorrow is a new day to dominate!'), 1000);
      } else {
        return; // Ignore ambiguous messages
      }
      
      saveWeekly();
      saveMonthly();
      
      try { 
        await updateLeaderboardChannel(); 
      } catch (e) { 
        console.error("updateLeaderboardChannel error:", e); 
      }
      return;
    } catch (e) {
      console.error("Fitness tracking error:", e);
    }
  }

  // Auto-pairing: if queue has 2 or more, attempt to pair similar types
  if (partnerQueue.length >= 2 && message.guild) {
    try {
      const first = partnerQueue.shift();
      let otherIndex = partnerQueue.findIndex(x => x.type === first.type);
      if (otherIndex === -1) otherIndex = 0;
      const other = partnerQueue.splice(otherIndex, 1)[0];
      savePartnerQueue();

      const blockA = (strikes[message.guild.id] && strikes[message.guild.id][first.id] && strikes[message.guild.id][first.id].blockedFromMatching) || false;
      const blockB = (strikes[message.guild.id] && strikes[message.guild.id][other.id] && strikes[message.guild.id][other.id].blockedFromMatching) || false;

      if (blockA || blockB) {
        if (!blockA) partnerQueue.push(first);
        if (!blockB) partnerQueue.push(other);
        savePartnerQueue();
      } else {
        const ch = await createPartnerChannel(message.guild, first.id, other.id, { type: first.type });
        if (ch) {
          const embed = new EmbedBuilder()
            .setTitle("Paired!")
            .setDescription(`<@${first.id}> and <@${other.id}> have been paired.
Check your DMs or go to ${ch.toString()}`)
            .setColor(0x00AE86)
            .setTimestamp();
          try { await (await client.users.fetch(first.id)).send({ embeds: [embed] }); } catch {}
          try { await (await client.users.fetch(other.id)).send({ embeds: [embed] }); } catch {}
          await message.channel.send(`Paired <@${first.id}> and <@${other.id}>. Channel: ${ch.toString()}`);
        } else {
          partnerQueue.unshift(first, other);
          savePartnerQueue();
        }
      }
    } catch (e) {
      console.error("auto pairing error:", e);
    }
  }

  // OpenAI persona for specific channels
  if (["tips and guide", "wealth", "health", "faith", "fitness"].includes(channelName)) {
    const userMemory = { lastMessage: message.content, previousMessages: memory[channelName][authorId]?.slice(-5) || [] };
    const personaPrompt = () => {
            const basePersona = `You are GymBotBro, a disciplined, stoic, God-fearing mentor who helps men become their best selves. You're direct, concise, and focused on practical advice. You speak with authority but remain humble.`;
      
      const channelPersonas = {
        "tips and guide": `${basePersona} You're giving practical life advice to help men improve themselves. Focus on actionable tips for discipline, productivity, and personal growth.`,
        "wealth": `${basePersona} You're giving financial and career advice. Focus on building wealth through discipline, smart investments, and career advancement strategies.`,
        "health": `${basePersona} You're giving health advice focused on longevity, nutrition, and preventative care. Emphasize evidence-based approaches to wellness.`,
        "faith": `${basePersona} You're discussing spiritual growth and faith-based principles. Offer wisdom on applying faith to daily challenges while respecting different beliefs.`,
        "fitness": `${basePersona} You're a fitness coach giving workout advice, form tips, and training strategies. Be motivational but realistic about progress.`
      };
      
      return channelPersonas[channelName] || basePersona;
    };

    if (Math.random() < 0.15) { // 15% chance to respond
      try {
        const aiPrompt = `${personaPrompt()}
        
User's message: "${message.content}"

Previous messages from this user in this channel:
${userMemory.previousMessages.join("\n")}

Respond in 1-3 sentences with practical, actionable advice. Be direct and concise. Don't use hashtags or emojis.`;

        const response = await getOpenAIResponse(aiPrompt);
        await message.reply(response);
      } catch (e) {
        console.error("AI response error:", e);
      }
    }
  }

  // Command handling
  if (message.content.startsWith("!")) {
    const args = message.content.slice(1).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    if (command === "challenge") {
      const subcommand = args.shift()?.toLowerCase();
      if (subcommand === "create") return await commandHandlers.challengeCreate(message, args);
      if (subcommand === "join") return await commandHandlers.challengeJoin(message, args);
      return message.reply("Available subcommands: `!challenge create [description]` or `!challenge join [id]`");
    }

    if (commandHandlers[command]) {
      try {
        await commandHandlers[command](message, args, channelName);
      } catch (e) {
        console.error(`Error in command ${command}:`, e);
        message.reply("Something went wrong with that command. Try again later.");
      }
    }
  }
});

// ------------------ Reaction Event Handler ------------------
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  
  // Fetch the full message if it's a partial
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }

  // Challenge join via reaction
  if (reaction.emoji.name === '💪') {
    const message = reaction.message;
    const embed = message.embeds[0];
    
    if (embed && embed.title && embed.title.includes("CHALLENGE")) {
      const footer = embed.footer?.text;
      if (!footer) return;
      
      const challengeId = footer.match(/ID: (\d+)/)?.[1];
      if (!challengeId || !challenges[challengeId]) return;
      
      const challenge = challenges[challengeId];
      if (challenge.participants.includes(user.id)) return;
      
      challenge.participants.push(user.id);
      saveChallenges();
      
      try {
        await user.send(`You've joined the challenge: "${challenge.name}"! Good luck!`);
      } catch (error) {
        console.error('Error sending DM:', error);
      }
    }
  }
});

// ------------------ Scheduled Tasks ------------------
// Daily motivation message at 9 AM
cron.schedule('0 9 * * *', async () => {
  try {
    const motivationQuotes = [
      "💪 Rise and grind! Today's your day to be better than yesterday.",
      "🔥 The only bad workout is the one that didn't happen. Make it count today!",
      "⚡ Your body can stand almost anything. It's your mind you have to convince.",
      "🏆 Success isn't given. It's earned in the gym and through discipline.",
      "💯 The pain you feel today will be the strength you feel tomorrow!",
      "🎯 Your only limit is your mind. Push past it today.",
      "🚀 Don't wish for it, work for it. Today is your opportunity.",
      "💎 Diamonds are formed under pressure. Embrace the challenge.",
      "⭐ Be stronger than your excuses. They're the only thing holding you back.",
      "🔥 Sweat is just fat crying. Make it pour today!"
    ];
    
    const quote = motivationQuotes[Math.floor(Math.random() * motivationQuotes.length)];
    
    for (const guild of client.guilds.cache.values()) {
      const generalChannel = guild.channels.cache.find(ch => 
        ch.name === "general" || ch.name === "main" || ch.name === "chat"
      );
      
      if (generalChannel) {
        await generalChannel.send(`**DAILY MOTIVATION**\n${quote}`);
      }
    }
    
    console.log("Sent daily motivation message");
  } catch (error) {
    console.error("Error sending daily motivation:", error);
  }
});

// Weekly leaderboard update and reset (Sunday midnight)
cron.schedule('0 0 * * 0', async () => {
  try {
    // Post final leaderboard for the week
    for (const guild of client.guilds.cache.values()) {
      const leaderboardChannel = guild.channels.cache.find(ch => ch.name === "leaderboard");
      if (leaderboardChannel) {
        const leaderboardMsg = buildLeaderboardMessage();
        await leaderboardChannel.send(`**WEEKLY FINAL STANDINGS**\n${leaderboardMsg}`);
      }
    }
    
    // Reset weekly data
    for (const userId in fitnessWeekly) {
      fitnessWeekly[userId] = { yes: 0, no: 0 };
    }
    saveWeekly();
    
    console.log("Weekly leaderboard updated and reset");
  } catch (error) {
    console.error("Error in weekly leaderboard update:", error);
  }
});

// Monthly reset (1st of each month)
cron.schedule('0 0 1 * *', async () => {
  try {
    // Reset monthly data
    for (const userId in fitnessMonthly) {
      fitnessMonthly[userId] = { yes: 0, no: 0 };
    }
    saveMonthly();
    
    console.log("Monthly fitness data reset");
  } catch (error) {
    console.error("Error in monthly reset:", error);
  }
});

// Daily health news update (5 PM)
cron.schedule('0 17 * * *', async () => {
  try {
    const news = await getHealthNews();
    
    for (const guild of client.guilds.cache.values()) {
      const healthChannel = guild.channels.cache.find(ch => 
        ch.name === "health" || ch.name === "fitness-news"
      );
      
      if (healthChannel) {
        await healthChannel.send(`**DAILY HEALTH UPDATE**\n${news}`);
      }
    }
    
    console.log("Sent daily health news");
  } catch (error) {
    console.error("Error sending health news:", error);
  }
});

// Partner check-in reminders (every 3 days)
cron.schedule('0 12 */3 * *', async () => {
  try {
    for (const [channelId, partnerData] of Object.entries(partners)) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) continue;
        
        const embed = new EmbedBuilder()
          .setTitle("Accountability Check-In")
          .setDescription(`Hey <@${partnerData.users[0]}> and <@${partnerData.users[1]}>!\n\nHow are you both doing with your goals? Remember to:\n\n• Share your progress\n• Discuss any challenges\n• Set new mini-goals\n\nStaying accountable makes you both stronger!`)
          .setColor(0x00AE86)
          .setTimestamp();
        
        await channel.send({ embeds: [embed] });
        
        // Update check-in count
        partnerData.checkins = (partnerData.checkins || 0) + 1;
        savePartners();
      } catch (error) {
        console.error(`Error with partner check-in for channel ${channelId}:`, error);
      }
    }
    
    console.log("Sent partner check-in reminders");
  } catch (error) {
    console.error("Error in partner check-in job:", error);
  }
});

// Weekly fitness video recommendations (Wednesday noon)
cron.schedule('0 12 * * 3', async () => {
  try {
    const videos = await getRandomFitnessVideos(3);
    
    for (const guild of client.guilds.cache.values()) {
      const fitnessChannel = guild.channels.cache.find(ch => 
        ch.name === "fitness" || ch.name === "workout"
      );
      
      if (fitnessChannel) {
        await fitnessChannel.send("**WEEKLY WORKOUT RECOMMENDATIONS**");
        for (const video of videos) {
          await fitnessChannel.send(video);
        }
      }
    }
    
    console.log("Sent weekly fitness video recommendations");
  } catch (error) {
    console.error("Error sending fitness videos:", error);
  }
});

// Goal progress reminders (Friday 5 PM)
cron.schedule('0 17 * * 5', async () => {
  try {
    for (const [userId, goal] of Object.entries(memory.goals || {})) {
      try {
        const user = await client.users.fetch(userId);
        const progress = fitnessWeekly[userId]?.yes || 0;
        const remaining = goal - progress;
        
        if (remaining > 0) {
          await user.send(`**WEEKEND GOAL REMINDER**\nYou've completed ${progress}/${goal} workouts this week. You need ${remaining} more to hit your goal! The weekend is your chance to finish strong!`);
        } else {
          await user.send(`**GOAL ACHIEVED!**\nCongratulations! You've hit your weekly goal of ${goal} workouts! Any additional workouts are bonus gains!`);
        }
      } catch (error) {
        console.error(`Error sending goal reminder to user ${userId}:`, error);
      }
    }
    
    console.log("Sent goal progress reminders");
  } catch (error) {
    console.error("Error in goal reminder job:", error);
  }
});

// Birthday check (daily at 8 AM)
cron.schedule('0 8 * * *', async () => {
  try {
    const today = new Date();
    const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    for (const [userId, birthday] of Object.entries(birthdays)) {
      if (birthday && birthday.startsWith(dateString.substring(0, 5))) {
        try {
          for (const guild of client.guilds.cache.values()) {
            const generalChannel = guild.channels.cache.find(ch => ch.name === "general");
            if (generalChannel) {
              await generalChannel.send(`🎂 Happy Birthday to <@${userId}>! May your gains be plentiful and your PRs be crushed!`);
            }
          }
        } catch (error) {
          console.error(`Error sending birthday message for user ${userId}:`, error);
        }
      }
    }
    
    console.log("Checked for birthdays");
  } catch (error) {
    console.error("Error in birthday check job:", error);
  }
});

// ------------------ Client Events ------------------
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("!coach for fitness advice");
  loadData();
  
  // Check for expired mutes every 5 minutes
  setInterval(async () => {
    try {
      for (const guildId in strikes) {
        for (const userId in strikes[guildId]) {
          const sr = strikes[guildId][userId];
          if (sr.mutedUntil && sr.mutedUntil < Date.now()) {
            try {
              const guild = await client.guilds.fetch(guildId);
              const member = await guild.members.fetch(userId);
              const mutedRole = guild.roles.cache.find(r => r.name === "Muted");
              if (mutedRole && member.roles.cache.has(mutedRole.id)) {
                await member.roles.remove(mutedRole);
                sr.mutedUntil = null;
                saveStrikes();
                console.log(`Unmuted ${userId} in ${guildId}`);
              }
            } catch (e) {
              console.error(`Error unmuting ${userId} in ${guildId}:`, e);
            }
          }
        }
      }
    } catch (e) {
      console.error("Mute check error:", e);
    }
  }, 5 * 60 * 1000);
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

// ------------------ Start Bot ------------------
client.login(process.env.DISCORD_TOKEN);

