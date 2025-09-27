// bot.js
import dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import OpenAI from 'openai';
import express from 'express';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import axios from 'axios';
import { google } from 'googleapis';
import { sendNormalized, fixEmojis } from './src/utils.js';
import persistence, { files as P_FILES, state as P_STATE, loadAllData as P_loadAllData, saveAllData as P_saveAllData, saveBirthdays as P_saveBirthdays, loadBirthdays as P_loadBirthdays } from './src/persistence.js';

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
let mongoClient = null;
let mongoDb = null;
const MONGO_URI = process.env.MONGO_URI || null;
async function tryConnectMongo() {
  if (!MONGO_URI) return;
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    mongoDb = mongoClient.db();
    console.log('[Mongo] Connected to MongoDB');
  } catch (e) { console.error('[Mongo] Connection failed:', e); mongoClient=null; mongoDb=null; }
}

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
// Use small persistence module
// ...existing code...
// We'll use the persistence module state and functions where appropriate below.
// loadAllData is called later during ready()
function loadGuildConfigs() { if (persistence && persistence.state && persistence.state.guildConfigs) { /* no-op; state already in persistence.state */ } }
function saveGuildConfigs() { if (persistence && persistence.state && persistence.state.guildConfigs) { /* persistence.save will persist when needed */ } }


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
function persistEnvVar(key, value) {
  try {
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
// richer strike config (keeps compatibility with STRIKE_LIMIT)
const STRIKE_CONFIG = {
  warnCount: 1,
  muteCount: 2,
  endPartnerCount: 3,
  banCount: 4,
  muteDurationMs: 2 * 60 * 60 * 1000, // 2 hours
  exposureUnlocks: [5, 10, 15]
};
const EXPOSURE_THRESHOLDS = { tier1:{messages:5,days:2}, tier2:{messages:20,days:7}, tier3:{messages:40,days:21} };
const LEADERBOARD_UPDATE_CRON = '0 6 * * *';
const ENGAGEMENT_REMINDER_CRON = '0 12 1,15 * *';
const CHECK_IN_TIMES = ['0 8 * * *', '0 12 * * *', '0 15 * * *', '0 18 * * *', '0 20 * * *', '0 22 * * *']; // 8am, 12pm, 3pm, 6pm, 8pm, 10pm

// ---------- Check-in state and helpers ----------
// pendingCheckins: userId -> { ts, attempts, lastPromptChannelId }
const pendingCheckins = {};

// Map persistence state to local names used in the large file for minimal changes
const memory = persistence.state.memory;
const birthdays = persistence.state.birthdays;
const fitnessWeekly = persistence.state.fitnessWeekly;
const fitnessMonthly = persistence.state.fitnessMonthly;
const fitnessYearly = persistence.state.fitnessYearly;
const weeklySnapshots = persistence.state.weeklySnapshots;
const monthlySnapshots = persistence.state.monthlySnapshots;
const yearlySnapshots = persistence.state.yearlySnapshots;
const partnerQueue = persistence.state.partnerQueue;
const partners = persistence.state.partners;
const matches = persistence.state.matches;
const strikes = persistence.state.strikes;
const habitTracker = persistence.state.habitTracker;
const challenges = persistence.state.challenges;
const onboarding = persistence.state.onboarding;
const leaderboardPotential = persistence.state.leaderboardPotential;
const checkInMutes = persistence.state.checkInMutes;
const healthPosts = persistence.state.healthPosts;
const wealthTips = persistence.state.wealthTips;
const fitnessPosts = persistence.state.fitnessPosts;
const aiHealth = persistence.state.aiHealth;
const guildConfigs = persistence.state.guildConfigs;

// recentChannelSends used to avoid duplicate messages in the same channel
const recentChannelSends = {}; // channelId -> { text, ts }

function fixEmojis(text) {
  if (!text || typeof text !== 'string') return text;
  // common broken sequences seen when files are saved with wrong encoding
  const map = {
    '≡ƒÆ¬': '💪', '≡ƒöÑ': '🔥', 'Γ¥î': '❌', 'Γ£à': '✅', '≡ƒÅå': '🏆', '≡ƒôê': '📈', '≡ƒÄ»': '✨', '≡ƒÆ»': '💯'
  };
  let out = text;
  for (const k of Object.keys(map)) out = out.split(k).join(map[k]);
  // remove any leftover weird control characters
  out = out.replace(/[\uFFFD\u0000-\u001F]/g, '');
  return out;
}

async function sendNormalized(channel, contentOrOptions) {
  try {
    let content = typeof contentOrOptions === 'string' ? contentOrOptions : (contentOrOptions.content || '');
    content = fixEmojis(content);

    // avoid sending the exact same content to the same channel within 2 minutes
    const last = recentChannelSends[channel.id];
    const now = Date.now();
    if (last && last.text === content && now - last.ts < 2 * 60 * 1000) {
      return null; // skip duplicate
    }
    recentChannelSends[channel.id] = { text: content, ts: now };

    if (typeof contentOrOptions === 'string') return await channel.send(content);
    // if it's an object with embeds or other properties, fix embed descriptions/titles
    if (contentOrOptions.embeds) {
      contentOrOptions.embeds.forEach(e => {
        if (e.title) e.title = fixEmojis(e.title);
        if (e.description) e.description = fixEmojis(e.description);
        if (e.footer && e.footer.text) e.footer.text = fixEmojis(e.footer.text);
      });
    }
    return await channel.send(contentOrOptions);
  } catch (e) {
    console.error('sendNormalized error:', e);
    try { return await channel.send(typeof contentOrOptions === 'string' ? contentOrOptions : contentOrOptions.content || ''); } catch (e2) { return null; }
  }
}
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

  const checkinTemplate = await channel.send(`Check-in template:\nΓÇó How was your workout today?\nΓÇó Any blockers?\nΓÇó Plan for tomorrow:`);
  await checkinTemplate.pin();
}

// Post short public guides into common community channels and pin them if not present
async function postChannelGuides(guild) {
  try {
    const guides = {
      'daily-check-ins': "Daily Check-Ins Guide:\n- Reply 'yes' or 'no' in this channel or use `!track yes/no`.\n- Use `!mutecheck day|week|forever` to silence prompts.",
      'health': "Health Channel Guide:\n- Posts are informational. No medical advice. Share sources when posting.",
      'wealth': "Wealth Channel Guide:\n- Practical tips and resources. Keep promo/links minimal.",
      'fitness': "Fitness Channel Guide:\n- Share workouts, tips, form questions. Be respectful and avoid giving medical advice.",
      'general': "General Chat Guide:\n- Community chat and introductions. Keep it civil.",
      'leaderboard': "Leaderboard Channel:\n- Weekly leaderboard of workouts. Use `!leaderboard` to view."
    };

    for (const [chName, text] of Object.entries(guides)) {
      const ch = guild.channels.cache.find(c => (c.name||'').toLowerCase() === chName);
      if (!ch) continue;
      const pins = await ch.messages.fetchPinned().catch(()=>null);
      const already = pins && pins.find(m => m.content && m.content.startsWith(text.split('\n')[0]));
      if (!already) {
        const sent = await sendNormalized(ch, text);
        try { if (sent && sent.pin) await sent.pin(); } catch(e){}
      }
    }
  } catch (e) { console.error('postChannelGuides error:', e); }
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
    await sendNormalized(loggingChannel, `User <@${userId}> received a strike in <#${channelId}>. Reason: ${reason}. Total strikes: ${strikes[channelId][userId]}`);
  }

  try {
    const user = await client.users.fetch(userId);
    await user.send(`You received a strike for: ${reason}. Strike ${strikes[channelId][userId]}/${STRIKE_LIMIT}. Check pinned rules.`);
  } catch (e) {}

  if (strikes[channelId][userId] >= STRIKE_LIMIT) {
    await handleChannelDeletionAndBlock(channelId, `Reached ${STRIKE_LIMIT} strikes`);
  }
}

