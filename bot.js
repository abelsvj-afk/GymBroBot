// bot.js
import dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import OpenAI from 'openai';
import express from 'express';
import { MongoClient } from 'mongodb';
import Storage from './src/storage.js';
import { runHealthCheck } from './src/commands/health.js';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import axios from 'axios';
import { google } from 'googleapis';

dotenv.config();

// Allow selecting the OpenAI model via environment variable so we can
// enable newer models (for example: 'gpt-5-mini') without changing code.
// OPENAI_MODEL is mutable so an admin can change it at runtime via a command.
let OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
let FALLBACK_OPENAI_MODEL = process.env.FALLBACK_OPENAI_MODEL || 'gpt-3.5-turbo';

console.log(`[OpenAI] Model in use: ${OPENAI_MODEL} (fallback: ${FALLBACK_OPENAI_MODEL})`);

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

// Optional MongoDB connection (useful for persistent audit logs across restarts)
const MONGO_URI = process.env.MONGO_URI || null;
const storage = new Storage(MONGO_URI, path.join(process.cwd(), 'data'));
async function tryConnectMongo() { await storage.connect(); }

// Railway API placeholder: implement only if you set RAILWAY_API_KEY and RAILWAY_PROJECT_ID in env.
// This function is a safe no-op unless you provide those credentials and uncomment the actual call site.
async function updateRailwayEnvVar(key, value) {
  // To implement: call Railway's API to update project/environment variables.
  // Example flow (NOT active):
  // 1) Set RAILWAY_API_KEY and RAILWAY_PROJECT_ID in env. The API requires project and environment ids.
  // 2) Use fetch/axios to call Railway's API endpoints to create/update environment variables for the service.
  // 3) Return success/failure.
  // Note: We'll not call this function automatically to avoid accidentally exposing tokens.
  if (!process.env.RAILWAY_API_KEY) return { ok: false, error: 'no-railway-key' };
  return { ok: false, error: 'railway-not-implemented' };
}

// ---------------- Persistent Data ----------------
// In-memory state (will be loaded via storage.load)
let memory = {}, birthdays = {}, fitnessWeekly = {}, fitnessMonthly = {};
let partnerQueue = [], partners = {}, strikes = {}, habitTracker = {};
let challenges = {}, onboarding = {}, matches = {}, leaderboardPotential = {};
let checkInMutes = {}, healthPosts = [], wealthTips = [], fitnessPosts = [];
let aiHealth = [];
let commandDocsPins = [];
let lastHealthAlert = {};

// ---------------- Save/Load Helpers ----------------
// Storage-backed load/save helpers
async function loadAllData() {
  memory = await storage.load('memory', {});
  birthdays = await storage.load('birthdays', {});
  fitnessWeekly = await storage.load('weekly', {});
  fitnessMonthly = await storage.load('monthly', {});
  partnerQueue = await storage.load('partnerQueue', []);
  partners = await storage.load('partners', {});
  strikes = await storage.load('strikes', {});
  habitTracker = await storage.load('habits', {});
  challenges = await storage.load('challenges', {});
  onboarding = await storage.load('onboarding', {});
  matches = await storage.load('matches', {});
  leaderboardPotential = await storage.load('leaderboard', {});
  checkInMutes = await storage.load('checkInMutes', {});
  healthPosts = await storage.load('healthPosts', []);
  commandDocsPins = await storage.load('commandDocsPins', []);
  wealthTips = await storage.load('wealthTips', []);
  fitnessPosts = await storage.load('fitnessPosts', []);
  aiHealth = await storage.load('ai_health', []);
  lastHealthAlert = await storage.load('lastHealthAlert', {});
  console.log('All data loaded (storage)');
}

async function saveAllData() {
  await Promise.all([
    storage.save('memory', memory), storage.save('birthdays', birthdays), storage.save('weekly', fitnessWeekly), storage.save('monthly', fitnessMonthly),
    storage.save('partnerQueue', partnerQueue), storage.save('partners', partners), storage.save('strikes', strikes), storage.save('habits', habitTracker),
    storage.save('challenges', challenges), storage.save('onboarding', onboarding), storage.save('matches', matches), storage.save('leaderboard', leaderboardPotential),
    storage.save('checkInMutes', checkInMutes), storage.save('healthPosts', healthPosts), storage.save('wealthTips', wealthTips), storage.save('fitnessPosts', fitnessPosts)
  ]).catch(e=>console.error('saveAllData error',e));
}

const saveLastHealthAlert = async () => storage.save('lastHealthAlert', lastHealthAlert || {});

const saveCommandDocsPins = async () => storage.save('commandDocsPins', commandDocsPins);

// Shorthand async save functions
const saveMemory = async () => storage.save('memory', memory);
const saveWeekly = async () => storage.save('weekly', fitnessWeekly);
const saveMonthly = async () => storage.save('monthly', fitnessMonthly);
const savePartnerQueue = async () => storage.save('partnerQueue', partnerQueue);
const savePartners = async () => storage.save('partners', partners);
const saveStrikes = async () => storage.save('strikes', strikes);
const saveHabits = async () => storage.save('habits', habitTracker);
const saveChallenges = async () => storage.save('challenges', challenges);
const saveOnboarding = async () => storage.save('onboarding', onboarding);
const saveMatches = async () => storage.save('matches', matches);
const saveLeaderboard = async () => storage.save('leaderboard', leaderboardPotential);
const saveCheckInMutes = async () => storage.save('checkInMutes', checkInMutes);
const saveHealthPosts = async () => storage.save('healthPosts', healthPosts);
const saveWealthTips = async () => storage.save('wealthTips', wealthTips);
const saveFitnessPosts = async () => storage.save('fitnessPosts', fitnessPosts);
const saveAiHealth = async () => storage.save('ai_health', aiHealth);

// ----- Additional explicit file handles and helpers requested -----
// Provide the file path constants the user referenced and small save/load helpers
const birthdaysFile = files.birthdays;
const monthlyFile = files.monthly;
const partnersFile = files.partners;
const partnerQueueFile = files.partnerQueue;
const strikesFile = files.strikes;
const challengesFile = files.challenges;

// Explicit save function for birthdays (not present earlier)
async function saveBirthdays() { try { await storage.save('birthdays', birthdays); } catch(e){ console.error('saveBirthdays', e); } }

