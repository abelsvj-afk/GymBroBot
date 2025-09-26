// ------------------ Express Keep-Alive Server ------------------
import express from "express";
const app = express();
app.get("/", (req, res) => res.send("GymBotBro is alive!"));
app.listen(process.env.PORT || 3000, () => console.log("Server running"));

// ------------------ Load Env Variables ------------------
import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") dotenv.config();

// ------------------ Required Modules ------------------
import fs from "fs";
import path from "path";
import {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  Partials,
  REST,
  Routes,
  EmbedBuilder,
} from "discord.js";
import OpenAI from "openai";
import cron from "node-cron";
import axios from "axios";
import { google } from "googleapis";

// ------------------ Debug Env Variables ------------------
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "✅ Exists" : "❌ Missing");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ Exists" : "❌ Missing");
console.log("NEWS_API_KEY:", process.env.NEWS_API_KEY ? "✅ Exists" : "❌ Missing");
console.log("YOUTUBE_API_KEY:", process.env.YOUTUBE_API_KEY ? "✅ Exists" : "❌ Missing");

if (!process.env.DISCORD_TOKEN || !process.env.OPENAI_API_KEY) {
  console.error("Critical environment variables missing! Exiting...");
  process.exit(1);
}

// ------------------ Data Storage Variables (DECLARED FIRST) ------------------
let memory = {};
let birthdays = {};
let fitnessWeekly = {};
let fitnessMonthly = {};
let partnerQueue = [];
let partners = {};
let strikes = {};
let habitTracker = {};
let challenges = {};

// ------------------ Configuration Constants ------------------
const DATA_DIR = ".";
const MEMORY_FILE = path.join(DATA_DIR, "conversationmemory.json");
const BIRTHDAY_FILE = path.join(DATA_DIR, "birthdays.json");
const FITNESS_WEEKLY_FILE = path.join(DATA_DIR, "fitnessWeekly.json");
const FITNESS_MONTHLY_FILE = path.join(DATA_DIR, "fitnessMonthly.json");
const PARTNER_QUEUE_FILE = path.join(DATA_DIR, "partnerQueue.json");
const PARTNERS_FILE = path.join(DATA_DIR, "partners.json");
const STRIKES_FILE = path.join(DATA_DIR, "strikes.json");
const HABITS_FILE = path.join(DATA_DIR, "habits.json");
const CHALLENGES_FILE = path.join(DATA_DIR, "challenges.json");

const STRIKE_CONFIG = {
  warnCount: 1,
  muteCount: 2,
  endPartnerCount: 3,
  banCount: 4,
  muteDurationMs: 2 * 60 * 60 * 1000, // 2 hours
  exposureUnlocks: [5, 10, 15]
};

// ------------------ Data Persistence Functions ------------------
function loadData() {
  try {
    if (fs.existsSync(MEMORY_FILE)) memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    if (fs.existsSync(BIRTHDAY_FILE)) birthdays = JSON.parse(fs.readFileSync(BIRTHDAY_FILE, 'utf8'));
    if (fs.existsSync(FITNESS_WEEKLY_FILE)) fitnessWeekly = JSON.parse(fs.readFileSync(FITNESS_WEEKLY_FILE, 'utf8'));
    if (fs.existsSync(FITNESS_MONTHLY_FILE)) fitnessMonthly = JSON.parse(fs.readFileSync(FITNESS_MONTHLY_FILE, 'utf8'));
    if (fs.existsSync(PARTNER_QUEUE_FILE)) partnerQueue = JSON.parse(fs.readFileSync(PARTNER_QUEUE_FILE, 'utf8'));
    if (fs.existsSync(PARTNERS_FILE)) partners = JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf8'));
    if (fs.existsSync(STRIKES_FILE)) strikes = JSON.parse(fs.readFileSync(STRIKES_FILE, 'utf8'));
    if (fs.existsSync(HABITS_FILE)) habitTracker = JSON.parse(fs.readFileSync(HABITS_FILE, 'utf8'));
    loadChallenges();
    console.log("Data loaded successfully");
  } catch (e) {
    console.error("Error loading data:", e);
  }
}

function loadChallenges() {
  try {
    if (fs.existsSync(CHALLENGES_FILE)) challenges = JSON.parse(fs.readFileSync(CHALLENGES_FILE, 'utf8'));
  } catch (e) {
    console.error("Error loading challenges:", e);
  }
}

function saveChallenges() {
  try {
    fs.writeFileSync(CHALLENGES_FILE, JSON.stringify(challenges, null, 2));
  } catch (e) {
    console.error("Save challenges error:", e);
  }
}    console.log("Data loaded successfully");
  } catch (e) {
    console.error("Error loading data:", e);
  }
}

function saveMemory() { try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); } catch (e) { console.error("Save memory error:", e); } }
function saveBirthdays() { try { fs.writeFileSync(BIRTHDAY_FILE, JSON.stringify(birthdays, null, 2)); } catch (e) { console.error("Save birthdays error:", e); } }
function saveWeekly() { try { fs.writeFileSync(FITNESS_WEEKLY_FILE, JSON.stringify(fitnessWeekly, null, 2)); } catch (e) { console.error("Save weekly error:", e); } }
function saveMonthly() { try { fs.writeFileSync(FITNESS_MONTHLY_FILE, JSON.stringify(fitnessMonthly, null, 2)); } catch (e) { console.error("Save monthly error:", e); } }
function savePartnerQueue() { try { fs.writeFileSync(PARTNER_QUEUE_FILE, JSON.stringify(partnerQueue, null, 2)); } catch (e) { console.error("Save queue error:", e); } }
function savePartners() { try { fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2)); } catch (e) { console.error("Save partners error:", e); } }
function saveStrikes() { try { fs.writeFileSync(STRIKES_FILE, JSON.stringify(strikes, null, 2)); } catch (e) { console.error("Save strikes error:", e); } }
function saveHabits() {try { fs.writeFileSync(HABITS_FILE, JSON.stringify(habitTracker, null, 2)); } catch (e) { console.error("Save habits error:", e); } }

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
  const logChannel = guild.channels.cache.find(ch => (ch.name || "").toLowerCase().includes("log") || (ch.name || "").toLowerCase() === "mod-logs");
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