// Advanced guild-level strike handler (object param) used by some checks
async function applyStrikeAdvanced({ guild, userId, issuerId = null, reason = 'Violation', channel = null, immediateBan = false }) {
  try {
    if (!guild || !guild.id) return;
    const sr = ensureStrikeRecord(guild.id, userId);
    const time = new Date().toISOString();

    if (immediateBan) {
      sr.count = (sr.count || 0) + 1;
      sr.history = sr.history || [];
      sr.history.push({ time, reason: `${reason} (Immediate ban)`, issuer: issuerId });
      sr.blockedFromMatching = true;
      saveStrikes();
      try { (await client.users.fetch(userId)).send(`You have been banned from ${guild.name} for: ${reason}`); } catch {}
      try {
        if (guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
          await guild.members.ban(userId, { reason: `Immediate ban: ${reason}` });
        } else {
          await notifyLoggingChannel(guild, `❗ Tried to ban <@${userId}> but missing BanMembers permission.`);
        }
      } catch (e) { console.error('Immediate ban failed:', e); }
      await notifyLoggingChannel(guild, new EmbedBuilder().setTitle('Immediate Ban Executed').setDescription(`<@${userId}> was banned for: ${reason}`).setColor(0xff0000).setTimestamp());
      return;
    }

    sr.count = (sr.count || 0) + 1;
    sr.history = sr.history || [];
    sr.history.push({ time, reason, issuer: issuerId, channelId: channel ? channel.id : null });
    saveStrikes();

    if (sr.count >= STRIKE_CONFIG.warnCount && sr.count < STRIKE_CONFIG.muteCount) {
      try { (await client.users.fetch(userId)).send(`⚠️ Warning in ${guild.name}: ${reason}\nThis is strike ${sr.count}. Repeated violations will escalate.`); } catch {}
      await notifyLoggingChannel(guild, new EmbedBuilder().setTitle('Strike Issued').setDescription(`<@${userId}> has been issued a warning (strike ${sr.count}).\nReason: ${reason}`).setColor(0xffa500).setTimestamp());
    }

    if (sr.count >= STRIKE_CONFIG.muteCount && sr.count < STRIKE_CONFIG.endPartnerCount) {
      let mutedRole = guild.roles.cache.find(r => r.name === 'Muted');
      if (!mutedRole) {
        try { mutedRole = await guild.roles.create({ name: 'Muted', reason: 'Create muted role for strikes' }); } catch (e) { console.error('Could not create Muted role:', e); mutedRole = null; }
      }
      if (mutedRole) {
        for (const ch of guild.channels.cache.values()) {
          try { if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice) await ch.permissionOverwrites.edit(mutedRole, { SendMessages: false, AddReactions: false }, { reason: 'Mute role update for strikes' }); } catch(e){}
        }
      }
      try {
        const member = await guild.members.fetch(userId).catch(()=>null);
        if (member && mutedRole) {
          await member.roles.add(mutedRole, `Temporary mute - strike ${sr.count}`);
          sr.mutedUntil = Date.now() + STRIKE_CONFIG.muteDurationMs;
          saveStrikes();
          try { (await client.users.fetch(userId)).send(`⏳ You have been temporarily muted in ${guild.name} for ${STRIKE_CONFIG.muteDurationMs / (60*60*1000)} hours due to: ${reason}`); } catch {}
          await notifyLoggingChannel(guild, `🔇 <@${userId}> muted for ${STRIKE_CONFIG.muteDurationMs/1000/60/60}h (strike ${sr.count}).`);
        }
      } catch (e) { console.error('Mute assignment error:', e); }
    }

    if (sr.count >= STRIKE_CONFIG.endPartnerCount && sr.count < STRIKE_CONFIG.banCount) {
      sr.blockedFromMatching = true;
      saveStrikes();
      for (const [chanId, meta] of Object.entries(partners)) {
        if (meta.users && meta.users.includes(userId)) {
          const ch = await client.channels.fetch(chanId).catch(()=>null);
          if (ch) await endPartnerChannel(ch, `Ended due to repeated violations by <@${userId}>`);
          else { delete partners[chanId]; savePartners(); }
        }
      }
      await notifyLoggingChannel(guild, new EmbedBuilder().setTitle('Partner Ended & Blocked').setDescription(`<@${userId}> had partner channels ended and is blocked from future matching (strike ${sr.count}).`).setColor(0xff4500).setTimestamp());
      try { (await client.users.fetch(userId)).send(`⛔ Your partner pairing(s) have been ended and you are blocked from future pairings due to repeated violations.`); } catch {}
    }

    if (sr.count >= STRIKE_CONFIG.banCount) {
      try {
        const member = await guild.members.fetch(userId).catch(()=>null);
        if (member && guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
          await guild.members.ban(userId, { reason: `Reached strike threshold (${sr.count}).` });
          await notifyLoggingChannel(guild, new EmbedBuilder().setTitle('User Banned').setDescription(`<@${userId}> was banned for reaching ${sr.count} strikes.`).setColor(0xff0000).setTimestamp());
        } else await notifyLoggingChannel(guild, `Attempted ban for <@${userId}> but missing permission.`);
      } catch (e) { console.error('Ban attempt error:', e); }
    }
  } catch (e) { console.error('applyStrikeAdvanced error:', e); }
}

