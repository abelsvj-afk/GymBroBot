// bot.js
import dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import OpenAI from 'openai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import axios from 'axios';
import { google } from 'googleapis';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL', 'MESSAGE', 'REACTION']
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Persistent Data ----------------
const dataDir = './data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const files = {
  memory: path.join(dataDir, 'memory.json'),
  birthdays: path.join(dataDir, 'birthdays.json'),
  weekly: path.join(dataDir, 'weekly.json'),
  monthly: path.join(dataDir, 'monthly.json'),
  partnerQueue: path.join(dataDir, 'partnerQueue.json'),
  partners: path.join(dataDir, 'partners.json'),
  strikes: path.join(dataDir, 'strikes.json'),
  habits: path.join(dataDir, 'habits.json'),
  challenges: path.join(dataDir, 'challenges.json'),
  onboarding: path.join(dataDir, 'onboarding.json'),
  matches: path.join(dataDir, 'matches.json'),
  leaderboard: path.join(dataDir, 'leaderboard.json'),
  checkInMutes: path.join(dataDir, 'checkInMutes.json'),
  healthPosts: path.join(dataDir, 'healthPosts.json'),
  wealthTips: path.join(dataDir, 'wealthTips.json'),
  fitnessPosts: path.join(dataDir, 'fitnessPosts.json')
};

let memory = {}, birthdays = {}, fitnessWeekly = {}, fitnessMonthly = {};
let partnerQueue = [], partners = {}, strikes = {}, habitTracker = {};
let challenges = {}, onboarding = {}, matches = {}, leaderboardPotential = {};
let checkInMutes = {}, healthPosts = [], wealthTips = [], fitnessPosts = [];

// ---------------- Save/Load Helpers ----------------
const safeWrite = (file, obj) => { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch(e){ console.error(`Error saving ${file}:`, e); } };
const safeRead = (file, fallback) => { try { if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e){ console.error(`Error loading ${file}:`, e); } return fallback; };

const saveLoadMap = {
  memory: [() => safeWrite(files.memory, memory), () => memory = safeRead(files.memory, {})],
  weekly: [() => safeWrite(files.weekly, fitnessWeekly), () => fitnessWeekly = safeRead(files.weekly, {})],
  monthly: [() => safeWrite(files.monthly, fitnessMonthly), () => fitnessMonthly = safeRead(files.monthly, {})],
  partnerQueue: [() => safeWrite(files.partnerQueue, partnerQueue), () => partnerQueue = safeRead(files.partnerQueue, [])],
  partners: [() => safeWrite(files.partners, partners), () => partners = safeRead(files.partners, {})],
  strikes: [() => safeWrite(files.strikes, strikes), () => strikes = safeRead(files.strikes, {})],
  habits: [() => safeWrite(files.habits, habitTracker), () => habitTracker = safeRead(files.habits, {})],
  challenges: [() => safeWrite(files.challenges, challenges), () => challenges = safeRead(files.challenges, {})],
  onboarding: [() => safeWrite(files.onboarding, onboarding), () => onboarding = safeRead(files.onboarding, {})],
  matches: [() => safeWrite(files.matches, matches), () => matches = safeRead(files.matches, {})],
  leaderboard: [() => safeWrite(files.leaderboard, leaderboardPotential), () => leaderboardPotential = safeRead(files.leaderboard, {})],
  checkInMutes: [() => safeWrite(files.checkInMutes, checkInMutes), () => checkInMutes = safeRead(files.checkInMutes, {})],
  healthPosts: [() => safeWrite(files.healthPosts, healthPosts), () => healthPosts = safeRead(files.healthPosts, [])],
  wealthTips: [() => safeWrite(files.wealthTips, wealthTips), () => wealthTips = safeRead(files.wealthTips, [])],
  fitnessPosts: [() => safeWrite(files.fitnessPosts, fitnessPosts), () => fitnessPosts = safeRead(files.fitnessPosts, [])]
};

function loadAllData() { Object.values(saveLoadMap).forEach(([_, load]) => load()); console.log("All data loaded"); }
function saveAllData() { Object.values(saveLoadMap).forEach(([save]) => save()); }

// Shorthand save functions for individual data types
const saveMemory = () => saveLoadMap.memory[0]();
const saveWeekly = () => saveLoadMap.weekly[0]();
const saveMonthly = () => saveLoadMap.monthly[0]();
const savePartnerQueue = () => saveLoadMap.partnerQueue[0]();
const savePartners = () => saveLoadMap.partners[0]();
const saveStrikes = () => saveLoadMap.strikes[0]();
const saveHabits = () => saveLoadMap.habits[0]();
const saveChallenges = () => saveLoadMap.challenges[0]();
const saveOnboarding = () => saveLoadMap.onboarding[0]();
const saveMatches = () => saveLoadMap.matches[0]();
const saveLeaderboard = () => saveLoadMap.leaderboard[0]();
const saveCheckInMutes = () => saveLoadMap.checkInMutes[0]();
const saveHealthPosts = () => saveLoadMap.healthPosts[0]();
const saveWealthTips = () => saveLoadMap.wealthTips[0]();
const saveFitnessPosts = () => saveLoadMap.fitnessPosts[0]();