async function checkRoleRewards(userId, guild) {
  if (!guild) return;
  
  const monthly = fitnessMonthly[userId];
  if (!monthly) return;
  
  const roleRewards = {
    10: { name: "Gym Rookie", color: 0x8B4513 },
    25: { name: "Fitness Enthusiast", color: 0x32CD32 },
    50: { name: "Workout Warrior", color: 0xFF6347 },
    100: { name: "Iron Will", color: 0x708090 },
    200: { name: "Beast Mode", color: 0x8B0000 }
  };
  
  const total = monthly.yes;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  
  for (const [threshold, roleData] of Object.entries(roleRewards)) {
    if (total >= parseInt(threshold)) {
      let role = guild.roles.cache.find(r => r.name === roleData.name);
      if (!role) {
        try {
          role = await guild.roles.create({ 
            name: roleData.name, 
            color: roleData.color,
            reason: "Fitness milestone reward role"
          });
        } catch (e) {
          console.error("Role creation failed:", e);
          continue;
        }
      }
 // Add this line
      
      if (!member.roles.cache.has(role.id)) {
        try {
          await member.roles.add(role, `Earned ${roleData.name} with ${total} workouts`);
          const channel = guild.channels.cache.find(ch => ch.name?.toLowerCase() === "general");
          if (channel) {
            await channel.send(`🎉 <@${userId}> earned the **${roleData.name}** role! ${total} workouts completed!`);
          }
        } catch (e) {
          console.error("Role assignment failed:", e);
        }
      }
    }
  }
}

// Load data after all functions are defined
loadData();

// ------------------ Discord Client Setup ------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// ------------------ OpenAI & API Setup ------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });

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

// ------------------ YouTube / News / Sports helpers ------------------
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

async function getRandomFitnessVideos(count = 2) {
  try {
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
    const res = await axios.get(`https://newsapi.org/v2/top-headlines?category=health&language=en&apiKey=${process.env.NEWS_API_KEY}`);
    const top = res.data.articles?.[0];
    return top ? `📰 **${top.title}**\n${top.description || ""}\n${top.url}` : "No health news today.";
  } catch (e) {
    console.error("News error:", e.message);
    return "Could not fetch health news.";
  }
}

const THESPORTSDB_KEY = process.env.THESPORTSDB_KEY || "1";
async function getSportsUpdates() {
  try {
    const results = [];
    try {
      const resNBA = await axios.get(`https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/eventsnextleague.php?id=4387`);
      const events = resNBA.data.events;
      if (events && events.length) results.push("Basketball (NBA): " + events.slice(0, 5).map(e => `${e.strEvent} - ${e.dateEvent}`).join(" | "));
    } catch {}
    try {
      const resNFL = await axios.get(`https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/eventsnextleague.php?id=4391`);
      const events = resNFL.data.events;
      if (events && events.length) results.push("Football (NFL): " + events.slice(0, 5).map(e => `${e.strEvent} - ${e.dateEvent}`).join(" | "));
    } catch {}
    try {
      const resBoxing = await axios.get(`https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/searchfilename.php?e=boxing`);
      if (resBoxing.data && Object.keys(resBoxing.data).length) results.push("Boxing/MMA: Check official fight calendars for latest events.");
    } catch {}
    if (!results.length) return "No new sports updates available today.";
    return results.join("\n");
  } catch (e) {
    console.error("Sports error:", e.message);
    return "No new sports updates available today.";
  }
}

// ------------------ Leaderboard utilities ------------------
function buildLeaderboardMessage() {
  let leaderboardMsg = "**🏆 Fitness Leaderboard (Daily Snapshot) 🏆**\n\n";
  const sorted = Object.entries(fitnessMonthly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
  if (sorted.length === 0) leaderboardMsg += "No data yet.";
  sorted.forEach(([uid, data], idx) => {
    const medals = ["🥇", "🥈", "🥉"];
    const flair = idx < 3 ? medals[idx] : "💪";
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
    try { await leaderboardChannel.bulkDelete(10); } catch (e) { /* ignore */ }
    await leaderboardChannel.send({ content: msg });
    // Remove this line - we'll call checkRoleRewards elsewhere

  } catch (e) {
    console.error("updateLeaderboardChannel error:", e.message);
  }
}

// ------------------ Graceful Shutdown ------------------
process.on('SIGINT', () => {
  console.log('Received SIGINT. Saving data and shutting down gracefully...');
  saveMemory();
  saveBirthdays();
  saveWeekly();
  saveMonthly();
  savePartnerQueue();
  savePartners();
  saveStrikes();
  saveHabits();
  saveChallenges();
  process.exit(0);

});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Saving data and shutting down gracefully...');
  saveMemory();
  saveBirthdays();
  saveWeekly();
  saveMonthly();
  savePartnerQueue();
  savePartners();
  saveStrikes();
  saveHabits();
  saveChallenges();
  process.exit(0);

});
// ------------------ Partner System Utilities ------------------
async function findOrCreateAccountabilityCategory(guild) {
  const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && (c.name || "").toLowerCase() === "accountability partners");
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

function findModeratorRole(guild) {
  const role = guild.roles.cache.find(r => {
    try { return r.permissions.has && r.permissions.has(PermissionsBitField.Flags.ManageMessages); } catch { return false; }
  });
  return role || null;
}

async function createPartnerChannel(guild, userAId, userBId, options = {}) {
  try {
    const category = await findOrCreateAccountabilityCategory(guild);
    const userA = await guild.members.fetch(userAId).catch(() => null);
    const userB = await guild.members.fetch(userBId).catch(() => null);
    const safeName = `partner-${userA ? userA.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0,8) : userAId.slice(0,6)}-${userB ? userB.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0,8) : userBId.slice(0,6)}`.slice(0,90);
    const modRole = findModeratorRole(guild);

    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: userAId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: userBId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] },
    ];
    if (modRole) permissionOverwrites.push({ id: modRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] });

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
    
    if (partners[channel.id].type === "future") {
      const exposureEmbed = new EmbedBuilder()
        .setTitle("Future Partner (Slow Reveal)")
        .setDescription("Certain info is hidden and will be gradually revealed as you complete interactions. Do not post hidden contact info early.")
        .addFields({ name: "Unlocks", value: `Interactions needed: ${STRIKE_CONFIG.exposureUnlocks.join(", ")}` })
        .setColor(0xffd166);
      const msg2 = await channel.send({ embeds: [exposureEmbed] });
      try { await msg2.pin(); } catch {}
    }

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
          try { (await client.users.fetch(userId)).send(`🔇 You have been temporarily muted in ${guild.name} for ${STRIKE_CONFIG.muteDurationMs / (60*60*1000)} hours due to: ${reason}`); } catch {}
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
      await notifyLoggingChannel(guild, new EmbedBuilder().setTitle("Partner Ended & Blocked")
        .setDescription(`<@${userId}> had partner channels ended and is blocked from future matching (strike ${sr.count}).`)
        .setColor(0xff4500)
        .setTimestamp());
      try { (await client.users.fetch(userId)).send(`🚫 Your partner pairing(s) have been ended and you are blocked from future pairings due to repeated violations.`); } catch {}
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