// Explicit load functions (for completeness / easier merging with other bot versions)
async function loadBirthdays() { birthdays = await storage.load('birthdays', {}); }
async function loadMonthly() { fitnessMonthly = await storage.load('monthly', {}); }
async function loadPartners() { partners = await storage.load('partners', {}); }
async function loadPartnerQueue() { partnerQueue = await storage.load('partnerQueue', []); }
async function loadStrikes() { strikes = await storage.load('strikes', {}); }
async function loadChallenges() { challenges = await storage.load('challenges', {}); }

// Backwards-compatible loader: call the existing loadAllData implementation
// Some external copies of this bot expect a function named `loadData()`; provide it as an alias.
function loadData() { loadAllData(); }


// ---------------- Express ----------------
app.use(express.json());
app.get('/', (req,res)=>res.json({ status:'GymBotBro running', uptime:process.uptime(), guilds:client.guilds.cache.size, users:client.users.cache.size }));
app.listen(PORT, ()=>console.log(`Express server running on port ${PORT}`));

// ---------------- Admin dashboard (protected) ----------------
// Simple JSON + HTML view to inspect recent ai_health events.
// Protect access by setting ADMIN_DASH_SECRET in env and passing it as a query ?secret= or header 'x-admin-secret'.
app.get('/admin/ai-health', async (req, res) => {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (!process.env.ADMIN_DASH_SECRET) return res.status(403).send('Admin dashboard not configured (set ADMIN_DASH_SECRET)');
  if (!secret || secret !== process.env.ADMIN_DASH_SECRET) return res.status(403).send('Forbidden');

  const n = Math.min(200, parseInt(req.query.n) || 50);
  try {
    let entries = [];
    if (mongoDb) {
      entries = await mongoDb.collection('ai_health').find().sort({ ts: -1 }).limit(n).toArray();
    } else {
      // fallback to in-memory / file store
      entries = aiHealth.slice(-n).reverse();
    }

    // If the client prefers JSON or requests via curl, return JSON
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ count: entries.length, entries });
    }

    // Otherwise render a simple HTML table
    const rows = entries.map(e => `<tr><td>${new Date(e.ts).toLocaleString()}</td><td>${e.type}</td><td>${e.model||''}</td><td>${e.user?`<@${e.user}>` : ''}</td><td>${e.ok===false?`ERROR: ${e.error||''}`:''}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>GymBotBro AI Health</title><style>table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head><body><h2>AI Health (recent ${entries.length})</h2><table><thead><tr><th>When</th><th>Type</th><th>Model</th><th>User</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    return res.send(html);
  } catch (e) {
    console.error('admin dashboard error:', e);
    return res.status(500).send('Server error');
  }
});

// ---------------- OpenAI Helper ----------------
async function getOpenAIResponse(prompt){
  try{
    const completion = await openai.chat.completions.create({ model: OPENAI_MODEL, messages:[{role:"user", content:prompt}], max_tokens:300, temperature:0.7 });
    return completion.choices[0].message.content.trim();
  } catch(e){
    console.error("OpenAI error (primary model):", e?.message || e);

    // If the primary model failed, try the fallback model once (useful when a model isn't available for the API key)
    if (OPENAI_MODEL !== FALLBACK_OPENAI_MODEL) {
      try {
        console.log(`[OpenAI] Attempting fallback model: ${FALLBACK_OPENAI_MODEL}`);
        const completion = await openai.chat.completions.create({ model: FALLBACK_OPENAI_MODEL, messages:[{role:"user", content:prompt}], max_tokens:300, temperature:0.7 });
        return completion.choices[0].message.content.trim();
      } catch (err2) {
        console.error("OpenAI error (fallback):", err2?.message || err2);
      }

// Admin logging: attempt to post a message to mod/admin/logging channels (if present) and pin it
async function findAdminChannels(guild) {
  // Look for a category named 'mod/admin' or role-protected channels named 'mod', 'admin', 'logging'
  const channels = {};
  const logging = guild.channels.cache.find(ch => ch.name === 'logging' && (ch.type === ChannelType.GuildText));
  const mod = guild.channels.cache.find(ch => ch.name === 'mod' && (ch.type === ChannelType.GuildText));
  const admin = guild.channels.cache.find(ch => ch.name === 'admin' && (ch.type === ChannelType.GuildText));
  if (logging) channels.logging = logging;
  if (mod) channels.mod = mod;
  if (admin) channels.admin = admin;
  return channels;
}

async function adminLog(guild, text) {
  try {
    const chs = await findAdminChannels(guild);
    if (chs.logging) {
      // send as embed when possible
      try {
        return await sendLogEmbed(chs.logging, 'GymBotBro Audit', [{ name: 'Info', value: text }]);
      } catch (e) {
        return await chs.logging.send(text);
      }
    }
    // fallback to system channel
    if (guild.systemChannel) return guild.systemChannel.send(text);
  } catch (e) { console.error('adminLog error:', e); }
}

// Send a structured embed to a logging channel
async function sendLogEmbed(channel, title, fields = []) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x0099ff)
    .setTimestamp(new Date());
  fields.forEach(f => embed.addFields({ name: f.name || '\u200B', value: f.value || '\u200B', inline: f.inline || false }));
  return channel.send({ embeds: [embed] });
}

// Pin a command document into admin channels if not already present
async function pinCommandDocs(guild) {
  try {
    const chs = await findAdminChannels(guild);

    const adminDoc = `GymBotBro Admin Instructions:\n\n1) Managing AI model\n- Use \`!setmodel <model> [--save] [--force]\` to change models.\n  - Without --force the bot validates model availability.\n  - Use --save to persist to .env in the repo root (Railway will pick ENV var from project settings).\n- Use \`!getmodel\` to view current model and fallback.\n- Use \`!testai\` to run a quick health check (admins only).\n\n2) Deployment notes for Railway:\n- Set environment variables in Railway project settings (OPENAI_API_KEY, OPENAI_MODEL, FALLBACK_OPENAI_MODEL, DISCORD_TOKEN).\n- When you change OPENAI_MODEL via CLI or Railway UI, restart the service to apply unless you use \`!setmodel --save\`.\n\n3) Coordination with myninja AI / GitHub:\n- myninja AI may push code changes to this repo. If you persist changes via \`.env\` and myninja also updates files, ensure you sync changes and don't overwrite .env in CI.\n`;

  const loggingDoc = `GymBotBro Logging Channel ΓÇô Purpose & Usage:\n\nThis channel is for audit logs only. Do NOT post general instructions here.\nLogs posted here include:\n- Model changes (who changed model, from->to, saved to .env)\n- AI health checks and failures\n- Startup fallback switches\n\nAvailable logging commands (admins):\n- !getmodel -> shows current model & fallback\n- !testai -> runs a quick AI health check (60s cooldown per guild)\n- !setmodel <model> [--save] [--force] -> change primary model\n- !setfallback <model> [--save] -> change fallback model\n\nMongo integration (optional):\n- If you set MONGO_URI in the deployment environment (MongoDB Atlas connection string), audit logs will be recorded to the 'ai_health' collection for long-term storage.\n\nPinned messages here are for logging policy and retention. Only admins should unpin.`;

    // Admin/mod channels: post adminDoc
    for (const key of ['admin', 'mod']) {
      const ch = chs[key];
      if (!ch) continue;
      const pins = await ch.messages.fetchPinned();
      const already = pins.find(m => m.content && m.content.startsWith('GymBotBro Admin Instructions'));
      if (!already) {
        const sent = await ch.send(adminDoc);
        await sent.pin();
      }
    }

    // Logging channel: post loggingDoc only
    if (chs.logging) {
      const ch = chs.logging;
      const pins = await ch.messages.fetchPinned();
      const already = pins.find(m => m.content && m.content.startsWith('GymBotBro Logging Channel'));
      if (!already) {
        const sent = await ch.send(loggingDoc);
        await sent.pin();
      }
    }
  } catch (e) { console.error('pinCommandDocs error:', e); }
}