// ---------------- Express ----------------
app.use(express.json());
app.get('/', (req,res)=>res.json({ status:'GymBotBro running', uptime:process.uptime(), guilds:client.guilds.cache.size, users:client.users.cache.size }));
app.listen(PORT, ()=>console.log(`Express server running on port ${PORT}`));

// ---------------- OpenAI Helper ----------------
async function getOpenAIResponse(prompt){
  try{
    const completion = await openai.chat.completions.create({ model:"gpt-3.5-turbo", messages:[{role:"user", content:prompt}], max_tokens:300, temperature:0.7 });
    return completion.choices[0].message.content.trim();
  } catch(e){ console.error("OpenAI error:",e); return "I can't respond right now."; }
}

// ---------------- Thresholds ----------------
const STRIKE_LIMIT = 3;
const EXPOSURE_THRESHOLDS = { tier1:{messages:5,days:2}, tier2:{messages:20,days:7}, tier3:{messages:40,days:21} };
const LEADERBOARD_UPDATE_CRON = '0 6 * * *';
const ENGAGEMENT_REMINDER_CRON = '0 12 1,15 * *';
const CHECK_IN_TIMES = ['0 8 * * *', '0 12 * * *', '0 15 * * *', '0 18 * * *', '0 20 * * *', '0 22 * * *']; // 8am, 12pm, 3pm, 6pm, 8pm, 10pm
const HEALTH_POST_CRON = '0 10,16 * * *'; // 10am and 4pm
const WEALTH_TIP_CRON = '0 9,17 * * *'; // 9am and 5pm
const FITNESS_POST_CRON = '0 7,13,19 * * *'; // 7am, 1pm, and 7pm

// ---------------- Validation ----------------
const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phoneRegex = /(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;
const urlRegex = /(https?:\/\/[^\s]+)/i;
const namePhraseRegex = /\b(my name is|i'm|i am|call me)\b\s+([A-Z][a-z]{1,30})/i;
const addressLikeRegex = /\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr)\b/i;

function containsForbiddenInfo(text){
  if(!text) return false;
  return emailRegex.test(text) || phoneRegex.test(text) || urlRegex.test(text) || namePhraseRegex.test(text) || addressLikeRegex.test(text) || /full name[:\s]/i.test(text) || /\b(contact me|call me|text me|dm me|email me)\b/i.test(text);
}

function simpleSimilarityScore(a,b){
  if(!a?.tags||!b?.tags) return 0;
  const setB = new Set(b.tags.map(t=>t.toLowerCase())); let matches=0;
  for(const t of a.tags) if(setB.has(t.toLowerCase())) matches++;
  return matches;
}

// ---------------- Onboarding ----------------
async function startOnboarding(user,type){
  try{
    const dm = await user.createDM();
    await dm.send(`Welcome! You selected **${type}** partner. Reply 'cancel' to stop.`);
    const questions = type==='goal'?[
      {key:'role',q:'Confirm "goal"'},{key:'goals',q:'Main fitness goals?'},{key:'habits',q:'Which daily habits?'},{key:'checkins',q:'Check-in frequency? (daily/weekly)'},{key:'tags',q:'Keywords/interests?'}
    ]:[
      {key:'role',q:'Confirm "future"'},{key:'birthdate',q:'Enter birthdate YYYY-MM-DD'},{key:'interests',q:'List hobbies/interests'},{key:'values',q:'Values/preferences'},{key:'hidden',q:'Provide personal info (or "none")'},{key:'tags',q:'Keywords/interests?'}
    ];
    const answers = {}; let step=0;
    const collector = dm.createMessageCollector({time:1000*60*10});
    dm.send(questions[step].q);
    collector.on('collect', m=>{
      if(m.author.id!==user.id) return;
      if(m.content.toLowerCase()==='cancel'){collector.stop('cancelled'); return;}
      const text = m.content.trim();
      const currentQ = questions[step];
      if(currentQ.key==='birthdate'){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(text)){dm.send('Format YYYY-MM-DD'); return;}
        const age = Math.floor((Date.now()-new Date(text).getTime())/(1000*60*60*24*365.25));
        if(age<18){dm.send('18+ required'); collector.stop('underage'); return;}
        answers.birthdate=text;
      } else answers[currentQ.key]=text;
      step++; if(step>=questions.length) collector.stop('finished'); else dm.send(questions[step].q);
    });
    collector.on('end',async(collected,reason)=>{
      if(reason==='cancelled'){dm.send('Cancelled'); return;}
      if(reason==='underage') return;
      onboarding[user.id]={userId:user.id,type,timestamp:Date.now(),raw:answers,tags:(answers.tags||answers.interests||answers.goals||'').split(',').map(s=>s.trim()).filter(Boolean),hidden:answers.hidden||null};
      saveOnboarding();
      partnerQueue.push(user.id); savePartnerQueue();
      await dm.send('Application recorded. Use !leavequeue to exit.');
    });
  } catch(e){ console.error('Onboarding error:',e); }
}