// ------------------ Scheduled Tasks ------------------
cron.schedule("*/5 * * * *", async () => {
  for (const [guildId, users] of Object.entries(strikes)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const [userId, record] of Object.entries(users)) {
      if (record.mutedUntil && Date.now() > record.mutedUntil) {
        try {
          const mutedRole = guild.roles.cache.find(r => r.name === "Muted");
          const member = await guild.members.fetch(userId).catch(() => null);
          if (mutedRole && member) await member.roles.remove(mutedRole, "Mute expired - automatic unmute");
        } catch (e) { console.error("Auto unmute error:", e); }
        record.mutedUntil = null;
        saveStrikes();
        await notifyLoggingChannel(guild, `✅ <@${userId}> auto-unmuted after mute expiration.`);
      }
    }
  }
}, { timezone: "America/New_York" });

// ------------------ Slash Commands ------------------
const SLASH_COMMANDS = [
  {
    name: "strike",
    description: "Manage strikes",
    type: 1,
    options: [
      {
        name: "add",
        description: "Add a strike to a user",
        type: 1,
        options: [
          { name: "user", description: "The user to strike", type: 6, required: true },
          { name: "reason", description: "Reason for the strike", type: 3, required: false }
        ]
      },
      {
        name: "check",
        description: "Check strikes for a user",
        type: 1,
        options: [
          { name: "user", description: "The user to check", type: 6, required: true }
        ]
      },
      {
        name: "clear",
        description: "Clear strikes for a user",
        type: 1,
        options: [
          { name: "user", description: "The user to clear strikes for", type: 6, required: true }
        ]
      }
    ]
  },
  {
    name: "partner",
    description: "Partner system actions",
    type: 1,
    options: [
      { name: "queue", description: "Join the partner queue (DM prompt)", type: 1 },
      { name: "cancel", description: "Cancel your partner queue request", type: 1 },
      { name: "end", description: "End your current partner pairing", type: 1 },
      { name: "status", description: "Show partner queue status", type: 1 }
    ]
  },
  { name: "progress", description: "Show your fitness progress (weekly/monthly)", type: 1 },
  { name: "coach", description: "Get a short AI coach pep talk", type: 1, options: [{ name: "topic", description: "Topic for advice", type: 3, required: false }] },
  { name: "testpair", description: "Create a test pairing (mod only)", type: 1, options: [
    { name: "user1", description: "First user to pair", type: 6, required: true },
    { name: "user2", description: "Second user to pair", type: 6, required: true }
  ] },
  { name: "teststrike", description: "Apply a test strike (mod only)", type: 1, options: [
    { name: "user", description: "User to test strike", type: 6, required: true }
  ] },
];

// Helper to register per-guild slash commands
async function registerSlashCommandsForGuild(guild) {
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: SLASH_COMMANDS });
    console.log(`Slash commands registered for guild ${guild.id}`);
  } catch (e) {
    console.error("registerSlashCommandsForGuild error:", e);
  }
}