// ---------------- Delete Channel + Block ----------------
async function handleChannelDeletionAndBlock(channelId, reason = 'strike limit') {
  const rec = partners[channelId];
  if (!rec) return;

  try {
    const guild = client.guilds.cache.get(rec.guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (channel) {
      await sendNormalized(channel, `This private channel will be deleted due to: ${reason}`);
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
  if (loggingChannel) await sendNormalized(loggingChannel, `Deleted private channel ${channelId} and blocked users due to: ${reason}`);
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

  await sendNormalized(channel, `≡ƒöô **Incremental exposure update:** Tier ${minTier} unlocked! Be respectful.`);
      const userA = await client.users.fetch(aId);
      const userB = await client.users.fetch(bId);
  try { await userA.send(`New info about your partner (Tier ${minTier}):\n${reveal(bId, minTier)}`); } catch { await sendNormalized(channel, 'DM to userA blocked'); }
  try { await userB.send(`New info about your partner (Tier ${minTier}):\n${reveal(aId, minTier)}`); } catch { await sendNormalized(channel, 'DM to userB blocked'); }
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
    // Also post a mysterious matches counter to the same channel (anonymous, no names)
    const matchesCount = Object.keys(partners || {}).length || 0;
    const mysteryMsg = `👥 Future Partner Activity: ${matchesCount} active matches`;
    await leaderboardChannel.send({ content: mysteryMsg });
    // We'll call checkRoleRewards elsewhere
  } catch (e) {
    console.error("updateLeaderboardChannel error:", e.message);
  }
}

// compute percent success for a user (yes / (yes+no)) * 100
function computePercent(data) {
  const yes = (data && data.yes) || 0;
  const no = (data && data.no) || 0;
  const total = yes + no;
  if (total === 0) return 0;
  return Math.round((yes / total) * 100);
}

// Award role to top winner(s) for a period (weekly/monthly)
async function awardPeriodWinner(period, snapshot) {
  try {
    if (!snapshot || !snapshot.entries || snapshot.entries.length === 0) return;
    const top = snapshot.entries[0];
    if (!top) return;
  // We'll prefer per-guild config but fallback to env vars
  const envKey = `ROLE_${period.toUpperCase()}_WINNER`;
  const globalRoleCfg = process.env[envKey] || null;

    // previous winner (from previous snapshot) - attempt to remove role
    const prevSnapshot = (period === 'weekly' ? weeklySnapshots : monthlySnapshots)[(period === 'weekly' ? weeklySnapshots : monthlySnapshots).length - 2];
    const prevWinners = prevSnapshot ? (prevSnapshot.entries[0] ? [prevSnapshot.entries[0].uid] : []) : [];

    for (const guild of client.guilds.cache.values()) {
      try {
        // resolve per-guild config first
        const gc = getGuildConfig(guild.id) || {};
        const roleCfg = gc[`role_${period}_winner`] || globalRoleCfg;
        if (!roleCfg) continue;
        let role = guild.roles.cache.get(roleCfg) || guild.roles.cache.find(r => r.name === roleCfg);
        if (!role) continue; // no role in this guild

        // remove role from previous winner(s) if present
        for (const uid of prevWinners) {
          try {
            const prevMember = await guild.members.fetch(uid).catch(()=>null);
            if (prevMember && prevMember.roles.cache.has(role.id)) {
              await prevMember.roles.remove(role).catch(()=>null);
            }
          } catch(e) {}
        }

        // assign role to new winner if they are in this guild and notify
        const member = await guild.members.fetch(top.uid).catch(()=>null);
        if (member) {
          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role).catch(e=>console.error('awardPeriodWinner add role failed', e));
            try { adminLog(guild, `Awarded ${role.name} to <@${top.uid}> for ${period} winner.`); } catch(e){}
          }

          // send an embed announcement to the leaderboard channel if present
          try {
            const lb = guild.channels.cache.find(ch => (ch.name||'').toLowerCase() === 'leaderboard');
            if (lb) {
              const embed = new EmbedBuilder()
                .setTitle(`${period.charAt(0).toUpperCase()+period.slice(1)} Winner`)
                .setDescription(`Congratulations <@${top.uid}>! You were the top ${period} performer with ${top.percent}% success.`)
                .setTimestamp()
                .setColor(0x00FF00);
              await lb.send({ embeds: [embed] }).catch(()=>null);
            }
          } catch(e) { console.error('awardPeriodWinner announce failed', e); }

          // DM the winner a congratulations message
          try {
            await member.send(`Congrats! You were top ${period} performer with ${top.percent}% success. You've been awarded the role ${role.name} in ${guild.name}.`).catch(()=>null);
          } catch(e) {}
        }
      } catch (e) {
        console.error('awardPeriodWinner guild loop error', e);
      }
    }
  } catch (e) { console.error('awardPeriodWinner error', e); }
}

// Snapshot current weekly metrics (store percent per user, then clear weekly data)
function snapshotWeekly() {
  const ts = Date.now();
  const snapshot = { ts, entries: [] };
  for (const [uid, data] of Object.entries(fitnessWeekly)) {
    snapshot.entries.push({ uid, yes: data.yes || 0, no: data.no || 0, percent: computePercent(data) });
  }
  // sort by percent desc then yes count
  snapshot.entries.sort((a, b) => (b.percent - a.percent) || (b.yes - a.yes));
  weeklySnapshots.push(snapshot);
  saveLoadMap.weeklySnapshots[0]();
  // Award weekly role winners (if configured)
  try { awardPeriodWinner('weekly', snapshot); } catch (e) { console.error('awardPeriodWinner weekly failed', e); }
  // Clear weekly counts to start fresh
  fitnessWeekly = {};
  saveWeekly();
}

// Snapshot monthly metrics similarly and clear monthly
function snapshotMonthly() {
  const ts = Date.now();
  const snapshot = { ts, entries: [] };
  for (const [uid, data] of Object.entries(fitnessMonthly)) {
    snapshot.entries.push({ uid, yes: data.yes || 0, no: data.no || 0, percent: computePercent(data) });
  }
  snapshot.entries.sort((a, b) => (b.percent - a.percent) || (b.yes - a.yes));
  monthlySnapshots.push(snapshot);
  saveLoadMap.monthlySnapshots[0]();
  // Award monthly role winners (if configured)
  try { awardPeriodWinner('monthly', snapshot); } catch (e) { console.error('awardPeriodWinner monthly failed', e); }
  // move monthly into yearly aggregates
  for (const [uid, data] of Object.entries(fitnessMonthly)) {
    if (!fitnessYearly[uid]) fitnessYearly[uid] = { yes: 0, no: 0 };
    fitnessYearly[uid].yes = (fitnessYearly[uid].yes || 0) + (data.yes || 0);
    fitnessYearly[uid].no = (fitnessYearly[uid].no || 0) + (data.no || 0);
  }
  saveLoadMap.yearly[0]();
  // Clear monthly
  fitnessMonthly = {};
  saveMonthly();
}

// Snapshot yearly (annual snapshot) and optionally reset yearly if desired
function snapshotYearly(resetAfter = false) {
  const ts = Date.now();
  const snapshot = { ts, entries: [] };
  for (const [uid, data] of Object.entries(fitnessYearly)) {
    snapshot.entries.push({ uid, yes: data.yes || 0, no: data.no || 0, percent: computePercent(data) });
  }
  snapshot.entries.sort((a, b) => (b.percent - a.percent) || (b.yes - a.yes));
  yearlySnapshots.push(snapshot);
  saveLoadMap.yearlySnapshots[0]();
  if (resetAfter) {
    fitnessYearly = {};
    saveLoadMap.yearly[0]();
  }
}

// Auto-schedule: update leaderboard daily and take snapshots weekly/monthly/yearly
const DAILY_LEADERBOARD_CRON = process.env.LEADERBOARD_DAILY_CRON || '0 7 * * *';
cron.schedule(DAILY_LEADERBOARD_CRON, async () => { // configurable daily cron
  try { await updateLeaderboardChannel(); } catch (e) { console.error('daily leaderboard update failed', e); }
});

// Weekly snapshot Sunday midnight
cron.schedule('0 0 * * 0', async () => {
  try { snapshotWeekly(); await updateLeaderboardChannel(); } catch (e) { console.error('weekly snapshot failed', e); }
});

// Monthly snapshot: 1st day of month at 00:10
cron.schedule('10 0 1 * *', async () => {
  try { snapshotMonthly(); await updateLeaderboardChannel(); } catch (e) { console.error('monthly snapshot failed', e); }
});