// ---------------- Matching ----------------
function tryAutoMatch(){
  if(partnerQueue.length<2) return;
  const processed = new Set(); const newPairs=[];
  for(let i=0;i<partnerQueue.length;i++){
    const aId=partnerQueue[i]; if(processed.has(aId)) continue; const aOn=onboarding[aId]; if(!aOn) continue;
    let bestScore=0, bestIdx=-1;
    for(let j=i+1;j<partnerQueue.length;j++){
      const bId=partnerQueue[j]; if(processed.has(bId)) continue; const bOn=onboarding[bId]; if(!bOn) continue;
      if(aOn.type!==bOn.type) continue;
      const score=simpleSimilarityScore(aOn,bOn);
      if(score>bestScore){bestScore=score; bestIdx=j;}
    }
    if(bestIdx!==-1){processed.add(aId); processed.add(partnerQueue[bestIdx]); newPairs.push([aId,partnerQueue[bestIdx]]);}
  }
  partnerQueue=partnerQueue.filter(id=>!processed.has(id)); savePartnerQueue();
  newPairs.forEach(([aId,bId])=>{(async()=>{
    const mutualGuild=[...client.guilds.cache.values()].find(g=>g.members.cache.has(aId)&&g.members.cache.has(bId));
    if(!mutualGuild){partnerQueue.push(aId,bId); savePartnerQueue(); return;}
    const channel=await createPrivateChannelForPair(mutualGuild,aId,bId,onboarding[aId].type);
    partners[channel.id]={channelId:channel.id,guildId:mutualGuild.id,userA:aId,userB:bId,type:onboarding[aId].type,createdAt:Date.now(),exposure:{[aId]:{messagesExchanged:0,firstInteraction:null},[bId]:{messagesExchanged:0,firstInteraction:null}}};
    matches[aId]=channel.id; matches[bId]=channel.id; savePartners(); saveMatches();
    strikes[channel.id]={[aId]:0,[bId]:0}; saveStrikes();
    await postInitialPinnedRules(channel, partners[channel.id]);
    try{(await client.users.fetch(aId)).send(`Paired! Channel: <#${channel.id}>`);(await client.users.fetch(bId)).send(`Paired! Channel: <#${channel.id}>`);}catch{}
  })();});
}

// ---------------- Private Channel + Rules ----------------
async function createPrivateChannelForPair(guild, userAId, userBId, pairType = 'goal') {
  const everyoneRole = guild.roles.everyone.id;
  const perms = [
    { id: everyoneRole, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userAId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: userBId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
  ];

  // include admin/mod/owner roles if present
  const adminRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'admin');
  const modRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'moderator');
  const ownerRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'owner');
  [adminRole, modRole, ownerRole].forEach(role => {
    if (role) perms.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] });
  });

  const channelName = `partner-${userAId.slice(0, 4)}-${userBId.slice(0, 4)}`;
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites: perms
  });

  await postInitialPinnedRules(channel, { userA: userAId, userB: userBId, type: pairType });
  return channel;
}

// ---------------- Pin Initial Rules ----------------
async function postInitialPinnedRules(channel, partnerRecord) {
  const rules = [
    `Welcome to your private partner channel. This is for ${partnerRecord.type === 'goal' ? 'Goal Partner accountability' : 'Future Partner slow reveal'} only.`,
    'Rules: No sharing hidden info outside allowed tiers. No contacting your partner outside this channel. Violations = strikes.',
    `Three strikes -> automatic deletion of this channel and block from future matches.`
  ].join('\n\n');

  const pinnedRules = await channel.send({ content: rules });
  await pinnedRules.pin();

  const checkinTemplate = await channel.send(`Check-in template:\n• How was your workout today?\n• Any blockers?\n• Plan for tomorrow:`);
  await checkinTemplate.pin();
}

// ---------------- Strike Management ----------------
async function applyStrike(channelId, userId, reason = 'violation') {
  if (!strikes[channelId]) strikes[channelId] = {};
  strikes[channelId][userId] = (strikes[channelId][userId] || 0) + 1;
  saveStrikes();

  const rec = partners[channelId];
  const guild = rec ? client.guilds.cache.get(rec.guildId) : null;
  const loggingChannel = guild?.channels.cache.find(ch => ch.name === 'logging' && ch.type === ChannelType.GuildText);
  if (loggingChannel) {
    loggingChannel.send(`User <@${userId}> received a strike in <#${channelId}>. Reason: ${reason}. Total strikes: ${strikes[channelId][userId]}`);
  }

  try {
    const user = await client.users.fetch(userId);
    await user.send(`You received a strike for: ${reason}. Strike ${strikes[channelId][userId]}/${STRIKE_LIMIT}. Check pinned rules.`);
  } catch (e) {}

  if (strikes[channelId][userId] >= STRIKE_LIMIT) {
    await handleChannelDeletionAndBlock(channelId, `Reached ${STRIKE_LIMIT} strikes`);
  }
}