// Telemetry entry helper
function recordAiHealthEvent(event) {
  try {
    aiHealth.push(Object.assign({ ts: Date.now() }, event));
    // cap to last 500 entries
    if (aiHealth.length > 500) aiHealth = aiHealth.slice(-500);
    saveAiHealth();
    // also write to Mongo if available
    if (mongoDb) {
      try { mongoDb.collection('ai_health').insertOne(Object.assign({ ts: new Date() }, event)); } catch(e){console.error('mongo write failed',e);}    
    }
  } catch (e) { console.error('recordAiHealthEvent error:', e); }
}

// Simple cooldown map for testai command (per-guild)
const testAiCooldowns = new Map();

// Startup AI health check, attempt to validate primary model; if fails, try fallback and switch
async function startupAiHealthCheck() {
  try {
    const res = await validateModel(OPENAI_MODEL, 5000);
    if (res.ok) {
      recordAiHealthEvent({ type: 'startup', result: 'primary_ok', model: OPENAI_MODEL, latency: res.duration });
      console.log(`[OpenAI] Primary model ${OPENAI_MODEL} reachable (${res.duration}ms)`);
      return;
    }
    console.warn(`[OpenAI] Primary model ${OPENAI_MODEL} failed: ${res.error}. Trying fallback ${FALLBACK_OPENAI_MODEL}`);
    const res2 = await validateModel(FALLBACK_OPENAI_MODEL, 5000);
    if (res2.ok) {
      OPENAI_MODEL = FALLBACK_OPENAI_MODEL;
      recordAiHealthEvent({ type: 'startup', result: 'switched_to_fallback', from: process.env.OPENAI_MODEL || 'unset', to: OPENAI_MODEL, error: res.error });
      console.log(`[OpenAI] Switched to fallback model ${OPENAI_MODEL}`);
    } else {
      recordAiHealthEvent({ type: 'startup', result: 'both_failed', primaryError: res.error, fallbackError: res2.error });
      console.error('[OpenAI] Both primary and fallback model checks failed. AI features will return a polite error.');
    }
  } catch (e) { console.error('startupAiHealthCheck error:', e); }
}
    }

    return "I can't respond right now.";
  }
}