// Yearly snapshot: Jan 1 at 00:20
cron.schedule('20 0 1 1 *', async () => {
  try { snapshotYearly(true); await updateLeaderboardChannel(); } catch (e) { console.error('yearly snapshot failed', e); }
});

// ---------------- Command Handlers ----------------
const commandHandlers = {
  async help(message) {
    const embed = new EmbedBuilder()
      .setTitle("≡ƒÆ¬ GymBotBro Commands")
      .setDescription("Your accountability partner for fitness and life!")
      .addFields(
        { name: "≡ƒÄ» Fitness", value: "`!track yes/no` - Log workout\n`!progress` - View stats\n`!leaderboard` - Rankings", inline: true },
        { name: "≡ƒôê Habits", value: "`!addhabit [habit]` - Track habit\n`!habits` - View habits\n`!check [habit]` - Check off", inline: true },
        { name: "≡ƒÆ¬ Coaching", value: "`!coach [question]` - Get advice\n`!quote` - Motivation\n`!workoutplan` - Get workout", inline: true },
        { name: "≡ƒæÑ Partners", value: "`!partner goal` - Find accountability partner\n`!partner future` - Find future partner\n`!leavequeue` - Exit matching queue", inline: true }
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
      return message.reply(`≡ƒÆ¬ **Coach says:**\n${response}`);
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
      // react with proper emoji and send fixed reply
  try { await message.react('\u{1F4AA}'); } catch(e){}
      message.reply("Beast mode activated! 🔥");
      if (pendingCheckins[authorId]) delete pendingCheckins[authorId];
    } else {
      fitnessWeekly[authorId].no += 1;
  try { await message.react('\u274C'); } catch(e){}
      message.reply("Tomorrow is a new day! 💯");
      if (pendingCheckins[authorId]) delete pendingCheckins[authorId];
    }

    saveWeekly();
  },

  async progress(message) {
    const authorId = message.author.id;
    const data = fitnessWeekly[authorId] || { yes: 0, no: 0 };

    const total = data.yes + data.no;
    const rate = total > 0 ? Math.round((data.yes / total) * 100) : 0;

    const embed = new EmbedBuilder()
      .setTitle(`≡ƒôè ${message.author.username}'s Progress`)
      .addFields(
        { name: "This Week", value: `Γ£à ${data.yes} workouts\nΓ¥î ${data.no} missed\nSuccess Rate: ${rate}%`, inline: true }
      )
      .setColor(rate >= 70 ? 0x00FF00 : rate >= 50 ? 0xFFFF00 : 0xFF0000);

    return message.reply({ embeds: [embed] });
  },

  async leaderboard(message) {
    const args = Array.from(arguments[1] || []);
    // admin override: !leaderboard now
    if (args[0] === 'now') {
      const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
      const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
      const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
      if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');
      try { await updateLeaderboardChannel(); return message.reply('Leaderboard updated.'); } catch (e) { return message.reply('Failed to update leaderboard: '+String(e)); }
    }

    const sorted = Object.entries(fitnessWeekly).sort((a, b) => b[1].yes - a[1].yes);
    if (!sorted.length) return message.reply("No fitness data recorded this week.");
    let msg = "≡ƒÅå **WEEKLY LEADERBOARD** ≡ƒÅå\n\n";
    const medals = ["≡ƒÑç", "≡ƒÑê", "≡ƒÑë"];
    sorted.slice(0, 5).forEach(([userId, data], index) => {
      msg += `${medals[index] || "≡ƒö╕"} <@${userId}> - ${data.yes} workouts\n`;
    });
    return message.reply(msg);
  },

  // Admin: force snapshot now
  async snap(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const which = (args[0] || '').toLowerCase();
    if (!['weekly','monthly','yearly'].includes(which)) return message.reply('Usage: `!snap weekly|monthly|yearly`');
    try {
      if (which === 'weekly') snapshotWeekly();
      if (which === 'monthly') snapshotMonthly();
      if (which === 'yearly') snapshotYearly(true);
      await updateLeaderboardChannel();
      return message.reply(`Snapshot ${which} completed.`);
    } catch (e) { console.error('snap cmd failed', e); return message.reply('Snapshot failed: '+String(e)); }
  },

  // Admin: list snapshots
  async snapshots(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const which = (args[0] || 'weekly').toLowerCase();
    let list = [];
    if (which === 'weekly') list = weeklySnapshots.slice(-10).reverse();
    else if (which === 'monthly') list = monthlySnapshots.slice(-10).reverse();
    else if (which === 'yearly') list = yearlySnapshots.slice(-10).reverse();
    else return message.reply('Invalid snapshot type. Use weekly/monthly/yearly');

    if (!list.length) return message.reply('No snapshots found for '+which);
    // send compact summary
    const lines = list.map(s => `${new Date(s.ts).toLocaleString()} — top: <@${s.entries[0]?.uid||'n/a'}> (${s.entries[0]?.percent||0}% )`);
    for (let i=0;i<lines.length;i+=50) await message.channel.send(lines.slice(i,i+50).join('\n'));
  },

  // Admin: set/get/clear per-guild winner role
  async setwinnerrole(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const period = (args[0] || '').toLowerCase();
    const roleArg = args.slice(1).join(' ').trim();
    if (!['weekly','monthly'].includes(period)) return message.reply('Usage: `!setwinnerrole weekly|monthly <role id or name>`');
    if (!roleArg) return message.reply('Provide a role id or role name to assign as the winner role.');

    // store raw config; awardPeriodWinner will resolve role per guild
    setGuildConfig(message.guild.id, `role_${period}_winner`, roleArg);
    return message.reply(`Set ${period} winner role to: ${roleArg}`);
  },

  async getwinnerrole(message) {
    const cfg = getGuildConfig(message.guild.id) || {};
    const weekly = cfg.role_weekly_winner || process.env.ROLE_WEEKLY_WINNER || null;
    const monthly = cfg.role_monthly_winner || process.env.ROLE_MONTHLY_WINNER || null;
    return message.reply(`Weekly role: ${weekly || 'not set'}\nMonthly role: ${monthly || 'not set'}`);
  },

  async clearwinnerrole(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const period = (args[0] || '').toLowerCase();
    if (!['weekly','monthly','all'].includes(period)) return message.reply('Usage: `!clearwinnerrole weekly|monthly|all`');
    if (period === 'all') {
      clearGuildConfig(message.guild.id, 'role_weekly_winner');
      clearGuildConfig(message.guild.id, 'role_monthly_winner');
      return message.reply('Cleared weekly and monthly winner roles for this guild.');
    }
    clearGuildConfig(message.guild.id, `role_${period}_winner`);
    return message.reply(`Cleared ${period} winner role for this guild.`);
  },

  // Admin: set the birthday announcements channel for this guild
  async setbirthdaychannel(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const raw = args.join(' ').trim();
    if (!raw) return message.reply('Usage: `!setbirthdaychannel <channel-name-or-#mention-or-id>`');

    // resolve by mention/id or channel name
    const possibleId = raw.replace(/[<#>]/g, '');
    let channel = message.guild.channels.cache.get(possibleId) || message.guild.channels.cache.find(c => c.name === raw) || message.guild.channels.cache.find(c => c.name === possibleId);
    if (!channel) return message.reply('Channel not found. Provide a channel mention, id, or exact channel name.');

    // store the configured channel name so announceBirthdays will prefer it
    try {
      setGuildConfig(message.guild.id, 'birthdayChannel', channel.name);
      try { saveGuildConfigs(); } catch(e){}
      await sendNormalized(message.channel, `Birthday channel set to <#${channel.id}>. Announcements will post there.`);
      return;
    } catch (e) {
      console.error('setbirthdaychannel failed', e);
      return message.reply('Failed to set birthday channel.');
    }
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
    return message.reply(`Γ£à Started tracking: **${habit}**\nUse \`!check ${habit}\` daily!`);
  },

  async habits(message) {
    const authorId = message.author.id;
    const userHabits = habitTracker[authorId] || {};
    
    if (Object.keys(userHabits).length === 0) {
      return message.reply("No habits tracked! Use `!addhabit [habit]` to start.");
    }

    let msg = `≡ƒôê **${message.author.username}'s Habits:**\n\n`;
    Object.entries(userHabits).forEach(([habit, data]) => {
      const today = new Date().toDateString();
      const checkedToday = data.lastChecked === today ? " Γ£à" : "";
      msg += `ΓÇó **${habit}**: ${data.streak} day streak${checkedToday}\n`;
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
      return message.reply("Already checked off today! ≡ƒÄë");
    }

    habitData.streak += 1;
    habitData.lastChecked = today;
    habitData.total += 1;

    saveHabits();

    return message.reply(`Γ£à **${habit}** checked off!\n≡ƒöÑ Streak: ${habitData.streak} days`);
  },

  async quote(message) {
    const quotes = [
      "≡ƒÆ¬ The only bad workout is the one that didn't happen.",
      "≡ƒöÑ Your body can stand almost anything. It's your mind you have to convince.",
      "ΓÜí Success isn't given. It's earned in the gym.",
      "≡ƒÅå The pain you feel today will be the strength you feel tomorrow.",
      "≡ƒÆ» Your only limit is your mind. Push past it.",
      "≡ƒÄ» Don't wish for it, work for it.",
      "≡ƒÆÄ Diamonds are formed under pressure.",
      "Γ¡É Be stronger than your excuses."
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
      const ok = persistEnvVar('OPENAI_MODEL', model);
      if (ok) message.reply('Saved to .env'); else message.reply('Failed to save to .env');
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
      const ok = persistEnvVar('FALLBACK_OPENAI_MODEL', model);
      if (ok) message.reply('Saved to .env'); else message.reply('Failed to save to .env');
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

    const fields = entries.map(e => ({ name: new Date(e.ts).toLocaleString(), value: `${e.type} ΓÇó ${e.model||''} ΓÇó ${e.user?`by <@${e.user}>` : ''} ${e.ok===false?`ΓÇó ERROR: ${e.error}`:''}` })).slice(0,10);
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
      const uniqueNames = [...new Set(Object.keys(normalizedCommandHandlers).map(n => n.toLowerCase().slice(0,32)))];
      const cmdDefs = uniqueNames.map(name => ({
        name: name,
        description: `Run ${name} (prefix: !${name})`,
        options: [ { name: 'text', type: 3, description: 'Arguments as a single string', required: false } ]
      }));

      if (process.env.SLASH_GUILD_ID) {
        const targetGuild = client.guilds.cache.get(process.env.SLASH_GUILD_ID);
        if (targetGuild) await targetGuild.commands.set(cmdDefs);
      } else if (client.application) {
        await client.application.commands.set(cmdDefs);
      }

      await message.reply(`Registered ${cmdDefs.length} slash commands`);
    } catch (e) {
      console.error('registerslashes failed', e);
      return message.reply('Failed to register slash commands: '+String(e));
    }
  },

  async workoutplan(message, args) {
    const type = args[0]?.toLowerCase() || "general";
    
    const workouts = {
      push: "**PUSH DAY**\nΓÇó Push-ups: 3x10-15\nΓÇó Pike push-ups: 3x8-12\nΓÇó Tricep dips: 3x10-15\nΓÇó Plank: 3x30-60s",
      pull: "**PULL DAY**\nΓÇó Pull-ups/Chin-ups: 3x5-10\nΓÇó Inverted rows: 3x8-12\nΓÇó Superman: 3x15\nΓÇó Dead hang: 3x20-30s",
      legs: "**LEG DAY**\nΓÇó Squats: 3x15-20\nΓÇó Lunges: 3x10 each leg\nΓÇó Calf raises: 3x20\nΓÇó Wall sit: 3x30-45s",
      general: "**FULL BODY**\nΓÇó Squats: 3x15\nΓÇó Push-ups: 3x10\nΓÇó Plank: 3x30s\nΓÇó Jumping jacks: 3x20"
    };

    const workout = workouts[type] || workouts.general;
    return message.reply(`≡ƒÅï∩╕ÅΓÇìΓÖé∩╕Å **Your Workout Plan:**\n\n${workout}\n\n*Rest 60-90 seconds between sets*`);
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

    let statusEmoji = "🏋️";
    let message_text = "";
    if (percent >= 100) { statusEmoji = "🏆"; message_text = " - GOAL CRUSHED! 💯"; }
    else if (percent >= 80) { statusEmoji = "🔥"; message_text = " - Almost there!"; }
    else if (percent >= 50) { statusEmoji = "⚡"; message_text = " - Keep pushing!"; }

    return message.reply(`${statusEmoji} **Weekly Goal Progress**\n${current}/${goal} workouts (${percent}%)${message_text}\n[${bar}]`);
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

  // !setbirthday (MM-DD shorthand)
  async setbirthday(message, args) {
    const date = args[0];
    if (!date || !/^\d{2}-\d{2}$/.test(date)) return message.reply("Please provide your birthday in MM-DD format, e.g., `setbirthday 09-23`");
    birthdays[message.author.id] = `${new Date().getFullYear()}-${date}`;
    saveBirthdays();
    return message.reply(`Got it! Your birthday has been saved as ${date}.   `);
  },

  // !birthdays (restrict to general channel similar to external)
  async birthdays(message, channelName) {
    if (channelName !== "general") return message.reply("You can only run `!birthdays` in the #general channel.");
    const entries = Object.entries(birthdays);
    if (!entries.length) return message.channel.send("No birthdays stored yet.");
    let out = "**Saved Birthdays:**\n";
    entries.forEach(([uid, d]) => out += `<@${uid}> → ${d}\n`);
    return message.channel.send({ content: out });
  },

  // Moderator test commands
  async testpair(message, args) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member)) return await message.reply("You must be a moderator to run this test.");
      const mentions = message.mentions.users.map((u) => u.id);
      if (!mentions || mentions.length < 2) return await message.reply("Please mention two users: `!testpair @user1 @user2`");
      const ch = await createPartnerChannel(message.guild, mentions[0], mentions[1], { type: "goal" });
      return await message.reply(`Test pairing created: ${ch ? ch.toString() : "failed"}`);
    } catch (e) { console.error("!testpair error:", e); return message.reply("Test pair failed."); }
  },

  async testdata(message) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member)) return await message.reply("You must be a moderator to run this test.");
      const dataStatus = { memory: Object.keys(memory).length, birthdays: Object.keys(birthdays).length, fitnessWeekly: Object.keys(fitnessWeekly).length, fitnessMonthly: Object.keys(fitnessMonthly).length, partnerQueue: partnerQueue.length, partners: Object.keys(partners).length, strikes: Object.keys(strikes).length, habitTracker: Object.keys(habitTracker).length, challenges: Object.keys(challenges).length };
      return message.reply(`Data status:\n${JSON.stringify(dataStatus, null, 2)}`);
    } catch (e) { console.error("!testdata error:", e); return message.reply("Error checking data status."); }
  },

  async testhabits(message) {
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member)) return await message.reply("You must be a moderator to run this test.");
      const authorId = message.author.id;
      if (!habitTracker[authorId]) habitTracker[authorId] = {};
      habitTracker[authorId]["test-habit"] = { streak: 3, lastChecked: new Date().toDateString(), total: 10 };
      saveHabits();
      return message.reply("Test habit created! Check with `!habits`");
    } catch (e) { console.error("!testhabits error:", e); return message.reply("Error creating test habit."); }
  },

  async checkinTest(message, channelName) {
    if (channelName !== "daily-check-ins") return message.reply("Please run `!checkin-test` in the #daily-check-ins channel for safety.");
    try {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member || !isModeratorMember(member)) return message.reply("You must be a moderator to run this test.");
    } catch (e) { console.error("!checkin-test member fetch error:", e); return message.reply("Error verifying moderator status."); }

    const leaderboardChannel = client.channels.cache.find(ch => (ch.name || "").toLowerCase() === "leaderboard");
    if (!leaderboardChannel) return message.reply("No #leaderboard channel found.");

    const sorted = Object.entries(fitnessWeekly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    let msg = `   WEEKLY FITNESS TEST DUMP   \n`;
    msg += `\n   Weekly Top 5 (TEST):\n`;
    if (sorted.length) msg += `   <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += `\n   Weekly Top 5 (TEST):\n`;
    const medals = ["  ", "  ", "  ", "  ️", "  "];
    sorted.slice(0, 5).forEach(([uid, data], idx) => { msg += `${medals[idx] || "  "} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`; });
    try { await leaderboardChannel.send({ content: msg }); } catch (e) { console.error("!checkin-test send error:", e); }

    for (const uid in fitnessWeekly) fitnessWeekly[uid] = { yes: 0, no: 0 };
    saveWeekly();

    message.reply("Check-in test completed: weekly snapshot posted to #leaderboard and weekly data reset.");
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

  ,
  async birthday(message, args) {
    // Usage:
    //  !birthday set YYYY-MM-DD  -> sets your birthday
    //  !birthday me               -> shows your saved birthday
    //  !birthday list             -> (admins) list upcoming birthdays
    const sub = (args[0] || '').toLowerCase();
    const authorId = message.author.id;

    if (sub === 'set') {
      const date = args[1];
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return message.reply('Usage: `!birthday set YYYY-MM-DD`');
      birthdays[authorId] = date;
      try { saveBirthdays(); } catch(e){}
      return message.reply(`Saved your birthday as ${date}`);
    }

    if (sub === 'me' || !sub) {
      const d = birthdays[authorId];
      if (!d) return message.reply('You have not set a birthday. Use `!birthday set YYYY-MM-DD`.');
      return message.reply(`Your birthday is ${d}`);
    }

    if (sub === 'list') {
      // Admin only
      const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
      const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
      const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
      if (!isAdmin && !isOwner) return message.reply('You must be an Administrator to list birthdays.');

      const entries = Object.entries(birthdays || {});
      if (!entries.length) return message.reply('No birthdays recorded.');
      // Simple list of user mentions and dates
      const lines = entries.map(([uid, d]) => `<@${uid}> — ${d}`);
      // split into multiple messages if necessary
      for (let i = 0; i < lines.length; i += 50) {
        await message.channel.send(lines.slice(i, i+50).join('\n'));
      }
      return;
    }

    return message.reply('Usage: `!birthday set YYYY-MM-DD` | `!birthday me` | `!birthday list` (admin)');
  }

  ,
  async strike(message, args) {
    // Moderator command to issue a strike to a user in a partner channel
    // Usage: !strike @user [reason...]
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    if (!isModeratorMember(member) && !(process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID)) {
      return message.reply('You must be a moderator to run this command.');
    }

    const mention = message.mentions.users.first() || null;
    const targetId = mention ? mention.id : (args[0] || '').replace(/[<@!>]/g,'');
    if (!targetId) return message.reply('Usage: `!strike @user [reason]`');
    const reason = args.slice(1).join(' ') || 'violation';

    try {
      await applyStrike(message.channel.id, targetId, reason);
      return message.reply(`Issued strike to <@${targetId}> for: ${reason}`);
    } catch (e) {
      console.error('strike command error', e);
      return message.reply('Failed to apply strike.');
    }
  }

  ,
  async challenge(message, args) {
    // Subcommands: create <name> [days], join <id>, list, complete <id>
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'create') {
      const name = args[1];
      if (!name) return message.reply('Usage: `!challenge create <name> [days]`');
      const days = parseInt(args[2]) || 7;
      const id = `c_${Date.now().toString(36)}`;
  challenges[id] = { id, name, creator: message.author.id, members: [message.author.id], createdAt: Date.now(), days: days, completed: false };
  try { saveChallenges(); } catch(e){}
  return message.reply('Created challenge **' + name + '** with id `' + id + '` (duration ' + days + ' days). Others can join with `!challenge join ' + id + '`');
    }

    if (sub === 'join') {
      const id = args[1];
      if (!id || !challenges[id]) return message.reply('Usage: `!challenge join <id>` — unknown challenge id');
      if (!challenges[id].members.includes(message.author.id)) challenges[id].members.push(message.author.id);
      try { saveChallenges(); } catch(e){}
      return message.reply(`Joined challenge **${challenges[id].name}** (id: ${id}).`);
    }

    if (sub === 'list' || !sub) {
      const entries = Object.values(challenges || {}).filter(c => !c.completed);
      if (!entries.length) return message.reply('No active challenges. Create one with `!challenge create <name> [days]`');
      const lines = entries.map(c => `${c.id} — **${c.name}** — ${c.members.length} members — created by <@${c.creator}>`);
      for (let i = 0; i < lines.length; i += 50) {
        await message.channel.send(lines.slice(i, i+50).join('\n'));
      }
      return;
    }

    if (sub === 'complete') {
      const id = args[1];
      if (!id || !challenges[id]) return message.reply('Usage: `!challenge complete <id>`');
      const ch = challenges[id];
      if (ch.creator !== message.author.id && !isModeratorMember(await message.guild.members.fetch(message.author.id).catch(()=>null))) return message.reply('Only the creator or a moderator can complete a challenge.');
      ch.completed = true; ch.completedAt = Date.now();
      try { saveChallenges(); } catch(e){}
      return message.reply(`Marked challenge **${ch.name}** (${id}) as complete.`);
    }

    return message.reply('Usage: `!challenge create <name> [days]` | `!challenge join <id>` | `!challenge list` | `!challenge complete <id>`');
  }
};

// Build a normalized map (lowercased keys) so prefix commands and slash interactions
// find handlers regardless of original casing (some handlers use camelCase names).
const normalizedCommandHandlers = {};
Object.keys(commandHandlers).forEach(k => {
  normalizedCommandHandlers[k.toLowerCase()] = commandHandlers[k];
});

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

  // Strict detection: Partner contact outside private partner channel (immediate ban)
  try {
    // find any partner channel that includes this user
    const partnerEntry = Object.entries(partners).find(([chanId, meta]) => meta.users && meta.users.includes(message.author.id));
    if (partnerEntry) {
      const [partnerChanId, meta] = partnerEntry;
      const otherUserId = meta.users.find(u => u !== message.author.id);
      if (otherUserId && message.channel.id !== partnerChanId) {
        const mentionsPartner = message.mentions.users?.has ? message.mentions.users.has(otherUserId) : (message.mentions.users && message.mentions.users.find && !!message.mentions.users.find(u=>u.id===otherUserId));
        const containsPartnerId = otherUserId && message.content && message.content.includes(otherUserId);
        if (mentionsPartner || containsPartnerId) {
          try { await message.delete().catch(()=>{}); } catch(e){}
          // apply immediate ban via advanced handler
          await applyStrikeAdvanced({ guild: message.guild, userId: message.author.id, issuerId: client.user.id, reason: `Contacted partner <@${otherUserId}> outside private channel`, channel: message.channel, immediateBan: true });
          return;
        }
      }
    }
  } catch (e) { console.error('outside partner check error:', e); }

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

  // Allow plain "yes"/"no" replies in daily-check-ins channel to count as responses
  try {
    const lc = message.channel.name?.toLowerCase() || '';
    const body = (message.content || '').trim().toLowerCase();
    if (lc.includes('daily') && ['yes', 'y', 'no', 'n'].includes(body)) {
      const uid = message.author.id;
      if (pendingCheckins[uid]) {
        // treat as if they used !track
        fitnessWeekly[uid] = fitnessWeekly[uid] || { yes: 0, no: 0 };
        if (['yes', 'y'].includes(body)) {
          fitnessWeekly[uid].yes = (fitnessWeekly[uid].yes || 0) + 1;
          try { await message.react('\u{1F4AA}'); } catch(e){}
          await sendNormalized(message.channel, "Beast mode activated! 🔥");
        } else {
          fitnessWeekly[uid].no = (fitnessWeekly[uid].no || 0) + 1;
          try { await message.react('\u274C'); } catch(e){}
          await sendNormalized(message.channel, "Tomorrow is a new day! 💯");
        }
        delete pendingCheckins[uid];
        saveWeekly();
      }
    }
  } catch (e) { console.error('checkin plain reply handler err', e); }

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

    const handler = normalizedCommandHandlers[command];
    if (handler) {
      try {
        await handler(message, args);
      } catch (e) {
        console.error(`Error in command ${command}:`, e);
        message.reply("Something went wrong. Try again later.");
      }
    }
  }
});

// ---------------- Daily Check-ins ----------------
// Consolidated check-in reminder and mute-check logic (previously duplicated)
async function sendCheckInReminder() {
  try {
    const CHECKIN_PROMPTS = [
      "Quick check: Did you get a workout in today? Reply 'yes' or 'no'",
      "Fitness check: Hit the gym or train today? Reply 'yes' or 'no'",
      "Accountability ping: Did you complete today's workout? Reply 'yes' or 'no'",
      "Short check-in: Any movement today? Reply 'yes' or 'no'",
      "How'd you do today? Workout completed? Reply 'yes' or 'no'",
      "Did you move your body today? Reply 'yes' or 'no'"
    ];

    for (const guild of client.guilds.cache.values()) {
      const channel = guild.channels.cache.find(ch => (ch.name || '').toLowerCase() === 'daily-check-ins');
      if (!channel) continue;

      const prompt = CHECKIN_PROMPTS[Math.floor(Math.random() * CHECKIN_PROMPTS.length)];

      // Build a list of users who haven't logged today (based on fitnessWeekly + memory)
      const unloggedUsers = [];
      const today = new Date().toDateString();
      for (const [userId] of Object.entries(fitnessWeekly || {})) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        if (checkInMutes[userId]) {
          const mute = checkInMutes[userId];
          if (mute.until > Date.now()) continue;
          else delete checkInMutes[userId];
        }

        const lastLog = memory[userId]?.lastLogDate;
        if (lastLog !== today) unloggedUsers.push(userId);
      }

      if (unloggedUsers.length > 0) {
        const mentions = unloggedUsers.map(id => `<@${id}>`).join(' ');
        await sendNormalized(channel, `${prompt}\n\n${mentions}`);
      } else {
        await sendNormalized(channel, prompt);
      }

      // Also send up to 3 randomized, individualized nudges to active members who aren't pending or muted
      const members = await guild.members.fetch().catch(() => null);
      if (!members) continue;
      const candidates = members
        .filter(m => !m.user.bot && !m.user.system && !pendingCheckins[m.user.id] && !checkInMutes[m.user.id])
        .map(m => m.user.id);

      for (let i = 0; i < 3 && candidates.length; i++) {
        const idx = Math.floor(Math.random() * candidates.length);
        const uid = candidates.splice(idx, 1)[0];

        if (!pendingCheckins[uid]) pendingCheckins[uid] = { ts: Date.now(), attempts: 0, lastPromptChannelId: channel.id };
        const p = pendingCheckins[uid];
        if (Date.now() - (p.ts || 0) > 12 * 60 * 60 * 1000) { p.attempts = 0; p.ts = Date.now(); p.lastPromptChannelId = channel.id; }

        p.attempts = (p.attempts || 0) + 1;

        if (p.attempts >= 3) {
          await sendNormalized(channel, `@everyone <@${uid}> — We've tried to reach out several times and haven't gotten a response. Please check in or use \`!mutecheck\` if you need to pause reminders.`);
          p.ts = Date.now(); p.attempts = 999;
        } else {
          await sendNormalized(channel, `@here <@${uid}> — Quick check-in: Did you work out today? Reply in this channel with 'yes' or 'no'.`);
        }
      }
    }
  } catch (error) {
    console.error('sendCheckInReminder error:', error);
  }
}