// ---------------- Delete Channel + Block ----------------
async function handleChannelDeletionAndBlock(channelId, reason = 'strike limit') {
  const rec = partners[channelId];
  if (!rec) return;

  try {
    const guild = client.guilds.cache.get(rec.guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (channel) {
      await channel.send(`This private channel will be deleted due to: ${reason}`);
      await channel.delete('Strike threshold reached');
    }
  } catch (e) {}

  [rec.userA, rec.userB].forEach(uid => {
    if (!onboarding[uid]) onboarding[uid] = {};
    onboarding[uid].blockedFromMatching = true;
  });
  saveOnboarding();

  delete partners[channelId];
  savePartners();

  Object.keys(matches).forEach(uid => {
    if (matches[uid] === channelId) delete matches[uid];
  });
  saveMatches();

  const guild = client.guilds.cache.get(rec.guildId);
  const loggingChannel = guild?.channels.cache.find(ch => ch.name === 'logging' && ch.type === ChannelType.GuildText);
  if (loggingChannel) loggingChannel.send(`Deleted private channel ${channelId} and blocked users due to: ${reason}`);
}

// ---------------- Exposure Unlocks ----------------
function checkExposureUnlocks(channelId) {
  const rec = partners[channelId];
  if (!rec || rec.type !== 'future') return;

  const aId = rec.userA, bId = rec.userB;
  const aExposure = rec.exposure[aId], bExposure = rec.exposure[bId];
  const first = Math.min(aExposure.firstInteraction || Date.now(), bExposure.firstInteraction || Date.now());
  const daysElapsed = (Date.now() - first) / (1000 * 60 * 60 * 24);

  function getTier(exposure) {
    if (exposure.messagesExchanged >= EXPOSURE_THRESHOLDS.tier3.messages && daysElapsed >= EXPOSURE_THRESHOLDS.tier3.days) return 3;
    if (exposure.messagesExchanged >= EXPOSURE_THRESHOLDS.tier2.messages && daysElapsed >= EXPOSURE_THRESHOLDS.tier2.days) return 2;
    if (exposure.messagesExchanged >= EXPOSURE_THRESHOLDS.tier1.messages && daysElapsed >= EXPOSURE_THRESHOLDS.tier1.days) return 1;
    return 0;
  }

  const minTier = Math.min(getTier(aExposure), getTier(bExposure));
  if (!rec.revealedTier) rec.revealedTier = 0;
  if (minTier > rec.revealedTier) {
    rec.revealedTier = minTier;
    savePartners();

    (async () => {
      const guild = client.guilds.cache.get(rec.guildId);
      const channel = guild?.channels.cache.get(channelId);
      if (!channel) return;

      const reveal = (uid, tier) => {
        const hidden = onboarding[uid]?.hidden || '';
        if (!hidden) return 'No hidden info provided.';
        const parts = hidden.split('\n').filter(Boolean);
        return parts.slice(0, tier).join('\n') || hidden;
      };

      await channel.send(`🔓 **Incremental exposure update:** Tier ${minTier} unlocked! Be respectful.`);
      const userA = await client.users.fetch(aId);
      const userB = await client.users.fetch(bId);
      try { await userA.send(`New info about your partner (Tier ${minTier}):\n${reveal(bId, minTier)}`); } catch { await channel.send('DM to userA blocked'); }
      try { await userB.send(`New info about your partner (Tier ${minTier}):\n${reveal(aId, minTier)}`); } catch { await channel.send('DM to userB blocked'); }
    })();
  }
}

// ---------------- Command Handlers ----------------
const commandHandlers = {
  async help(message) {
    const embed = new EmbedBuilder()
      .setTitle("💪 GymBotBro Commands")
      .setDescription("Your accountability partner for fitness and life!")
      .addFields(
        { name: "🎯 Fitness", value: "`!track yes/no` - Log workout\n`!progress` - View stats\n`!leaderboard` - Rankings", inline: true },
        { name: "📈 Habits", value: "`!addhabit [habit]` - Track habit\n`!habits` - View habits\n`!check [habit]` - Check off", inline: true },
        { name: "💪 Coaching", value: "`!coach [question]` - Get advice\n`!quote` - Motivation\n`!workoutplan` - Get workout", inline: true },
        { name: "👥 Partners", value: "`!partner goal` - Find accountability partner\n`!partner future` - Find future partner\n`!leavequeue` - Exit matching queue", inline: true }
      )
      .setColor(0x00AE86);

    return message.reply({ embeds: [embed] });
  },

  async coach(message, args) {
    if (!args.length) {
      return message.reply("Ask me anything about fitness! Example: `!coach How do I build muscle?`");
    }

    const question = args.join(" ");
    const prompt = `You are GymBotBro, a fitness coach. Answer this question in 2-3 sentences: "${question}"`;

    try {
      const response = await getOpenAIResponse(prompt);
      return message.reply(`💪 **Coach says:**\n${response}`);
    } catch (error) {
      return message.reply("I'm having trouble thinking right now, try again!");
    }
  },

  async track(message, args) {
    const type = args[0]?.toLowerCase();
    if (!type || !['yes', 'no', 'y', 'n'].includes(type)) {
      return message.reply("Usage: `!track yes` or `!track no`");
    }

    const authorId = message.author.id;
    if (!fitnessWeekly[authorId]) fitnessWeekly[authorId] = { yes: 0, no: 0 };

    const isYes = ['yes', 'y'].includes(type);
    
    if (isYes) {
      fitnessWeekly[authorId].yes += 1;
      await message.react('💪');
      message.reply("Beast mode activated! 🔥");
    } else {
      fitnessWeekly[authorId].no += 1;
      await message.react('❌');
      message.reply("Tomorrow is a new day! 💯");
    }

    saveWeekly();
  },

  async progress(message) {
    const authorId = message.author.id;
    const data = fitnessWeekly[authorId] || { yes: 0, no: 0 };

    const total = data.yes + data.no;
    const rate = total > 0 ? Math.round((data.yes / total) * 100) : 0;

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${message.author.username}'s Progress`)
      .addFields(
        { name: "This Week", value: `✅ ${data.yes} workouts\n❌ ${data.no} missed\nSuccess Rate: ${rate}%`, inline: true }
      )
      .setColor(rate >= 70 ? 0x00FF00 : rate >= 50 ? 0xFFFF00 : 0xFF0000);

    return message.reply({ embeds: [embed] });
  },

  async leaderboard(message) {
    const sorted = Object.entries(fitnessWeekly).sort((a, b) => b[1].yes - a[1].yes);
    
    if (!sorted.length) return message.reply("No fitness data recorded this week.");
    
    let msg = "🏆 **WEEKLY LEADERBOARD** 🏆\n\n";
    const medals = ["🥇", "🥈", "🥉"];
    
    sorted.slice(0, 5).forEach(([userId, data], index) => {
      msg += `${medals[index] || "🔸"} <@${userId}> - ${data.yes} workouts\n`;
    });
    
    return message.reply(msg);
  },

  async addhabit(message, args) {
    const habit = args.join(" ").trim();
    if (!habit) return message.reply("Usage: `!addhabit [habit name]`");

    const authorId = message.author.id;
    if (!habitTracker[authorId]) habitTracker[authorId] = {};
    
    if (habitTracker[authorId][habit]) {
      return message.reply("You're already tracking that habit!");
    }

    habitTracker[authorId][habit] = {
      streak: 0,
      lastChecked: null,
      total: 0
    };
    
    saveHabits();
    return message.reply(`✅ Started tracking: **${habit}**\nUse \`!check ${habit}\` daily!`);
  },

  async habits(message) {
    const authorId = message.author.id;
    const userHabits = habitTracker[authorId] || {};
    
    if (Object.keys(userHabits).length === 0) {
      return message.reply("No habits tracked! Use `!addhabit [habit]` to start.");
    }

    let msg = `📈 **${message.author.username}'s Habits:**\n\n`;
    Object.entries(userHabits).forEach(([habit, data]) => {
      const today = new Date().toDateString();
      const checkedToday = data.lastChecked === today ? " ✅" : "";
      msg += `• **${habit}**: ${data.streak} day streak${checkedToday}\n`;
    });

    return message.reply(msg);
  },

  async check(message, args) {
    const habit = args.join(" ").trim();
    if (!habit) return message.reply("Usage: `!check [habit name]`");

    const authorId = message.author.id;
    if (!habitTracker[authorId] || !habitTracker[authorId][habit]) {
      return message.reply("Habit not found! Use `!addhabit` first.");
    }

    const today = new Date().toDateString();
    const habitData = habitTracker[authorId][habit];

    if (habitData.lastChecked === today) {
      return message.reply("Already checked off today! 🎉");
    }

    habitData.streak += 1;
    habitData.lastChecked = today;
    habitData.total += 1;

    saveHabits();

    return message.reply(`✅ **${habit}** checked off!\n🔥 Streak: ${habitData.streak} days`);
  },

  async quote(message) {
    const quotes = [
      "💪 The only bad workout is the one that didn't happen.",
      "🔥 Your body can stand almost anything. It's your mind you have to convince.",
      "⚡ Success isn't given. It's earned in the gym.",
      "🏆 The pain you feel today will be the strength you feel tomorrow.",
      "💯 Your only limit is your mind. Push past it.",
      "🎯 Don't wish for it, work for it.",
      "💎 Diamonds are formed under pressure.",
      "⭐ Be stronger than your excuses."
    ];
    
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return message.reply(quote);
  },

  async workoutplan(message, args) {
    const type = args[0]?.toLowerCase() || "general";
    
    const workouts = {
      push: "**PUSH DAY**\n• Push-ups: 3x10-15\n• Pike push-ups: 3x8-12\n• Tricep dips: 3x10-15\n• Plank: 3x30-60s",
      pull: "**PULL DAY**\n• Pull-ups/Chin-ups: 3x5-10\n• Inverted rows: 3x8-12\n• Superman: 3x15\n• Dead hang: 3x20-30s",
      legs: "**LEG DAY**\n• Squats: 3x15-20\n• Lunges: 3x10 each leg\n• Calf raises: 3x20\n• Wall sit: 3x30-45s",
      general: "**FULL BODY**\n• Squats: 3x15\n• Push-ups: 3x10\n• Plank: 3x30s\n• Jumping jacks: 3x20"
    };

    const workout = workouts[type] || workouts.general;
    return message.reply(`🏋️‍♂️ **Your Workout Plan:**\n\n${workout}\n\n*Rest 60-90 seconds between sets*`);
  },

  async partner(message, args) {
    const type = args[0]?.toLowerCase();
    if (!type || !['goal', 'future'].includes(type)) {
      return message.reply("Usage: `!partner goal` for accountability or `!partner future` for future partner");
    }

    const authorId = message.author.id;
    
    // Check if already in queue
    if (partnerQueue.includes(authorId)) {
      return message.reply("You're already in the matching queue! Use `!leavequeue` to exit.");
    }
    
    // Check if already matched
    if (matches[authorId]) {
      const channelId = matches[authorId];
      return message.reply(`You already have a partner! Check <#${channelId}>`);
    }
    
    // Check if blocked
    if (onboarding[authorId]?.blockedFromMatching) {
      return message.reply("You're currently blocked from matching due to previous violations.");
    }
    
    // Start onboarding
    await message.reply(`Starting ${type} partner onboarding in DMs!`);
    await startOnboarding(message.author, type);
  },
  
  async leavequeue(message) {
    const authorId = message.author.id;
    
    if (!partnerQueue.includes(authorId)) {
      return message.reply("You're not in the matching queue!");
    }
    
    partnerQueue = partnerQueue.filter(id => id !== authorId);
    savePartnerQueue();
    
    return message.reply("You've been removed from the matching queue.");
  },

  async mutecheck(message, args) {
    const authorId = message.author.id;
    const duration = args[0]?.toLowerCase();
    
    if (!duration || !['day', 'week', 'forever'].includes(duration)) {
      return message.reply("Usage: `!mutecheck day` or `!mutecheck week` or `!mutecheck forever`");
    }
    
    let endTime;
    switch (duration) {
      case 'day':
        endTime = Date.now() + 24 * 60 * 60 * 1000;
        break;
      case 'week':
        endTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
        break;
      case 'forever':
        endTime = Infinity;
        break;
    }
    
    checkInMutes[authorId] = {
      until: endTime,
      startedAt: Date.now()
    };
    
    saveCheckInMutes();
    
    if (duration === 'forever') {
      return message.reply("You've muted check-ins permanently. Use `!unmutecheck` to unmute.");
    } else {
      return message.reply(`You've muted check-ins for one ${duration}. They'll resume automatically after that.`);
    }
  },
  
  async unmutecheck(message) {
    const authorId = message.author.id;
    
    if (!checkInMutes[authorId]) {
      return message.reply("You don't have check-ins muted!");
    }
    
    delete checkInMutes[authorId];
    saveCheckInMutes();
    
    return message.reply("Check-ins have been unmuted. You'll receive reminders again.");
  }
};

// ---------------- Message Handler ----------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const channelName = message.channel.name?.toLowerCase() || "";

  // Store user memory
  if (!memory[message.author.id]) {
    memory[message.author.id] = { previousMessages: [] };
  }
  
  const userMemory = memory[message.author.id];
  userMemory.previousMessages.push(message.content);
  if (userMemory.previousMessages.length > 5) {
    userMemory.previousMessages.shift();
  }
  saveMemory();

  // Partner channel tracking
  if (partners[message.channel.id]) {
    const rec = partners[message.channel.id];
    const userId = message.author.id;
    
    if (rec.userA === userId || rec.userB === userId) {
      if (!rec.exposure[userId].firstInteraction) {
        rec.exposure[userId].firstInteraction = Date.now();
      }
      rec.exposure[userId].messagesExchanged++;
      savePartners();
      
      // Check for exposure unlocks
      checkExposureUnlocks(message.channel.id);
      
      // Check for forbidden info
      if (containsForbiddenInfo(message.content)) {
        await message.delete().catch(() => {});
        await message.channel.send(`<@${userId}> Your message was removed for containing forbidden personal information.`);
        await applyStrike(message.channel.id, userId, 'sharing forbidden information');
      }
    }
  }

  // AI responses (15% chance)
  if (!message.content.startsWith("!") && Math.random() < 0.15) {
    try {
      const prompt = `You are GymBotBro, a fitness mentor. Respond to: "${message.content}" in 1-2 sentences. Be motivational and practical.`;
      const response = await getOpenAIResponse(prompt);
      await message.reply(response);
    } catch (e) {
      console.error("AI response error:", e);
    }
  }

  // Command handling
  if (message.content.startsWith("!")) {
    const args = message.content.slice(1).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    if (commandHandlers[command]) {
      try {
        await commandHandlers[command](message, args);
      } catch (e) {
        console.error(`Error in command ${command}:`, e);
        message.reply("Something went wrong. Try again later.");
      }
    }
  }
});