// ------------------ Bot Ready Event ------------------
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // Register slash commands for every guild the bot is in
  for (const [guildId, guild] of client.guilds.cache) {
    try { await registerSlashCommandsForGuild(guild); } catch {}
  }

  // Pin guide messages for channels
  const howToMessages = {
    general: "💡 **Welcome to General!** Chat freely. Use `setbirthday MM-DD` to register birthdays. Bot will remind on their day! 🎉",
    welcome: "💡 **Welcome Channel:** Introduce yourself & get guidance.",
    announcements: "💡 **Announcements:** Important updates posted here.",
    "daily-check-ins": "💡 **Daily Check-Ins:** Post workouts/motivation. E.g., `Did a 30-min run today!` 💪 • Commands: `!coach`, `!progress`",
    "tips and guide": "💡 **Tips & Guide:** Ask about fitness, health, style, faith, or wealth. Use `!coach` for quick motivation.",
    faith: "💡 **Faith:** Questions about Christianity, prayer, scripture. Example: `How can I strengthen my prayer life?`",
    "mens-style": "💡 **Men's Style:** Ask about fashion & style tips.",
    "open-up": "💡 **Open Up:** Share struggles or mental health concerns respectfully.",
    health: "💡 **Health:** Ask about wellness, diet, remedies, superfoods.",
    wealth: "💡 **Wealth:** Investing, business, money management. Tip posted daily at 11AM ET.",
    sports: "💡 **Sports:** MMA, boxing, Muay Thai, combat sports updates.",
    fitness: "💡 **Fitness:** Log workouts daily, see leaderboard, check-ins posted automatically.",
    leaderboard: "💡 **Leaderboard:** Public leaderboard updates weekly & monthly. No spam in this channel.",
    "accountability-lounge": "🔍 **Accountability Lounge:** Use `/partner queue` or `!findpartner` to join. Choose **Goal** or **Future** partner. DO NOT contact your partner outside your private partner channel. Violations result in strikes or ban.",
  };

  for (const [name, message] of Object.entries(howToMessages)) {
  const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === name);
  if (!ch) continue;
  try {
    const pinned = await ch.messages.fetchPins();
    // Fix: Convert Collection to array before using .some()
    if (!Array.from(pinned.values()).some(m => 
      m.content === message || 
      (m.embeds && m.embeds.some(e => e.description === message))
    )) {
      const embed = new EmbedBuilder()
        .setTitle(`Guide — #${name}`)
        .setDescription(message)
        .setColor(0x00AE86);
      const sent = await ch.send({ embeds: [embed] });
      try { 
        await sent.pin(); 
      } catch (e) {
        console.error(`Failed to pin message in #${name}:`, e.message);
      }
    }
  } catch (e) {
    console.error(`Pin guide error for #${name}:`, e.message);
  }
}

  // ------------------ Cron Jobs Setup ------------------
  
  // Check-in reminders at 7am, 10am, 2pm, 6pm, 9pm ET
  const checkInTimes = ["0 7 * * *", "0 10 * * *", "0 14 * * *", "0 18 * * *", "0 21 * * *"];
  checkInTimes.forEach(time => {
    cron.schedule(time, async () => {
      const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "daily-check-ins");
      if (ch) await ch.send("💪 Time for your check-in! Log your progress and stay accountable!");
    }, { timezone: "America/New_York" });
  });

  // Daily wealth tip 11AM
  cron.schedule("0 11 * * *", async () => {
    const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "wealth");
    if (!ch) return;
    const tip = await getOpenAIResponse("Provide a practical daily wealth tip for investing, business, money management, stocks, crypto, life insurance, entrepreneurship, leveraging debt, LLCs, banking, and financial growth.");
    await ch.send({ content: `💰 Daily Wealth Tip:\n${tip}` });
  }, { timezone: "America/New_York" });

  // Daily health news 10AM
  cron.schedule("0 10 * * *", async () => {
    const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "health");
    if (!ch) return;
    const news = await getHealthNews();
    await ch.send({ content: `🏥 Daily Health News:\n${news}` });
  }, { timezone: "America/New_York" });

  // Sports updates 8am, 12pm, 4pm
  const fightTimes = ["0 8 * * *", "0 12 * * *", "0 16 * * *"];
  fightTimes.forEach(t => {
    cron.schedule(t, async () => {
      const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "sports");
      if (!ch) return;
      const u = await getSportsUpdates();
      await ch.send({ content: `🥊 Combat & Sports Update:\n${u}` });
    }, { timezone: "America/New_York" });
  });

  // Fitness videos 12PM
  cron.schedule("0 12 * * *", async () => {
    const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "fitness");
    if (!ch) return;
    const videos = await getRandomFitnessVideos(Math.floor(Math.random() * 2) + 2);
    for (const v of videos) await ch.send(v);
  }, { timezone: "America/New_York" });

  // Birthday announcer 8AM
  cron.schedule("0 8 * * *", async () => {
    const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "general");
    if (!ch) return;
    const today = new Date();
    const mmdd = `${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    for (const [uid, date] of Object.entries(birthdays)) {
      const birthMd = date.slice(5);
      if (birthMd === mmdd) {
        await ch.send(`🎉 Today is <@${uid}>'s birthday! Go shout them a happy birthday! 💪`);
      }
    }
  }, { timezone: "America/New_York" });

  // Weekly leaderboard Sunday midnight ET
  cron.schedule("0 0 * * 0", async () => {
    const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "leaderboard");
    if (!ch) return;
    const sorted = Object.entries(fitnessWeekly).sort((a,b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    let msg = "**🏅 Weekly Fitness Winner 🏅**\n";
    if (sorted.length) msg += `🥇 <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += "\n💥 Weekly Top 5:\n";
    sorted.slice(0,5).forEach(([uid, data], idx) => {
      const medals = ["🥇","🥈","🥉","🏋️","💪"];
      msg += `${medals[idx]} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`;
    });
    await ch.send({ content: msg });
    // Reset weekly
    for (const uid in fitnessWeekly) fitnessWeekly[uid] = { yes: 0, no: 0 };
    saveWeekly();
  }, { timezone: "America/New_York" });

  // Monthly leaderboard 1st midnight ET
  cron.schedule("0 0 1 * *", async () => {
    const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "leaderboard");
    if (!ch) return;
    const sorted = Object.entries(fitnessMonthly).sort((a,b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    let msg = "**🏆 Monthly Fitness Winner 🏆**\n";
    if (sorted.length) msg += `🥇 <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += "\n🔥 Monthly Top 5:\n";
    sorted.slice(0,5).forEach(([uid, data], idx) => {
      const medals = ["🥇","🥈","🥉","🏆","💪"];
      msg += `${medals[idx]} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`;
    });
    await ch.send({ content: msg });
    // Reset monthly
    for (const uid in fitnessMonthly) fitnessMonthly[uid] = { yes: 0, no: 0 };
    saveMonthly();
  }, { timezone: "America/New_York" });
});

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

  // ------------------ Prefix Commands ------------------

  // !test
  if (message.content === "!test") {
    try {
      const videos = await getRandomFitnessVideos(2);
      if (!videos || !Array.isArray(videos) || videos.length === 0) return message.reply("No content found for testing.");
      for (const v of videos) await message.channel.send(v);
    } catch (e) {
      console.error("!test error:", e);
      return message.reply("Error running test.");
    }
    return;
  }

  // !leaderboard (only in leaderboard channel)
  if (message.content === "!leaderboard") {
    if (channelName !== "leaderboard") return message.reply("Please run `!leaderboard` in the #leaderboard channel only.");
    try {
      const msg = buildLeaderboardMessage();
      return message.channel.send({ content: msg });
    } catch (e) {
      console.error("!leaderboard error:", e);
      return message.reply("Error generating leaderboard.");
    }
  }

  // Birthday commands
  const args = message.content.split(" ");
  if (args[0] === "setbirthday") {
    const date = args[1];
    if (!date || !/^\d{2}-\d{2}$/.test(date)) return message.reply("Please provide your birthday in MM-DD format, e.g., `setbirthday 09-23`");
    birthdays[authorId] = `${new Date().getFullYear()}-${date}`;
    saveBirthdays();
    return message.reply(`Got it! Your birthday has been saved as ${date}. 🎉`);
  }

  if (message.content === "!birthdays") {
    if (channelName !== "general") return message.reply("You can only run `!birthdays` in the #general channel.");
    const entries = Object.entries(birthdays);
    if (!entries.length) return message.channel.send("No birthdays stored yet.");
    let out = "**Saved Birthdays:**\n";
    entries.forEach(([uid, d]) => out += `<@${uid}> → ${d}\n`);
    return message.channel.send({ content: out });
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
      await checkRoleRewards(authorId, guild);
    } catch (e) { 
      console.error("updateLeaderboardChannel error:", e); 
    }
    return;
  } catch (e) {
    console.error("Fitness tracking error:", e);
  }
}