// Helper to persist an env var to the .env file in the repo root (simple key=value replacement or append)
async function persistEnvVar(key, value) {
  try {
    // If storage (Mongo) is connected, persist env-like values into a shared '_env' collection
    if (storage && storage.mongoDb) {
      const cur = await storage.load('_env', {});
      cur[key] = value;
      await storage.save('_env', cur);
      return true;
    }
    // Fallback: write to .env file in repo root
    const envPath = path.resolve(process.cwd(), '.env');
    let content = '';
    if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');

    const re = new RegExp('^' + key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '=.*$', 'm');
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`);
    } else {
      if (content && !content.endsWith('\n')) content += '\n';
      content += `${key}=${value}\n`;
    }
    fs.writeFileSync(envPath, content, 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to persist .env change:', e);
    return false;
  }
}

// Validate a model by doing a tiny, low-cost call. Returns {ok, duration, sample} or {ok:false, error}
async function validateModel(model, timeoutMs = 5000) {
  try {
    const start = Date.now();
    const result = await Promise.race([
      openai.chat.completions.create({ model, messages: [{ role: 'user', content: 'Respond with "OK"' }], max_tokens: 3, temperature: 0 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    const duration = Date.now() - start;
    const sample = result?.choices?.[0]?.message?.content?.trim() || '';
    return { ok: true, duration, sample };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
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

// Find or create a category named 'Accountability Partners' and return it
async function findOrCreateAccountabilityCategory(guild) {
  try {
    const name = 'Accountability Partners';
    const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && (c.name || '').toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'Create category for accountability partner private channels' });
    return cat;
  } catch (e) { console.error('findOrCreateAccountabilityCategory error:', e); return null; }
}

// Higher-level partner channel creator that ensures category placement and richer naming
async function createPartnerChannel(guild, userAId, userBId, options = {}) {
  try {
    const category = await findOrCreateAccountabilityCategory(guild).catch(()=>null);

    // Use safer username-based names when possible
    const userA = await client.users.fetch(userAId).catch(()=>null);
    const userB = await client.users.fetch(userBId).catch(()=>null);
    const safe = (u, fallback) => (u && u.username ? u.username.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,8) : (fallback||'user'));
    const channelName = `partner-${safe(userA,userAId.slice(0,6))}-${safe(userB,userBId.slice(0,6))}`.slice(0,90);

    const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, reason: 'Create partner private channel' });
    // Move into category if available
    try { if (category) await channel.setParent(category.id); } catch(e){}

    // Set permissions similar to createPrivateChannelForPair
    try {
      const everyoneRole = guild.roles.everyone.id;
      const perms = [ { id: everyoneRole, deny: [PermissionFlagsBits.ViewChannel] } ];
      perms.push({ id: userAId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      perms.push({ id: userBId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      const modRole = guild.roles.cache.find(r => r.name && r.name.toLowerCase().includes('mod'));
      if (modRole) perms.push({ id: modRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
      await channel.permissionOverwrites.set(perms);
    } catch (e) { console.error('set perms error:', e); }

    // Initialize partner record and save
    partners[channel.id] = { channelId: channel.id, guildId: guild.id, userA: userAId, userB: userBId, type: options.type || 'goal', createdAt: Date.now(), exposure: { [userAId]: { messagesExchanged:0, firstInteraction:null }, [userBId]: { messagesExchanged:0, firstInteraction:null } } };
    matches[userAId] = channel.id; matches[userBId] = channel.id;
    strikes[channel.id] = { [userAId]: 0, [userBId]: 0 };
    savePartners(); if (saveMatches) saveMatches(); if (saveStrikes) saveStrikes();

    // Post initial pinned rules like the other implementation
    try { await postInitialPinnedRules(channel, partners[channel.id]); } catch(e){console.error('postInitialPinnedRules',e)}

    try { (await client.users.fetch(userAId)).send(`You were paired with <@${userBId}>. Channel: ${channel.toString()}`); } catch {}
    try { (await client.users.fetch(userBId)).send(`You were paired with <@${userAId}>. Channel: ${channel.toString()}`); } catch {}

    return channel;
  } catch (e) { console.error('createPartnerChannel error:', e); return null; }
}

async function endPartnerChannel(channelObj, reason = 'Partner ended') {
  try {
    const ch = typeof channelObj === 'string' ? client.channels.cache.get(channelObj) : channelObj;
    if (!ch) return false;
    const rec = partners[ch.id];
    if (rec) {
      const users = [rec.userA, rec.userB].filter(Boolean);
      delete partners[ch.id]; savePartners();
      users.forEach(uid => { if (matches[uid] && matches[uid] === ch.id) delete matches[uid]; });
      if (saveMatches) saveMatches();
      try { await ch.delete(`Partner ended: ${reason}`); } catch(e){}
      users.forEach(uid => {
        try { (async()=>{ const u = await client.users.fetch(uid).catch(()=>null); if(u) u.send(`Your partner channel was ended: ${reason}`); })(); } catch(e){}
      });
      return true;
    }
    return false;
  } catch (e) { console.error('endPartnerChannel error:', e); return false; }
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

// Ensure a normalized strike record exists for a guild/channel & user.
// This function is tolerant of different strike storage shapes used across versions.
function ensureStrikeRecord(scopeId, userId) {
  try {
    if (!strikes[scopeId]) strikes[scopeId] = {};
    if (typeof strikes[scopeId][userId] === 'undefined') strikes[scopeId][userId] = 0;
    return strikes[scopeId][userId];
  } catch (e) { console.error('ensureStrikeRecord error:', e); return 0; }
}

function isModeratorMember(member) {
  try {
    return member && member.permissions && member.permissions.has && member.permissions.has(PermissionFlagsBits.ManageMessages);
  } catch (e) { return false; }
}

async function notifyLoggingChannel(guild, content) {
  try {
    const log = guild.channels.cache.find(ch => (ch.name||'').toLowerCase().includes('log') || (ch.name||'').toLowerCase() === 'mod-logs' || (ch.name||'').toLowerCase() === 'logging');
    if (log) await log.send(content);
  } catch (e) { console.error('notifyLoggingChannel error:', e); }
}

// Optional: return a list of recommended fitness videos using YouTube Data API if available
async function getRandomFitnessVideos(count = 2) {
  try {
    if (!process.env.YOUTUBE_API_KEY) return [`YouTube API key not configured.`];
    const { google } = await import('googleapis');
    const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
    const queries = [
      "men's mobility workout",
      'calisthenics for men',
      'bodyweight strength routine',
      'hybrid calisthenics workout',
      'mobility for lifters'
    ];
    const q = queries[Math.floor(Math.random()*queries.length)];
    const res = await youtube.search.list({ part: 'snippet', q, maxResults: 10, type: 'video', relevanceLanguage: 'en' });
    const items = res.data.items || [];
    if (!items.length) return ['No videos found.'];
    const shuffled = items.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).map(i => `${i.snippet.title} | https://www.youtube.com/watch?v=${i.id.videoId}`);
  } catch (e) { console.error('getRandomFitnessVideos error:', e); return ['Error fetching videos.']; }
}

// Optional: fetch a top health news headline if NEWS_API_KEY is present
async function getHealthNews() {
  try {
    if (!process.env.NEWS_API_KEY) return 'No News API key provided.';
    const res = await axios.get(`https://newsapi.org/v2/top-headlines?category=health&language=en&pageSize=1&apiKey=${process.env.NEWS_API_KEY}`);
    const top = res.data.articles && res.data.articles[0];
    if (!top) return 'No health news today.';
    return `${top.title} — ${top.source.name}\n${top.url}`;
  } catch (e) { console.error('getHealthNews error:', e); return 'Could not fetch health news.'; }
}

// Update the leaderboard channel with a simple snapshot (non-destructive helper)
async function updateLeaderboardChannel() {
  try {
    const channel = client.channels.cache.find(ch => (ch.name||'').toLowerCase() === 'leaderboard');
    if (!channel) return;
    const sorted = Object.entries(fitnessWeekly).sort((a,b)=> (b[1].yes||0) - (a[1].yes||0));
    if (!sorted.length) { await channel.send('No weekly fitness data yet.'); return; }
    const medals = ['🥇','🥈','🥉'];
    let msg = '**WEEKLY LEADERBOARD**\n\n';
    sorted.slice(0,10).forEach(([uid,data],i)=>{ msg += `${medals[i]||'🔹'} <@${uid}> — ${data.yes||0} workouts\n`; });
    try { await channel.bulkDelete(10).catch(()=>{}); } catch(e){}
    await channel.send(msg);
  } catch (e) { console.error('updateLeaderboardChannel error:', e); }
}