// ---------------- Daily Check-ins ----------------
async function sendCheckInReminder() {
  try {
    for (const guild of client.guilds.cache.values()) {
      const checkInChannel = guild.channels.cache.find(ch => ch.name === 'daily-check-ins');
      if (!checkInChannel) continue;
      
      const now = new Date();
      const hour = now.getHours();
      let message;
      
      if (hour < 12) {
        message = "🌅 **MORNING CHECK-IN**\nDid you work out this morning? Reply with `!track yes` or `!track no`";
      } else if (hour < 17) {
        message = "☀️ **AFTERNOON CHECK-IN**\nHave you worked out today? Reply with `!track yes` or `!track no`";
      } else {
        message = "🌙 **EVENING CHECK-IN**\nDid you get your workout in today? Reply with `!track yes` or `!track no`";
      }
      
      // Get users who haven't tracked today
      const unloggedUsers = [];
      for (const [userId, data] of Object.entries(fitnessWeekly)) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        
        // Skip muted users
        if (checkInMutes[userId]) {
          const mute = checkInMutes[userId];
          if (mute.until > Date.now()) continue;
          else delete checkInMutes[userId]; // Remove expired mute
        }
        
        // Check if they've logged today
        const today = new Date().toDateString();
        const lastLog = memory[userId]?.lastLogDate;
        if (lastLog !== today) {
          unloggedUsers.push(userId);
        }
      }
      
      if (unloggedUsers.length > 0) {
        const mentions = unloggedUsers.map(id => `<@${id}>`).join(' ');
        await checkInChannel.send(`${message}\n\n${mentions}`);
      } else {
        await checkInChannel.send(message);
      }
    }
  } catch (error) {
    console.error("Error sending check-in reminder:", error);
  }
}