await checkRoleRewards(authorId, guild);

  // !checkin-test (mod-only)
  if (message.content === "!checkin-test") {
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
    let msg = "**🏅 WEEKLY FITNESS TEST DUMP 🏅**\n";
    if (sorted.length) msg += `🥇 <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += "\n💥 Weekly Top 5 (TEST):\n";

    const medals = ["🥇", "🥈", "🥉", "🏋️", "💪"];
    sorted.slice(0, 5).forEach(([uid, data], idx) => {
      msg += `${medals[idx] || "🏅"} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`;
    });

    try { await leaderboardChannel.send({ content: msg }); } catch (e) { console.error("!checkin-test send error:", e); }

    // Reset weekly fitness
    for (const uid in fitnessWeekly) fitnessWeekly[uid] = { yes: 0, no: 0 };
    saveWeekly();

    message.reply("Check-in test completed: weekly snapshot posted to #leaderboard and weekly data reset.");
    return;
  }

  // ------------------ Partnership Commands ------------------
  
  // Ensure partnerQueue is always an array
  if (!Array.isArray(partnerQueue)) partnerQueue = [];

  // !findpartner
  if (message.content === "!findpartner") {
    try {
      if (!message.guild) return message.reply("This command must be used from your server, not DMs.");
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
    return;
  }

  // !cancelpartner
  if (message.content === "!cancelpartner") {
    const idx = partnerQueue.findIndex(x => x.id === authorId);
    if (idx === -1) return message.reply("You're not in the partner queue.");
    partnerQueue.splice(idx, 1);
    savePartnerQueue();
    return message.reply("You've been removed from the partner queue.");
  }

  // !endpartner
  if (message.content === "!endpartner") {
    try {
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
            .setDescription(`<@${first.id}> and <@${other.id}> have been paired.\nCheck your DMs or go to ${ch.toString()}`)
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

  // !progress
  if (message.content === "!progress") {
    try {
      const weekly = fitnessWeekly[authorId] || { yes: 0, no: 0 };
      const monthly = fitnessMonthly[authorId] || { yes: 0, no: 0 };
      const streak = weekly.yes - weekly.no;
      const reply = `📊 **Your Progress**\nWeekly → ✅ ${weekly.yes} | ❌ ${weekly.no}\nMonthly → ✅ ${monthly.yes} | ❌ ${monthly.no}\nStreak (weekly yes - no): ${streak}\nKeep going — consistency builds results!`;
      return message.reply(reply);
    } catch (e) {
      console.error("!progress error:", e);
      return message.reply("Couldn't fetch your progress right now.");
    }
  }

  // !addhabit
  if (message.content.startsWith("!addhabit ")) {
  const habit = message.content.slice(10).trim();
  if (!habit) return message.reply("Usage: `!addhabit [habit name]`");
  
  if (!habitTracker[authorId]) habitTracker[authorId] = {};
  if (habitTracker[authorId][habit]) return message.reply("You already have this habit tracked!");
  
  habitTracker[authorId][habit] = { streak: 0, lastChecked: null, total: 0 };
  saveHabits();
  return message.reply(`Added habit: "${habit}". Use \`!check ${habit}\` to track it daily!`);
}

// !check
if (message.content.startsWith("!check ")) {
  const habit = message.content.slice(7).trim();
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
}

// !habits
if (message.content === "!habits") {
  if (!habitTracker[authorId] || Object.keys(habitTracker[authorId]).length === 0) {
    return message.reply("No habits tracked yet. Use `!addhabit [habit]` to start!");
  }
  
  let msg = "**Your Habits:**\n";
  Object.entries(habitTracker[authorId]).forEach(([habit, data]) => {
    const today = new Date().toDateString();
    const checkedToday = data.lastChecked === today ? " ✅" : "";
    msg += `• ${habit}: ${data.streak} day streak (${data.total} total)${checkedToday}\n`;
  });
  return message.reply(msg);
}

// !workoutplan
if (message.content.startsWith("!workoutplan ")) {
  const type = message.content.split(" ")[1]?.toLowerCase();
  const plans = {
    push: "**Push Day:**\n• Push-ups: 3x12\n• Pike Push-ups: 3x8\n• Tricep Dips: 3x10\n• Plank: 3x30s\n• Diamond Push-ups: 2x8",
    pull: "**Pull Day:**\n• Pull-ups: 3x5-8\n• Inverted Rows: 3x10\n• Face Pulls: 3x12\n• Dead Hang: 3x20s\n• Bicep Curls: 3x12",
    legs: "**Leg Day:**\n• Squats: 3x15\n• Lunges: 3x10 each leg\n• Calf Raises: 3x15\n• Wall Sit: 3x30s\n• Bulgarian Split Squats: 2x8 each",
    cardio: "**Cardio:**\n• 20min run/walk\n• Burpees: 3x5\n• Jumping Jacks: 3x20\n• High Knees: 3x30s\n• Mountain Climbers: 3x15",
    core: "**Core:**\n• Plank: 3x45s\n• Crunches: 3x20\n• Russian Twists: 3x15\n• Leg Raises: 3x12\n• Dead Bug: 2x10 each"
  };
  
  if (plans[type]) {
    return message.reply(`${plans[type]}\n\n*Adjust reps based on your level. Rest 60-90s between sets.*`);
  } else {
    return message.reply("Available plans: `!workoutplan push/pull/legs/cardio/core`");
  }
}

  // !resetprogress
  if (message.content === "!resetprogress") {
    try {
      fitnessWeekly[authorId] = { yes: 0, no: 0 };
      fitnessMonthly[authorId] = { yes: 0, no: 0 };
      saveWeekly();
      saveMonthly();
      return message.reply("Your weekly and monthly progress has been reset. Fresh start 💪");
    } catch (e) {
      console.error("!resetprogress error:", e);
      return message.reply("Couldn't reset your progress right now.");
    }
  }

    // !quote