// ---------------- Command Handlers ----------------
const commandHandlers = {
  async help(message) {
    const embed = new EmbedBuilder()
      .setTitle("💪 GymBotBro Commands")
      .setDescription("Your accountability partner for fitness and life!")
      .addFields(
        { name: "🏋️ Fitness", value: "`!track yes/no` - Log workout\n`!progress` - View stats\n`!leaderboard` - Rankings", inline: true },
        { name: "📋 Habits", value: "`!addhabit [habit]` - Track habit\n`!habits` - View habits\n`!check [habit]` - Check off", inline: true },
        { name: "🤖 Coaching", value: "`!coach [question]` - Get advice\n`!quote` - Motivation\n`!workoutplan` - Get workout", inline: true },
        { name: "🤝 Partners", value: "`!partner goal` - Find accountability partner\n`!partner future` - Find future partner\n`!leavequeue` - Exit matching queue", inline: true }
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
    
    const zone = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const todayIso = DateTime.now().setZone(zone).toISODate();

    if (isYes) {
      fitnessWeekly[authorId].yes += 1;
      await message.react('💪');
      await message.reply("Beast mode activated! 🔥");
    } else {
      fitnessWeekly[authorId].no += 1;
      await message.react('❌');
      await message.reply("Tomorrow is a new day! 🙂");
    }

    // update memory last log date for check-in logic
    if (!memory[authorId]) memory[authorId] = { previousMessages: [] };
    memory[authorId].lastLogDate = todayIso;
    await saveWeekly();
    await saveMemory();
  },

  async progress(message) {
    const authorId = message.author.id;
    const data = fitnessWeekly[authorId] || { yes: 0, no: 0 };

    const total = data.yes + data.no;
    const rate = total > 0 ? Math.round((data.yes / total) * 100) : 0;

      const embed = new EmbedBuilder()
      .setTitle(`📈 ${message.author.username}'s Progress`)
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
      msg += `${medals[index] || "🔹"} <@${userId}> - ${data.yes} workouts\n`;
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

    let msg = `📋 **${message.author.username}'s Habits:**\n\n`;
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
      return message.reply("Already checked off today! ✅");
    }

    habitData.streak += 1;
    habitData.lastChecked = today;
    habitData.total += 1;

    saveHabits();

  return message.reply(`✅ **${habit}** checked off!\n🔥 Streak: ${habitData.streak} days`);
  },

  async quote(message) {
    const quotes = [
      "Rise and grind! Today's your day to be better than yesterday.",
      "Your body can stand almost anything. It's your mind you have to convince.",
      "Success isn't given. It's earned in the gym.",
      "The pain you feel today will be the strength you feel tomorrow.",
      "Your only limit is your mind. Push past it.",
      "Don't wish for it, work for it.",
      "Diamonds are formed under pressure.",
      "Be stronger than your excuses."
    ];
    
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return message.reply(quote);
  },

  // Admin: change the OpenAI model at runtime. Use --save to persist to .env
  async setmodel(message, args) {
    // Only allow in guilds and allow administrators or BOT_OWNER_ID
    const model = args[0];
    if (!model) return message.reply('Usage: `!setmodel <model> [--save] [--force]`');

    const saveFlag = args.includes('--save');
    const forceFlag = args.includes('--force');

    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;

    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    if (!forceFlag) {
      const reply = await message.reply(`Validating model: ${model} ...`);
      const res = await validateModel(model);
      if (!res.ok) {
        return reply.edit(`Validation failed for model ${model}: ${res.error}. Use --force to override.`);
      }
      await reply.edit(`Model ${model} validated ok (latency ${res.duration}ms). Switching now.`);
    }

    OPENAI_MODEL = model;

    message.reply(`OpenAI model switched to: ${model}`);

    // Telemetry & logging
    recordAiHealthEvent({ type: 'setmodel', user: message.author.id, model, force: forceFlag, saved: !!saveFlag });
    try { adminLog(message.guild, `User <@${message.author.id}> set model -> ${model} ${saveFlag ? '(saved to .env)' : ''}`); } catch(e){}

    if (saveFlag) {
      const ok = await persistEnvVar('OPENAI_MODEL', model);
      if (ok) await message.reply('Saved to .env'); else await message.reply('Failed to save to .env');
    }
  },

  async getmodel(message) {
    const modelInfo = `Current model: ${OPENAI_MODEL}\nFallback model: ${FALLBACK_OPENAI_MODEL}`;
    return message.reply(modelInfo);
  },

  // Admin: set fallback model used when primary fails
  async setfallback(message, args) {
    const model = args[0];
    if (!model) return message.reply('Usage: `!setfallback <model> [--save]`');
    const saveFlag = args.includes('--save');
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    FALLBACK_OPENAI_MODEL = model;
    recordAiHealthEvent({ type: 'setfallback', user: message.author.id, model, saved: !!saveFlag });
    try { adminLog(message.guild, `User <@${message.author.id}> set fallback model -> ${model} ${saveFlag ? '(saved to .env)' : ''}`); } catch(e){}

    message.reply(`Fallback model set to ${model}`);
    if (saveFlag) {
      const ok = await persistEnvVar('FALLBACK_OPENAI_MODEL', model);
      if (ok) await message.reply('Saved to .env'); else await message.reply('Failed to save to .env');
    }
  },

  // Admin: fetch recent AI health events
  async getaihealth(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const n = Math.min(10, parseInt(args[0]) || 10);
    let entries = [];
    if (mongoDb) {
      try {
        entries = await mongoDb.collection('ai_health').find().sort({ ts: -1 }).limit(n).toArray();
      } catch (e) { console.error('mongo read failed', e); }
    }
    if (!entries.length) entries = aiHealth.slice(-n).reverse();

    if (!entries.length) return message.reply('No ai health events found.');

  const fields = entries.map(e => ({ name: new Date(e.ts).toLocaleString(), value: `${e.type} • ${e.model||''} • ${e.user?`by <@${e.user}>` : ''} ${e.ok===false?`• ERROR: ${e.error}`:''}` })).slice(0,10);
    await sendLogEmbed(message.channel, 'AI Health (recent)', fields);
  },

  // Admin test - run a small test prompt through the current model and show timing/sample
  async testai(message) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    // Cooldown per guild (60s)
    const guildId = message.guild.id;
    const last = testAiCooldowns.get(guildId) || 0;
    if (Date.now() - last < 60 * 1000) return message.reply('Please wait before running another AI check (60s cooldown).');
    testAiCooldowns.set(guildId, Date.now());

    const reply = await message.reply('Running quick AI health check...');
    const res = await validateModel(OPENAI_MODEL, 8000);
    if (!res.ok) {
      recordAiHealthEvent({ type: 'testai', user: message.author.id, model: OPENAI_MODEL, ok: false, error: res.error });
      try { adminLog(message.guild, `AI health check failed by <@${message.author.id}>: ${res.error}`); } catch(e){}
      return reply.edit(`AI check failed: ${res.error}`);
    }

    recordAiHealthEvent({ type: 'testai', user: message.author.id, model: OPENAI_MODEL, ok: true, latency: res.duration, sample: res.sample });
    try { adminLog(message.guild, `AI health check OK by <@${message.author.id}>: model ${OPENAI_MODEL} ${res.duration}ms`); } catch(e){}
    return reply.edit(`AI check OK (model: ${OPENAI_MODEL}, ${res.duration}ms). Sample: ${res.sample}`);
  },

  // Admin utility: re-register slash commands at runtime
  async registerslashes(message) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    try {
      const grouped = [
        { name: 'fitness', description: 'Fitness-related commands', subcommands: ['track','progress','leaderboard','workoutplan'] },
        { name: 'habits', description: 'Habits management', subcommands: ['add','habits','check'] },
        { name: 'coach', description: 'Coaching tools', subcommands: ['coach','quote'] },
        { name: 'partners', description: 'Partner matching', subcommands: ['partner','leavequeue'] },
        { name: 'admin', description: 'Admin utilities', subcommands: ['setmodel','getmodel','setfallback','getaihealth','testai','registerslashes'] }
      ];

      const cmdDefs = grouped.map(g => ({
        name: g.name.slice(0,32),
        description: g.description,
        options: g.subcommands.map(sc => ({ name: sc.slice(0,32), type: 1, description: `Run ${sc}`, options: [{ name: 'text', type: 3, description: 'Arguments as a single string', required: false }] }))
      }));

      if (process.env.SLASH_GUILD_ID) {
        const targetGuild = client.guilds.cache.get(process.env.SLASH_GUILD_ID);
        if (targetGuild) await targetGuild.commands.set(cmdDefs);
      } else if (client.application) {
        await client.application.commands.set(cmdDefs);
      }

      await message.reply(`Registered ${cmdDefs.length} grouped slash commands`);
    } catch (e) {
      console.error('registerslashes failed', e);
      return message.reply('Failed to register slash commands: '+String(e));
    }
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
  return message.reply(`🏋️ **Your Workout Plan:**\n\n${workout}\n\n*Rest 60-90 seconds between sets*`);
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

