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
}

function saveMemory() { 
  try { 
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); 
  } catch (e) { 
    console.error("Save memory error:", e); 
  } 
}

function saveBirthdays() { 
  try { 
    fs.writeFileSync(BIRTHDAY_FILE, JSON.stringify(birthdays, null, 2)); 
  } catch (e) { 
    console.error("Save birthdays error:", e); 
  } 
}

function saveWeekly() { 
  try { 
    fs.writeFileSync(FITNESS_WEEKLY_FILE, JSON.stringify(fitnessWeekly, null, 2)); 
  } catch (e) { 
    console.error("Save weekly error:", e); 
  } 
}

function saveMonthly() { 
  try { 
    fs.writeFileSync(FITNESS_MONTHLY_FILE, JSON.stringify(fitnessMonthly, null, 2)); 
  } catch (e) { 
    console.error("Save monthly error:", e); 
  } 
}

function savePartnerQueue() { 
  try { 
    fs.writeFileSync(PARTNER_QUEUE_FILE, JSON.stringify(partnerQueue, null, 2)); 
  } catch (e) { 
    console.error("Save queue error:", e); 
  } 
}

function savePartners() { 
  try { 
    fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2)); 
  } catch (e) { 
    console.error("Save partners error:", e); 
  } 
}

function saveStrikes() { 
  try { 
    fs.writeFileSync(STRIKES_FILE, JSON.stringify(strikes, null, 2)); 
  } catch (e) { 
    console.error("Save strikes error:", e); 
  } 
}

function saveHabits() {
  try { 
    fs.writeFileSync(HABITS_FILE, JSON.stringify(habitTracker, null, 2)); 
  } catch (e) { 
    console.error("Save habits error:", e); 
  } 
}

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
    // We'll call checkRoleRewards elsewhere
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
          await notifyLoggingChannel(guild, `⚡ Tried to ban <@${userId}> but missing BanMembers permission.`);
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
client.once("ready", async () => {
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
      const updates = await getSportsUpdates();
      await ch.send({ content: `🥊 Sports Updates:\n${updates}` });
    }, { timezone: "America/New_York" });
  });

  // Daily fitness videos at 9am
  cron.schedule("0 9 * * *", async () => {
    const ch = client.channels.cache.find(c => (c.name || "").toLowerCase() === "fitness");
    if (!ch) return;
    const videos = await getRandomFitnessVideos(2);
    await ch.send({ content: `🏋️‍♂️ Daily Workout Inspiration:\n${videos.join('\n\n')}` });
  }, { timezone: "America/New_York" });

  // Weekly leaderboard update on Sundays
  cron.schedule("0 20 * * 0", async () => {
    await updateLeaderboardChannel();
    // Check role rewards for all users
    for (const [userId, data] of Object.entries(fitnessMonthly)) {
      for (const guild of client.guilds.cache.values()) {
        await checkRoleRewards(userId, guild);
      }
    }
  }, { timezone: "America/New_York" });

  // Monthly reset on 1st day of month
  cron.schedule("0 0 1 * *", async () => {
    console.log("Monthly fitness stats reset");
    // Archive monthly data before reset
    const archiveDate = new Date();
    archiveDate.setMonth(archiveDate.getMonth() - 1);
    const archiveMonth = archiveDate.toISOString().slice(0, 7); // YYYY-MM format
    
    try {
      fs.writeFileSync(
        path.join(DATA_DIR, `fitnessMonthly-${archiveMonth}.json`), 
        JSON.stringify(fitnessMonthly, null, 2)
      );
      
      // Reset monthly stats but keep user entries
      for (const userId in fitnessMonthly) {
        fitnessMonthly[userId] = { yes: 0, no: 0 };
      }
      saveMonthly();
      
      // Announce reset
      const announceChannel = client.channels.cache.find(ch => (ch.name || "").toLowerCase() === "announcements");
      if (announceChannel) {
        await announceChannel.send("📊 Monthly fitness stats have been reset! New month, new goals! 💪");
      }
    } catch (e) {
      console.error("Monthly reset error:", e);
    }
  }, { timezone: "America/New_York" });

  // Weekly reset on Mondays
  cron.schedule("0 0 * * 1", async () => {
    console.log("Weekly fitness stats reset");
    // Reset weekly stats but keep user entries
    for (const userId in fitnessWeekly) {
      fitnessWeekly[userId] = { yes: 0, no: 0 };
    }
    saveWeekly();
    
    // Announce reset
    const announceChannel = client.channels.cache.find(ch => (ch.name || "").toLowerCase() === "announcements");
    if (announceChannel) {
      await announceChannel.send("📊 Weekly fitness stats have been reset! New week, new opportunities! 💪");
    }
  }, { timezone: "America/New_York" });

  console.log("All cron jobs scheduled");
});

// ------------------ Message Event Handler ------------------
client.on("messageCreate", async (message) => {
  // Add message handling logic here
  // This would include commands like !coach, !progress, etc.
});

// ------------------ Interaction Event Handler ------------------
client.on("interactionCreate", async (interaction) => {
  // Add interaction handling logic here
  // This would handle slash commands like /partner, /strike, etc.
});

// ------------------ Login to Discord ------------------
client.login(process.env.DISCORD_TOKEN);