// Consolidated: handle expired mutes and long-running mutes that require community alert
async function checkMutedUsers() {
  try {
    const now = Date.now();
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

    for (const [uid, rec] of Object.entries(checkInMutes || {})) {
      if (!rec) continue;

      // Expired mute handling
      if (rec.until && rec.until !== Infinity && Date.now() > rec.until) {
        delete checkInMutes[uid]; saveCheckInMutes();
        try { const user = await client.users.fetch(uid).catch(() => null); if (user) user.send('Your check-in mute has expired; prompts will resume.'); } catch (e) {}
        continue;
      }

      // Long-running mute alert
      if (rec.startedAt && now - rec.startedAt > twoWeeksMs) {
        for (const guild of client.guilds.cache.values()) {
          const member = await guild.members.fetch(uid).catch(() => null);
          if (!member) continue;
          const accountabilityChannel = guild.channels.cache.find(ch => ch.name === 'accountability-lounge');
          if (accountabilityChannel) {
            await sendNormalized(accountabilityChannel, `**ACCOUNTABILITY ALERT**\n<@${uid}> has muted check-ins for over two weeks! They might need some motivation and support from the community. Let's check in on them!`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking muted users:', error);
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
        await sendNormalized(healthChannel, `≡ƒî┐ **HEALTH INSIGHT** ≡ƒî┐\n\n${content}`);
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
    
    const prompt = `You are a wealth-building expert who shares insider financial knowledge that banks and financial institutions don't advertise. Write a concise, practical tip (max 250 words) about ${randomTopic}. Focus on actionable advice for men in their 20s-30s. Format with a clear headline and bullet points for key takeaways.`;
    
    const content = await getOpenAIResponse(prompt);
    
    for (const guild of client.guilds.cache.values()) {
      const wealthChannel = guild.channels.cache.find(ch => ch.name === 'wealth');
      if (wealthChannel) {
        await sendNormalized(wealthChannel, `≡ƒÆ░ **WEALTH BUILDER TIP** ≡ƒÆ░\n\n${content}`);
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
    
    const message = `≡ƒÆ¬ **FITNESS FOCUS: ${randomTopic.toUpperCase()}** ≡ƒÆ¬\n\n${fitnessTips}\n\n≡ƒô║ **RECOMMENDED WATCH:**\n${videoRecommendation}`;
    
    for (const guild of client.guilds.cache.values()) {
      const fitnessChannel = guild.channels.cache.find(ch => ch.name === 'fitness');
      if (fitnessChannel) {
        await sendNormalized(fitnessChannel, message);
      }
    }
  } catch (error) {
    console.error("Error posting fitness content:", error);
  }
}

// ---------------- Birthday announcer (daily at 08:30) ----------------
async function announceBirthdays() {
  try {
    const todayMMDD = new Date().toISOString().slice(5,10); // "MM-DD"
    for (const guild of client.guilds.cache.values()) {
      // prefer guild-configured birthday channel, fallback to 'general'
      const cfg = (guildConfigs && guildConfigs[guild.id]) ? guildConfigs[guild.id] : {};
      const chanName = cfg.birthdayChannel || 'general';
      const ch = guild.channels.cache.find(c => c.name === chanName) || guild.channels.cache.find(c => c.name === 'general');
      if (!ch) continue;

      const birthdayUsers = Object.entries(birthdays || {}).filter(([uid, iso]) => {
        if (!iso) return false;
        try { return iso.slice(5,10) === todayMMDD; } catch(e){ return false; }
      }).map(([uid]) => uid);

      if (birthdayUsers.length === 0) continue;

      const mentions = birthdayUsers.map(id => `<@${id}>`).join(' ');
      await sendNormalized(ch, `🎉 Happy Birthday ${mentions} — wish them a great year ahead! 🎂`);
    }
  } catch (e) { console.error('announceBirthdays error:', e); }
}

// Ensure pinned docs are present once per day at 03:00
cron.schedule('0 3 * * *', async () => {
  try {
    for (const guild of client.guilds.cache.values()) {
      try { await pinCommandDocs(guild); } catch(e){}
    }
  } catch(e){ console.error('daily pin job error:', e); }
});

// ---------------- Daily motivation (9 AM) ----------------
cron.schedule('0 9 * * *', async () => {
  try {
    const quotes = [
      "≡ƒÆ¬ Rise and grind! Today's your day to be better than yesterday.",
      "≡ƒöÑ The only bad workout is the one that didn't happen. Make it count!",
      "ΓÜí Your body can stand almost anything. It's your mind you have to convince.",
      "≡ƒÅå Success isn't given. It's earned in the gym and through discipline."
    ];
    
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    
    for (const guild of client.guilds.cache.values()) {
      const generalChannel = guild.channels.cache.find(ch => 
        ch.name === "general" || ch.name === "main" || ch.name === "chat"
      );
      
      if (generalChannel) {
        await sendNormalized(generalChannel, `**DAILY MOTIVATION**\n${quote}`);
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

  // Post brief public channel guides (health/wealth/fitness/daily-check-ins/general/leaderboard)
  try {
    for (const guild of client.guilds.cache.values()) {
      try { await postChannelGuides(guild); } catch(e){}
    }
  } catch (e) { console.error('postChannelGuides error', e); }
  
  // --- Slash command registration: create a simple slash command per prefix command ---
  try {
    // create unique, lowercased slash command names from normalized handlers
    const uniqueNames = [...new Set(Object.keys(normalizedCommandHandlers).map(n => n.toLowerCase().slice(0,32)))];
    const cmdDefs = uniqueNames.map(name => ({
      name: name,
      description: `Run ${name} (prefix: !${name})`,
      options: [ { name: 'text', type: 3, description: 'Arguments as a single string', required: false } ]
    }));

    if (process.env.SLASH_GUILD_ID) {
      const targetGuild = client.guilds.cache.get(process.env.SLASH_GUILD_ID);
      if (targetGuild) await targetGuild.commands.set(cmdDefs);
    } else if (client.application) {
      await client.application.commands.set(cmdDefs);
    }

    console.log(`Registered ${cmdDefs.length} slash commands`);
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
  if (reaction.emoji && reaction.emoji.name === '\u{1F4AA}') {
      // find challenge by message id or channel context
      const chId = msg.channel.id;
      // naive: add user to a challenge list in memory keyed by message id
      if (!challenges[msg.id]) challenges[msg.id] = { name: msg.content?.slice(0,60) || 'challenge', members: [] };
      if (!challenges[msg.id].members.includes(user.id)) {
        challenges[msg.id].members.push(user.id);
        try { await sendNormalized(msg.channel, `<@${user.id}> joined the challenge: ${challenges[msg.id].name}`); } catch(e){}
        // persist if file mapping exists
        if (saveLoadMap.challenges) saveLoadMap.challenges[0]();
      }
    }
  } catch (e) { console.error('reaction handler error:', e); }
});

process.on('unhandledRejection', (err) => { console.error('Unhandled Rejection:', err); });

// ------------------ Graceful Shutdown ------------------
process.on('SIGINT', () => {
  console.log('Received SIGINT. Saving data and shutting down gracefully...');
  try {
    saveMemory(); saveBirthdays(); saveWeekly(); saveMonthly(); savePartnerQueue(); savePartners(); saveStrikes(); saveHabits(); saveChallenges();
  } catch (e) { console.error('Error during SIGINT save:', e); }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Saving data and shutting down gracefully...');
  try {
    saveMemory(); saveBirthdays(); saveWeekly(); saveMonthly(); savePartnerQueue(); savePartners(); saveStrikes(); saveHabits(); saveChallenges();
  } catch (e) { console.error('Error during SIGTERM save:', e); }
  process.exit(0);
});

// Map slash command interactions to existing prefix handlers
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isCommand?.()) return;
  const name = interaction.commandName;
  const handler = normalizedCommandHandlers[name.toLowerCase()];
  if (!handler) return interaction.reply({ content: 'Command handler not found for: ' + name, ephemeral: true });

    const text = interaction.options.getString('text') || '';
    const args = text.trim() ? text.trim().split(/ +/g) : [];

    // Build a minimal message-like object the handlers expect
    const fakeMessage = {
      author: interaction.user,
      member: interaction.member,
      guild: interaction.guild,
      channel: interaction.channel,
      // reply that supports fetchReply so some handlers can edit the reply
      reply: async (payload) => {
        const content = typeof payload === 'string' ? payload : (payload.content || JSON.stringify(payload));
        if (!interaction.replied && !interaction.deferred) return interaction.reply({ content, fetchReply: true });
        return interaction.followUp({ content });
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