// Map command name -> allowed channel (by name). Use null to allow anywhere.
const commandChannelLock = {
  'track': 'daily-check-ins',
  'leaderboard': 'leaderboard',
  'progress': null,
  'partner': null,
  'leavequeue': null,
  'workoutplan': null,
  'addhabit': null,
  'habits': null,
  'check': null,
  'testai': 'admin',
  'getaihealth': 'admin',
  'setmodel': 'admin',
  'setfallback': 'admin',
  'registerslashes': 'admin'
};

function isCommandAllowedInChannel(command, channel) {
  const lock = commandChannelLock[command];
  if (!lock) return true; // allowed anywhere
  if (!channel) return false;
  const cname = (channel.name || '').toLowerCase();
  return cname === lock.toLowerCase();
}

// ---------------- Dynamic command module loader ----------------
async function loadCommandModules() {
  try {
    const dir = path.join(process.cwd(), 'src', 'commands');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    const groups = {};
    for (const f of files) {
      try {
        const modPath = path.join(dir, f);
        const imported = await import(modPath);
        const def = imported.default;
        if (def && def.name && typeof def.execute === 'function') {
          // wrap module's execute to match existing handler signature
          commandHandlers[def.name] = async (message, args) => {
            const context = { client, EmbedBuilder, PermissionFlagsBits, ChannelType, getOpenAIResponse, validateModel, adminLog, storage, saveHabits, savePartnerQueue, savePartners, saveMatches, saveStrikes, saveChallenges, saveWeekly, saveMonthly, saveMemory, habitTracker, fitnessWeekly, partnerQueue, matches, onboarding, startOnboarding };
            await def.execute(context, message, args);
          };

          // collect metadata for auto slash registration
          const groupName = def.group || def.slash?.group || 'misc';
          if (!groups[groupName]) groups[groupName] = { name: groupName, description: groupName + ' commands', subcommands: [] };
          groups[groupName].subcommands.push({ name: def.name, slash: def.slash || {} });

          console.log(`Loaded command module: ${def.name} from ${f}`);
        }
      } catch (e) { console.error('Failed to load command module', f, e); }
    }

    // Auto-register slash commands based on loaded modules (group -> subcommands)
    try {
      const cmdDefs = Object.values(groups).map(g => ({
        name: g.name.slice(0,32),
        description: g.description.slice(0,100),
        options: g.subcommands.map(sc => {
          // build subcommand option
          const base = { name: sc.name.slice(0,32), type: 1, description: `Run ${sc.name}`, options: [] };
          const opts = sc.slash?.options || sc.slash?.opts || [];
          for (const o of opts) base.options.push({ name: o.name, type: o.type || 3, description: (o.description||'').slice(0,100), required: !!o.required });
          // if no options, allow a freeform 'text' string
          if (!base.options.length) base.options.push({ name: 'text', type: 3, description: 'Arguments as a single string', required: false });
          return base;
        })
      }));

      if (cmdDefs.length) {
        if (process.env.SLASH_GUILD_ID) {
          const targetGuild = client.guilds.cache.get(process.env.SLASH_GUILD_ID);
          if (targetGuild) await targetGuild.commands.set(cmdDefs);
        } else if (client.application) {
          await client.application.commands.set(cmdDefs);
        }
        console.log(`Auto-registered ${cmdDefs.length} grouped slash command definitions from modules`);
      }
    } catch (e) {
      console.error('Auto slash registration failed:', e);
    }
  } catch (e) { console.error('loadCommandModules error:', e); }
}

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
      // enforce channel locks
      if (!isCommandAllowedInChannel(command, message.channel)) {
        const allowed = commandChannelLock[command];
        return message.reply({ content: 'That command must be used in the `' + allowed + '` channel. Please try there.', allowedMentions: { repliedUser: false } });
      }
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
      const ch = guild.channels.cache.find(c => ['daily-check-ins', 'check-ins', 'general', 'main', 'chat'].includes((c.name || '').toLowerCase()));
      if (!ch) continue;
      const embed = new EmbedBuilder()
        .setTitle('� Daily Check-In')
        .setDescription('How was your workout today? Reply with `!track yes` or `!track no`.')
        .setColor(0x00AE86)
        .setTimestamp(new Date());
      try { await ch.send({ embeds: [embed] }); } catch (e) { /* ignore send errors */ }
    }
  } catch (error) {
    console.error('Error sending check-in reminders:', error);
  }
}