// Check for users who have muted check-ins for too long
async function checkMutedUsers() {
  try {
    const now = Date.now();
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    
    for (const [userId, mute] of Object.entries(checkInMutes)) {
      if (now - mute.startedAt > twoWeeksMs) {
        // User has muted for over two weeks
        for (const guild of client.guilds.cache.values()) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;
          
          const accountabilityChannel = guild.channels.cache.find(ch => ch.name === 'accountability-lounge');
          if (accountabilityChannel) {
            await accountabilityChannel.send(`🚨 **ACCOUNTABILITY ALERT** 🚨\n<@${userId}> has muted check-ins for over two weeks! They might need some motivation and support from the community. Let's check in on them!`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error checking muted users:", error);
  }
}

// ---------------- Health Posts ----------------
async function postHealthContent() {
  try {
    // Load health topics from JSON file
    const healthTopicsData = safeRead(path.join(dataDir, 'health_topics.json'), { topics: [] });
    const healthTopics = healthTopicsData.topics.map(topic => topic.title);
    
    // If we have topics from JSON, use them; otherwise use hardcoded list
    const topics = healthTopics.length > 0 ? healthTopics : [
      "benefits of intermittent fasting",
      "dangers of processed food additives",
      "natural anti-inflammatory foods",
      "harmful effects of seed oils",
      "benefits of cold exposure therapy",
      "natural ways to boost testosterone",
      "how artificial sweeteners affect gut health",
      "benefits of organ meats and nose-to-tail eating",
      "how EMF exposure affects sleep quality",
      "natural alternatives to common medications"
    ];
    
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];
    
    const prompt = `You are a health expert who focuses on natural healing, longevity, and health information that's not commonly discussed in mainstream medicine. Write a unique, informative post (max 250 words) about "${randomTopic}". Include scientific backing where possible, but focus on practical advice. Format with markdown headings and bullet points for readability. Make this response different from any previous posts about this topic.`;
    
    const content = await getOpenAIResponse(prompt);
    
    for (const guild of client.guilds.cache.values()) {
      const healthChannel = guild.channels.cache.find(ch => ch.name === 'health');
      if (healthChannel) {
        await healthChannel.send(`🌿 **HEALTH INSIGHT** 🌿\n\n${content}`);
      }
    }
  } catch (error) {
    console.error("Error posting health content:", error);
  }
}

// ---------------- Wealth Tips ----------------
async function postWealthTip() {
  try {
    // Wealth topics to generate content about
    const wealthTopics = [
      "building wealth through real estate investing",
      "leveraging good debt for wealth creation",
      "whole life insurance as a wealth building tool",
      "infinite banking concept",
      "tax strategies the wealthy use",
      "creating multiple income streams",
      "business structures for tax optimization",
      "margin loans vs traditional loans",
      "building credit strategically",
      "using LLCs to protect assets",
      "S-Corps for tax advantages",
      "wealth preservation strategies",
      "alternative investments beyond stocks and bonds",
      "cash flow investing principles",
      "creating generational wealth"
    ];
    
    const randomTopic = wealthTopics[Math.floor(Math.random() * wealthTopics.length)];
    
    const prompt = `You are a wealth-building expert who shares insider financial knowledge that banks and financial institutions don't advertise. Write a unique, practical tip (max 250 words) about "${randomTopic}". Focus on actionable advice for men in their 20s-30s. Format with a clear headline and bullet points for key takeaways. Make this response different from any previous posts about this topic.`;
    
    const content = await getOpenAIResponse(prompt);
    
    for (const guild of client.guilds.cache.values()) {
      const wealthChannel = guild.channels.cache.find(ch => ch.name === 'wealth');
      if (wealthChannel) {
        await wealthChannel.send(`💰 **WEALTH BUILDER TIP** 💰\n\n${content}`);
      }
    }
  } catch (error) {
    console.error("Error posting wealth tip:", error);
  }
}

// ---------------- Fitness Posts ----------------
async function postFitnessContent() {
  try {
    // Fitness topics to generate content about
    const fitnessTopics = [
      "effective stretching routines for longevity",
      "bodyweight exercises for functional strength",
      "compound movements for maximum muscle growth",
      "training for explosive power",
      "mobility exercises for injury prevention",
      "calisthenics progressions for beginners",
      "training for athletic performance",
      "recovery techniques for optimal muscle growth",
      "training splits for natural athletes",
      "progressive overload principles",
      "functional fitness for everyday strength",
      "training for speed and agility",
      "grip strength exercises and benefits",
      "training for muscle definition",
      "hybrid athlete training methods"
    ];
    
    const randomTopic = fitnessTopics[Math.floor(Math.random() * fitnessTopics.length)];
    
    // First, get a YouTube video recommendation
    const videoPrompt = `You are a fitness expert specializing in men's fitness for those in their teens, 20s and early 30s. Recommend ONE specific YouTube video about "${randomTopic}". Provide ONLY the exact YouTube video title and channel name in this format: "Video Title | Channel Name". Choose videos from popular fitness channels like AthleanX, Jeff Nippard, Jeremy Ethier, Hybrid Calisthenics, or similar quality channels. Make this recommendation different from previous ones.`;
    
    const videoRecommendation = await getOpenAIResponse(videoPrompt);
    
    // Then, get training tips on the same topic
    const tipsPrompt = `You are a fitness expert specializing in men's fitness for those in their teens, 20s and early 30s. Write 3-4 practical, science-based tips about "${randomTopic}". Format as bullet points. Keep it concise, motivational, and immediately applicable.`;
    
    const fitnessTips = await getOpenAIResponse(tipsPrompt);
    
    const message = `💪 **FITNESS FOCUS: ${randomTopic.toUpperCase()}** 💪\n\n${fitnessTips}\n\n📺 **RECOMMENDED WATCH:**\n${videoRecommendation}`;
    
    for (const guild of client.guilds.cache.values()) {
      const fitnessChannel = guild.channels.cache.find(ch => ch.name === 'fitness');
      if (fitnessChannel) {
        await fitnessChannel.send(message);
      }
    }
  } catch (error) {
    console.error("Error posting fitness content:", error);
  }
}

// ---------------- Faith Channel Posts ----------------
async function postFaithContent() {
  try {
    // Load faith prompts from JSON file
    const faithPromptsData = safeRead(path.join(dataDir, 'faith_prompts.json'), { prompts: [] });
    const faithPrompts = faithPromptsData.prompts;
    
    // If we have prompts from JSON, use them; otherwise use hardcoded list
    const prompts = faithPrompts.length > 0 ? faithPrompts : [
      "How Psalm 23 can guide us through difficult times",
      "Finding strength in Philippians 4:13",
      "The meaning of grace in everyday life",
      "How to apply the teachings of the Sermon on the Mount",
      "Understanding the power of prayer",
      "The significance of the Armor of God in Ephesians 6",
      "Finding peace in John 14:27 when facing anxiety",
      "The importance of forgiveness as taught in Matthew 6:14-15"
    ];
    
    const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
    
    const faithPrompt = `You are a Christian faith guide and spiritual mentor. Write an inspiring, thoughtful, and encouraging message about "${randomPrompt}". Include relevant scripture, practical application for daily life, and words of encouragement. Keep it conversational, uplifting, and around 250 words. Make this response unique and different from previous posts about this topic. Focus on God's love, presence, and guidance.`;
    
    const content = await getOpenAIResponse(faithPrompt);
    
    for (const guild of client.guilds.cache.values()) {
      const faithChannel = guild.channels.cache.find(ch => ch.name === 'faith');
      if (faithChannel) {
        await faithChannel.send(`✝️ **FAITH REFLECTION** ✝️\n\n${content}`);
      }
    }
  } catch (error) {
    console.error("Error posting faith content:", error);
  }
}

// ---------------- Daily motivation (9 AM) ----------------
cron.schedule('0 9 * * *', async () => {
  try {
    const quotes = [
      "💪 Rise and grind! Today's your day to be better than yesterday.",
      "🔥 The only bad workout is the one that didn't happen. Make it count!",
      "⚡ Your body can stand almost anything. It's your mind you have to convince.",
      "🏆 Success isn't given. It's earned in the gym and through discipline."
    ];
    
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    
    for (const guild of client.guilds.cache.values()) {
      const generalChannel = guild.channels.cache.find(ch => 
        ch.name === "general" || ch.name === "main" || ch.name === "chat"
      );
      
      if (generalChannel) {
        await generalChannel.send(`**DAILY MOTIVATION**\n${quote}`);
      }
    }
    
    console.log("Sent daily motivation");
  } catch (error) {
    console.error("Error sending daily motivation:", error);
  }
});

// ---------------- Weekly reset (Sunday midnight) ----------------
cron.schedule('0 0 * * 0', async () => {
  try {
    for (const userId in fitnessWeekly) {
      fitnessWeekly[userId] = { yes: 0, no: 0 };
    }
    saveWeekly();
    console.log("Weekly data reset");
  } catch (error) {
    console.error("Error in weekly reset:", error);
  }
});

// ---------------- Check-in reminders ----------------
CHECK_IN_TIMES.forEach(time => {
  cron.schedule(time, sendCheckInReminder);
});

// ---------------- Check muted users (once a day) ----------------
cron.schedule('0 10 * * *', checkMutedUsers);

// ---------------- Health posts ----------------
cron.schedule(HEALTH_POST_CRON, postHealthContent);

// ---------------- Wealth tips ----------------
cron.schedule(WEALTH_TIP_CRON, postWealthTip);

// ---------------- Fitness posts ----------------
cron.schedule(FITNESS_POST_CRON, postFitnessContent);

// ---------------- Faith channel posts (twice daily) ----------------
cron.schedule('0 8,18 * * *', postFaithContent); // 8am and 6pm

// ---------------- Partner matching (every 30 minutes) ----------------
cron.schedule('*/30 * * * *', tryAutoMatch);

// ---------------- Bot Ready ----------------
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("!help for commands");
  loadAllData();
  setInterval(() => tryAutoMatch(), 1000 * 30); // every 30s
});
client.on('error', console.error);

// ---------------- Start Bot ----------------
client.login(process.env.DISCORD_TOKEN);