if (message.content === "!quote") {
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
  return message.reply(`💡 ${quote}`);
}

    // !stats command
if (message.content === "!stats") {
  const weekly = fitnessWeekly[authorId] || { yes: 0, no: 0 };
  const monthly = fitnessMonthly[authorId] || { yes: 0, no: 0 };
  const habits = habitTracker[authorId] || {};

  // Calculate position in leaderboard
  const sorted = Object.entries(fitnessMonthly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
  const position = sorted.findIndex(([uid]) => uid === authorId) + 1;

  let msg = `📊 **${message.author.username}'s Stats**\n\n`;
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
      msg += `• ${habit}: ${data.streak}🔥 (${data.total} total)${checkedToday}\n`;
    });
  } else {
    msg += `**Habits:** None tracked yet. Use \`!addhabit [habit]\` to start!\n`;
  }

  // Show active challenges
  const userChallenges = Object.entries(challenges).filter(([id, chal]) =>
    chal.participants.includes(authorId) && chal.guildId === guild?.id
  );
  if (userChallenges.length > 0) {
    msg += `\n**Active Challenges:** ${userChallenges.length}\n`;
    userChallenges.slice(0, 3).forEach(([id, chal]) => {
      msg += `• ${chal.name}\n`;
    });
  }

  return message.reply(msg);
}

// Separate challenge commands:

// !challenge create (mod only)
if (message.content.startsWith("!challenge create ")) {
  const member = await message.guild?.members.fetch(message.author.id).catch(() => null);
  if (!member || !isModeratorMember(member)) {
    return message.reply("Only moderators can create challenges.");
  }

  const challengeText = message.content.slice(18).trim();
  if (!challengeText) return message.reply("Usage: `!challenge create [challenge description]`");

  const challengeId = Date.now().toString();
  challenges[challengeId] = {
    name: challengeText,
    participants: [],
    createdAt: new Date().toISOString(),
    createdBy: authorId,
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
  return;
}

// !challenge join
if (message.content.startsWith("!challenge join ")) {
  const challengeId = message.content.slice(16).trim();
  const challenge = challenges[challengeId];

  if (!challenge) return message.reply("Challenge not found. Use `!challenges` to see active challenges.");
  if (challenge.participants.includes(authorId)) return message.reply("You're already in this challenge!");

  challenge.participants.push(authorId);
  saveChallenges();
  return message.reply(`You've joined the challenge: "${challenge.name}"! Good luck!`);
}

// !challenges
if (message.content === "!challenges") {
  const guildChallenges = Object.entries(challenges).filter(([id, chal]) =>
    chal.guildId === message.guild?.id
  );

  if (!guildChallenges.length) return message.reply("No active challenges.");

  let msg = "🏆 **Active Challenges:**\n";
  guildChallenges.forEach(([id, chal]) => {
    msg += `• **${chal.name}** (${chal.participants.length} participants) - ID: ${id}\n`;
  });
  msg += "\nUse `!challenge join [ID]` to join a challenge!";
  return message.reply(msg);
}

// !setgoal command
if (message.content.startsWith("!setgoal ")) {
  const goal = parseInt(message.content.split(" ")[1]);
  if (!goal || goal < 1 || goal > 21) {
    return message.reply("Set a weekly workout goal between 1-21: `!setgoal 5`");
  }

  if (!memory.goals) memory.goals = {};
  memory.goals[authorId] = goal;
  saveMemory();

  const current = fitnessWeekly[authorId]?.yes || 0;
  return message.reply(`🎯 Weekly goal set to ${goal} workouts! Current progress: ${current}/${goal}`);
}

// !goal command
if (message.content === "!goal") {
  const goal = memory.goals?.[authorId];
  if (!goal) return message.reply("No goal set. Use `!setgoal [number]` to set a weekly workout goal.");

  const current = fitnessWeekly[authorId]?.yes || 0;
  const percent = Math.min(Math.round((current / goal) * 100), 100);
  const completed = Math.floor(percent / 10);
  const remaining = 10 - completed;
  const bar = "█".repeat(completed) + "░".repeat(remaining);

  let statusEmoji = "🎯";
  let message_text = "";

  if (percent >= 100) {
    statusEmoji = "🏆";
    message_text = " - GOAL CRUSHED! 🔥";
  } else if (percent >= 80) {
    statusEmoji = "💪";
    message_text = " - Almost there!";
  } else if (percent >= 50) {
    statusEmoji = "⚡";
    message_text = " - Keep pushing!";
  }

  return message.reply(`${statusEmoji} **Weekly Goal Progress**\n${current}/${goal} workouts (${percent}%)${message_text}\n[${bar}]`);
}

// !coach command
if (message.content.startsWith("!coach")) {
  const raw = message.content.split(" ").slice(1).join(" ").trim();
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
}

  // OpenAI persona for specific channels
  if (["tips and guide", "wealth", "health", "faith", "fitness"].includes(channelName)) {
    const userMemory = { lastMessage: message.content, previousMessages: memory[channelName][authorId]?.slice(-5) || [] };
    const personaPrompt = () => {
      const basePersona = `You are GymBotBro, a disciplined, stoic, God-fearing mentor with military-level strength and a strategic mindset. Always give advice with authority, clarity, and motivation.`;
      let channelTraits = "";
      switch (channelName) {
        case "faith":
          channelTraits = "Encourage the user spiritually, provide prayerful guidance, and reinforce Christian faith. Include Bible references when helpful.";
          break;
        case "wealth":
          channelTraits = "Provide strategic financial guidance and actionable steps for business and investing.";
          break;
        case "health":
          channelTraits = "Offer disciplined, practical health & wellness advice focused on consistency.";
          break;
        case "fitness":
          channelTraits = "Encourage workouts, resilience, and actionable fitness tips.";
          break;
        case "tips and guide":
          channelTraits = "Provide tactical life hacks and practical advice for everyday challenges.";
          break;
      }
      const context = userMemory.previousMessages.length ? `Consider previous messages: ${userMemory.previousMessages.join(" | ")}` : "";
      return `${basePersona}\n${channelTraits}\n${context}\nUser message: "${userMemory.lastMessage}"\nRespond concisely, authoritatively, and motivatingly.`;
    };
    try {
      const res = await getOpenAIResponse(personaPrompt());
      return message.reply(res);
    } catch (e) {
      console.error("AI persona error:", e);
      return message.reply("⚠ Something went wrong while generating a response.");
    }
  }

  // ------------------ Moderator Commands ------------------
  if (guild) {
    // !strike @user reason
    if (message.content.startsWith("!strike ")) {
      try {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !isModeratorMember(member))
          return await message.reply("You must be a moderator to run this command.");

        const mention = message.mentions.users.first();
        if (!mention)
          return await message.reply("Please mention a user to strike: `!strike @user [reason]`");

        const reason = message.content.split(" ").slice(2).join(" ") || "Violation";

        await applyStrike({
          guild,
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
    }

    // !strikes @user
    if (message.content.startsWith("!strikes ")) {
      try {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !isModeratorMember(member))
          return await message.reply("You must be a moderator to run this command.");

        const mention = message.mentions.users.first();
        if (!mention) return await message.reply("Please mention a user: `!strikes @user`");

        const rec =
          strikes[guild.id]?.[mention.id] ?? { count: 0, history: [] };

        let out = `⚖️ Strikes for <@${mention.id}>: ${rec.count}\nRecent history:\n`;
        rec.history.slice(-10).forEach(
          (h) =>
            (out += `- ${h.time}: ${h.reason} (by ${h.issuer ? `<@${h.issuer}>` : "system"})\n`)
        );

        return await message.reply(out);
      } catch (e) {
        console.error("!strikes error:", e);
        return await message.reply("Couldn't fetch strikes.");
      }
    }

    // !clearstrikes @user
    if (message.content.startsWith("!clearstrikes ")) {
      try {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !isModeratorMember(member))
          return await message.reply("You must be a moderator to run this command.");

        const mention = message.mentions.users.first();
        if (!mention) return await message.reply("Please mention a user: `!clearstrikes @user`");

        if (strikes[guild.id]?.[mention.id]) {
          delete strikes[guild.id][mention.id];
          saveStrikes();
          await notifyLoggingChannel(
            guild,
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
    }

    // !blockpair @user
    if (message.content.startsWith("!blockpair ")) {
      try {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !isModeratorMember(member))
          return await message.reply("You must be a moderator to run this command.");

        const mention = message.mentions.users.first();
        if (!mention) return await message.reply("Please mention a user: `!blockpair @user`");

        const rec = ensureStrikeRecord(guild.id, mention.id);
        rec.blockedFromMatching = true;
        saveStrikes();

        return await message.reply(`<@${mention.id}> has been blocked from future pairings.`);
      } catch (e) {
        console.error("!blockpair error:", e);
        return await message.reply("Couldn't block user from pairing.");
      }
    }

    // !unblockpair @user
    if (message.content.startsWith("!unblockpair ")) {
      try {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !isModeratorMember(member))
          return await message.reply("You must be a moderator to run this command.");

        const mention = message.mentions.users.first();
        if (!mention) return await message.reply("Please mention a user: `!unblockpair @user`");

        const rec = ensureStrikeRecord(guild.id, mention.id);
        rec.blockedFromMatching = false;
        saveStrikes();

        return await message.reply(`<@${mention.id}> has been unblocked for future pairings.`);
      } catch (e) {
        console.error("!unblockpair error:", e);
        return await message.reply("Couldn't unblock user from pairing.");
      }
    }

    // Testing hooks: !teststrike @user
    if (message.content.startsWith("!teststrike ")) {
      try {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !isModeratorMember(member))
          return await message.reply("You must be a moderator to run this test.");

        const mention = message.mentions.users.first();
        if (!mention) return await message.reply("Please mention a user: `!teststrike @user`");

        await applyStrike({
          guild,
          userId: mention.id,
          issuerId: message.author.id,
          reason: "Test strike",
        });

        return await message.reply(`Test strike applied to <@${mention.id}>.`);
      } catch (e) {
        console.error("!teststrike error:", e);
        return await message.reply("Test strike failed.");
      }
    }

    // !testpair @user1 @user2
    if (message.content.startsWith("!testpair ")) {
      try {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !isModeratorMember(member))
          return await message.reply("You must be a moderator to run this test.");

        const mentions = message.mentions.users.map((u) => u.id);
        if (!mentions || mentions.length < 2)
          return await message.reply("Please mention two users: `!testpair @user1 @user2`");

        const ch = await createPartnerChannel(guild, mentions[0], mentions[1], { type: "goal" });
        return await message.reply(`Test pairing created: ${ch ? ch.toString() : "failed"}`);
      } catch (e) {
        console.error("!testpair error:", e);
        return await message.reply("Test pair failed.");
      }
    }
  } // end guild check
});