// ---------------- Health Posts ----------------
async function postHealthContent() {
  try {
    // Health topics to generate content about
    const healthTopics = [
      "benefits of intermittent fasting",
      "dangers of processed food additives",
      "natural anti-inflammatory foods",
      "harmful effects of seed oils",
      "benefits of cold exposure therapy",
      "natural ways to boost testosterone",
      "how artificial sweeteners affect gut health",
      "benefits of organ meats and nose-to-tail eating",
      "how EMF exposure affects sleep quality",
      "natural alternatives to common medications",
      "benefits of grounding/earthing",
      "how industrial seed oils cause inflammation",
      "benefits of sunlight exposure",
      "dangers of microplastics in food and water",
      "how to detox from heavy metals naturally"
    ];
    
    const randomTopic = healthTopics[Math.floor(Math.random() * healthTopics.length)];
    
    const prompt = `You are a health expert who focuses on natural healing, longevity, and health information that's not commonly discussed in mainstream medicine. Write a concise, informative post (max 250 words) about ${randomTopic}. Include scientific backing where possible, but focus on practical advice. Format with markdown headings and bullet points for readability.`;
    
    const content = await getOpenAIResponse(prompt);
    
    for (const guild of client.guilds.cache.values()) {
      const healthChannel = guild.channels.cache.find(ch => ch.name === 'health');
        if (healthChannel) {
        await healthChannel.send(`🩺 **HEALTH INSIGHT** 🩺\n\n${content}`);
      }
    }
  } catch (error) {
    console.error("Error posting health content:", error);
  }
}

// Update or post a pinned health embed in the guild's #gbb-health channel
async function updateHealthForGuild(context, guild) {
  try {
    const ch = guild.channels.cache.find(c => (c.name||'').toLowerCase() === 'gbb-health' && c.type === ChannelType.GuildText);
    if (!ch) return;

    const { embed } = await runHealthCheck(context, guild);
    // determine if any failing checks exist
    const overallFail = (function(){
      try { const e = embed.data.fields || []; return e.some(f => (f.name||'').startsWith('🔴') || (f.value||'').toLowerCase().includes('error') || (f.value||'').toLowerCase().includes('failed')); } catch(e){return false;}
    })();

    // Try to use stored message id first
    let existingEntry = healthPosts.find(h => h.guildId === guild.id && h.channelId === ch.id);
    let existingMessage = null;
    if (existingEntry && existingEntry.messageId) {
      try { existingMessage = await ch.messages.fetch(existingEntry.messageId).catch(()=>null); } catch(e) { existingMessage = null; }
    }

    // If we don't have a stored message, search pinned messages for our health embed
    if (!existingMessage) {
      try {
        const pins = await ch.messages.fetchPinned();
        existingMessage = pins.find(m => m.author?.id === client.user.id && m.embeds?.[0]?.title?.includes('GymBotBro — Health Scan')) || null;
      } catch (e) { existingMessage = null; }
    }

    if (existingMessage) {
      try {
        await existingMessage.edit({ embeds: [embed] });
      } catch (e) { /* ignore edit errors */ }
      // ensure persistence
      if (!existingEntry) {
        healthPosts.push({ guildId: guild.id, channelId: ch.id, messageId: existingMessage.id });
        await saveHealthPosts();
      } else if (existingEntry.messageId !== existingMessage.id) {
        existingEntry.messageId = existingMessage.id; await saveHealthPosts();
      }
      return;
    }

    // Otherwise send a new message and pin it
    const sent = await ch.send({ embeds: [embed] });
    try { await sent.pin(); } catch (e) {}
    // record
    healthPosts = healthPosts.filter(h => !(h.guildId === guild.id && h.channelId === ch.id));
    healthPosts.push({ guildId: guild.id, channelId: ch.id, messageId: sent.id });
    await saveHealthPosts();

    // If health is failing, alert admins (rate-limited per guild)
    try {
      if (overallFail) {
        const last = lastHealthAlert[guild.id] || 0;
        const now = Date.now();
        const thirtyMin = 30 * 60 * 1000;
        if (now - last > thirtyMin) {
          lastHealthAlert[guild.id] = now; await saveLastHealthAlert();
          const adminChs = await findAdminChannels(guild);
          let alertTarget = adminChs.logging || adminChs.admin || adminChs.mod || ch;
          const alertMsg = `🚨 **GymBotBro Alert:** Health scan detected issues. Check the pinned health report in <#${ch.id}>.`;
          try { await alertTarget.send({ content: alertMsg }); } catch(e){ try { await ch.send(alertMsg); } catch(e){} }
        }
      }
    } catch(e){ console.error('failed to send health alert', e); }
  } catch (e) {
    console.error('updateHealthForGuild error for guild', guild.id, e);
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
    
    const prompt = `You are a wealth-building expert who shares insider financial knowledge that banks and financial institutions don't advertise. Write a concise, practical tip (max 250 words) about ${randomTopic}. Focus on actionable advice for men in their 20s-30s. Format with a clear headline and bullet points for key takeaways.`;
    
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
    const videoPrompt = `You are a fitness expert specializing in men's fitness for those in their teens, 20s and early 30s. Recommend ONE specific YouTube video about "${randomTopic}". Provide ONLY the exact YouTube video title and channel name in this format: "Video Title | Channel Name". Choose videos from popular fitness channels like AthleanX, Jeff Nippard, Jeremy Ethier, Hybrid Calisthenics, or similar quality channels.`;
    
    const videoRecommendation = await getOpenAIResponse(videoPrompt);
    
    // Then, get training tips on the same topic
    const tipsPrompt = `You are a fitness expert specializing in men's fitness for those in their teens, 20s and early 30s. Write 3-4 practical, science-based tips about "${randomTopic}". Format as bullet points. Keep it concise, motivational, and immediately applicable.`;
    
    const fitnessTips = await getOpenAIResponse(tipsPrompt);
    
  const message = `💪 **FITNESS FOCUS: ${randomTopic.toUpperCase()}** 💪\n\n${fitnessTips}\n\n🎬 **RECOMMENDED WATCH:**\n${videoRecommendation}`;
    
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

// ---------------- Daily motivation (9 AM) ----------------
cron.schedule('0 9 * * *', async () => {
  try {
    const quotes = [
      "Rise and grind! Today's your day to be better than yesterday.",
      "The only bad workout is the one that didn't happen. Make it count!",
      "Your body can stand almost anything. It's your mind you have to convince.",
      "Success isn't given. It's earned in the gym and through discipline."
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

// ---------------- Partner matching (every 30 minutes) ----------------
cron.schedule('*/30 * * * *', tryAutoMatch);

// ---------------- Bot Ready ----------------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("!help for commands");
  loadAllData();
  // Load optional command modules from src/commands (allows modular commands)
  await loadCommandModules();
  setInterval(() => tryAutoMatch(), 1000 * 30); // every 30s

  // Run startup AI health check and pin admin docs to admin/mod/logging channels
  await tryConnectMongo();
  await startupAiHealthCheck();

  for (const guild of client.guilds.cache.values()) {
    try {
      await pinCommandDocs(guild);
      // log that pinning was attempted
      try { adminLog(guild, `Pinned admin docs and logging docs during startup.`); } catch(e){}
    } catch (e) { console.error('Error pinning docs for guild', guild.id, e); }
  }

  // Post a brief startup health message into #gbb-health where available
  try {
    // Run an initial full health run (and schedule periodic updates)
    const healthContext = { client, storage, validateModel, aiHealth, getOpenAIResponse, adminLog };
    for (const guild of client.guilds.cache.values()) {
      try {
        await updateHealthForGuild(healthContext, guild);
      } catch (e) { console.error('initial health update failed for guild', guild.id, e); }
    }
    // Schedule periodic health updates (every 5 minutes)
    cron.schedule('*/5 * * * *', async () => {
      try {
        for (const guild of client.guilds.cache.values()) {
          try { await updateHealthForGuild(healthContext, guild); } catch(e){ console.error('scheduled health update failed for guild', guild.id, e); }
        }
      } catch (e) { console.error('health scheduler error', e); }
    });
  } catch(e) { }
  
  // --- Slash command registration: register grouped slash commands ---
  try {
    // Define logical groups and their subcommands. Each subcommand can accept a single 'text' string argument.
    const grouped = [
      {
        name: 'fitness',
        description: 'Fitness-related commands (track, progress, leaderboard, workoutplan)',
        subcommands: ['track','progress','leaderboard','workoutplan']
      },
      {
        name: 'habits',
        description: 'Habits management (add, list, check)',
        subcommands: ['add','habits','check']
      },
      {
        name: 'coach',
        description: 'Coaching tools (ask, quote)',
        subcommands: ['coach','quote']
      },
      {
        name: 'partners',
        description: 'Partner matching (partner, leavequeue)',
        subcommands: ['partner','leavequeue']
      },
      {
        name: 'admin',
        description: 'Admin utilities (setmodel, getmodel, setfallback, getaihealth, testai, registerslashes)',
        subcommands: ['setmodel','getmodel','setfallback','getaihealth','testai','registerslashes']
      }
    ];

    const cmdDefs = grouped.map(g => ({
      name: g.name.slice(0,32),
      description: g.description,
      options: g.subcommands.map(sc => ({
        name: sc.slice(0,32),
        type: 1, // 1 = SUB_COMMAND
        description: `Run ${sc} (prefix: !${sc})`,
        options: [ { name: 'text', type: 3, description: 'Arguments as a single string', required: false } ]
      }))
    }));

    if (process.env.SLASH_GUILD_ID) {
      const targetGuild = client.guilds.cache.get(process.env.SLASH_GUILD_ID);
      if (targetGuild) await targetGuild.commands.set(cmdDefs);
    } else if (client.application) {
      await client.application.commands.set(cmdDefs);
    }

    console.log(`Registered ${cmdDefs.length} grouped slash commands`);
  } catch (e) { console.error('Slash command registration failed:', e); }
});
client.on('error', console.error);

// Reaction handler: challenge join via 💪
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) {
      try { await reaction.fetch(); } catch (e) { return; }
    }
    const msg = reaction.message;
    if (!msg) return;
    // If the message contains a challenge identifier (simple heuristic)
    if (reaction.emoji && reaction.emoji.name === '💪') {
      // find challenge by message id or channel context
      const chId = msg.channel.id;
      // naive: add user to a challenge list in memory keyed by message id
      if (!challenges[msg.id]) challenges[msg.id] = { name: msg.content?.slice(0,60) || 'challenge', members: [] };
      if (!challenges[msg.id].members.includes(user.id)) {
        challenges[msg.id].members.push(user.id);
        try { await msg.channel.send(`<@${user.id}> joined the challenge: ${challenges[msg.id].name}`); } catch(e){}
        // persist challenge membership via storage
        try { await saveChallenges(); } catch(e){ console.error('saveChallenges failed', e); }
      }
    }
  } catch (e) { console.error('reaction handler error:', e); }
});

process.on('unhandledRejection', (err) => { console.error('Unhandled Rejection:', err); });

// Map slash command interactions to existing prefix handlers
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isCommand?.()) return;

    // Support grouped commands: command name is the group (e.g., 'fitness'), subcommand is the actual action (e.g., 'track')
    const group = interaction.commandName;
    const sub = interaction.options.getSubcommand(false); // returns null if no subcommand

    let handlerName = null;
    let text = '';

    if (sub) {
      // If a subcommand exists, use that as the handler name
      handlerName = sub;
      text = interaction.options.getString('text') || '';
    } else {
      // Backwards compatibility: single-level commands might pass 'text' directly
      // Try to find a handler that matches the group name
      handlerName = group;
      text = interaction.options.getString('text') || '';
    }

    const handler = commandHandlers[handlerName];
    if (!handler) return interaction.reply({ content: 'Command handler not found for: ' + handlerName, ephemeral: true });

    // enforce channel locks for interactions
    if (!isCommandAllowedInChannel(handlerName, interaction.channel)) {
      const allowed = commandChannelLock[handlerName];
      return interaction.reply({ content: 'That command must be used in the `' + allowed + '` channel. Please try there.', ephemeral: true });
    }

    const args = text.trim() ? text.trim().split(/ +/g) : [];

    const fakeMessage = {
      author: interaction.user,
      member: interaction.member,
      guild: interaction.guild,
      channel: interaction.channel,
      reply: async (payload) => {
        const content = typeof payload === 'string' ? payload : (payload.content || JSON.stringify(payload));
        if (!interaction.replied && !interaction.deferred) return interaction.reply({ content, fetchReply: true });
        return interaction.followUp({ content, fetchReply: true });
      }
    };

    await handler(fakeMessage, args);
  } catch (e) {
    console.error('interaction handler error:', e);
    try { if (!interaction.replied) await interaction.reply({ content: 'Error running command', ephemeral: true }); } catch(e){}
  }
});

// ---------------- Start Bot ----------------
client.login(process.env.DISCORD_TOKEN);