// ------------------ Slash Command Interaction Handler ------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guild, user } = interaction;

  try {
    // /progress
    if (commandName === "progress") {
      const uid = user.id;
      const weekly = fitnessWeekly[uid] || { yes: 0, no: 0 };
      const monthly = fitnessMonthly[uid] || { yes: 0, no: 0 };
      const streak = weekly.yes - weekly.no;
      await interaction.reply({
        content: `📊 **Your Progress**\nWeekly → ✅ ${weekly.yes} | ❌ ${weekly.no}\nMonthly → ✅ ${monthly.yes} | ❌ ${monthly.no}\nStreak (weekly yes - no): ${streak}`,
        ephemeral: true
      });
      return;
    }

    // /coach
    if (commandName === "coach") {
      const topic = options.getString("topic") || "motivation and accountability for daily goals";
      await interaction.deferReply();
      const coachPersona = `
You are GymBotBro's Coach persona. Blend three tones:
1) The disciplined coach (clear, strategic, action-oriented),
2) The motivational speaker (energetic, encouraging, vivid),
3) The empathetic friend (understanding, human, warms failure into growth).
User request: "${topic}"
Keep response concise (6-10 sentences), include 2 quick action steps the user can do today, one small affirmation line, and a short practical tip about staying consistent with habits.
Do not lecture. Be direct, positive, and human. Use occasional emojis but not more than 3.
`;
      const reply = await getOpenAIResponse(coachPersona);
      await interaction.editReply(reply);
      return;
    }

    // /partner group
    if (commandName === "partner") {
      const sub = options.getSubcommand(false) || options.getSubcommand();
      if (sub === "queue") {
        try {
          await interaction.reply({ content: "I'll DM you to choose Goal or Future partner and add you to the queue.", ephemeral: true });
          const dm = await interaction.user.send("Which partner type would you like? Reply with `goal` or `future` (or `cancel`).");
          const filter = m => m.author.id === user.id;
          const collected = await dm.channel.awaitMessages({ filter, max: 1, time: 60000 }).catch(() => null);
          let selection = "goal";
          if (collected && collected.first()) {
            const resp = collected.first().content.toLowerCase();
            if (resp.startsWith("future")) selection = "future";
            if (resp.startsWith("cancel")) return dm.channel.send("Partner request cancelled.");
          } else {
            await dm.channel.send("No response received — added to queue as Goal Partner by default.");
          }
          if (!Array.isArray(partnerQueue)) partnerQueue = [];
          partnerQueue.push({ id: user.id, type: selection, joinedAt: new Date().toISOString() });
          savePartnerQueue();
          await dm.channel.send(`You've been added to the partner queue as **${selection}**. Standby.`);
        } catch (e) {
          if (!Array.isArray(partnerQueue)) partnerQueue = [];
          partnerQueue.push({ id: user.id, type: "goal", joinedAt: new Date().toISOString() });
          savePartnerQueue();
          await interaction.editReply({ content: "Couldn't DM you — you've been added to the queue as a Goal Partner.", ephemeral: true });
        }
        return;
      }

      if (sub === "cancel") {
        if (!Array.isArray(partnerQueue)) partnerQueue = [];
        const idx = partnerQueue.findIndex(x => x.id === user.id);
        if (idx === -1) return interaction.reply({ content: "You're not in the partner queue.", ephemeral: true });
        partnerQueue.splice(idx, 1);
        savePartnerQueue();
        return interaction.reply({ content: "You've been removed from the partner queue.", ephemeral: true });
      }

      if (sub === "end") {
        try {
          const entry = Object.entries(partners).find(([chan, info]) => info.users.includes(user.id));
          if (!entry) return interaction.reply({ content: "You don't appear to have an active partner channel.", ephemeral: true });
          const [chanId] = entry;
          const guildObj = guild || client.guilds.cache.get(interaction.guildId);
          const channelObj = guildObj.channels.cache.get(chanId) || await client.channels.fetch(chanId).catch(() => null);
          if (!channelObj) {
            delete partners[chanId];
            savePartners();
            return interaction.reply({ content: "Partner channel not found. Your pairing has been cleared.", ephemeral: true });
          }
          await endPartnerChannel(channelObj, `Ended by user ${user.tag}`);
          return interaction.reply({ content: "Your accountability pairing has been ended.", ephemeral: true });
        } catch (e) {
          console.error("/partner end error:", e);
          return interaction.reply({ content: "Failed to end partner pairing.", ephemeral: true });
        }
      }

      if (sub === "status") {
        const queued = Array.isArray(partnerQueue) ? partnerQueue.length : 0;
        return interaction.reply({ content: `Partner queue length: ${queued}`, ephemeral: true });
      }
    }

    // /strike subcommands
    if (commandName === "strike") {
      const subcmd = options.getSubcommand();
      const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
      if (!member || !isModeratorMember(member)) return interaction.reply({ content: "You must be a moderator to use strike commands.", ephemeral: true });

      const u = options.getUser("user");
      if (!u) return interaction.reply({ content: "You must provide a user.", ephemeral: true });

      if (subcmd === "add") {
        const reason = options.getString("reason") || "Violation";
        await applyStrike({ guild, userId: u.id, issuerId: interaction.user.id, reason });
        return interaction.reply({ content: `Strike applied to <@${u.id}> for: ${reason}`, ephemeral: false });
      }

      if (subcmd === "check") {
        const rec = strikes[guild.id] && strikes[guild.id][u.id] ? strikes[guild.id][u.id] : { count: 0, history: [] };
        let out = `⚖️ Strikes for <@${u.id}>: ${rec.count}\nRecent:\n`;
        rec.history.slice(-10).forEach(h => out += `- ${h.time}: ${h.reason} (by ${h.issuer ? `<@${h.issuer}>` : "system"})\n`);
        return interaction.reply({ content: out, ephemeral: false });
      }

      if (subcmd === "clear") {
        if (strikes[guild.id] && strikes[guild.id][u.id]) {
          delete strikes[guild.id][u.id];
          saveStrikes();
          await notifyLoggingChannel(guild, `✅ <@${u.id}>'s strikes cleared by <@${interaction.user.id}>.`);
          return interaction.reply({ content: `Strikes for <@${u.id}> cleared.`, ephemeral: false });
        } else {
          return interaction.reply({ content: "User has no strikes recorded.", ephemeral: true });
        }
      }
    }

    // /testpair (mod only)
    if (commandName === "testpair") {
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isModeratorMember(member)) return interaction.reply({ content: "You must be a moderator to run this test.", ephemeral: true });
      const u1 = options.getUser("user1");
      const u2 = options.getUser("user2");
      if (!u1 || !u2) return interaction.reply({ content: "You must mention two users.", ephemeral: true });
      const ch = await createPartnerChannel(guild, u1.id, u2.id, { type: "goal" });
      return interaction.reply({ content: `Test pairing created: ${ch ? ch.toString() : "failed"}`, ephemeral: false });
    }

    // /teststrike (mod only)
    if (commandName === "teststrike") {
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isModeratorMember(member)) return interaction.reply({ content: "You must be a moderator to run this test.", ephemeral: true });
      const u = options.getUser("user");
      if (!u) return interaction.reply({ content: "You must mention a user.", ephemeral: true });
      await applyStrike({ guild, userId: u.id, issuerId: interaction.user.id, reason: "Test strike" });
      return interaction.reply({ content: `Test strike applied to <@${u.id}>.`, ephemeral: false });
    }

  } catch (e) {
    console.error("interaction handler error:", e);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply("An error occurred.");
      } else {
        await interaction.reply({ content: "An error occurred.", ephemeral: true });
      }
    } catch (innerErr) {
      console.error("Failed to reply to interaction error:", innerErr);
    }
  }
});

// ------------------ Bot Login ------------------
client.login(process.env.DISCORD_TOKEN);