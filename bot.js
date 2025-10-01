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
import { pathToFileURL } from 'url';
import cron from 'node-cron';
import axios from 'axios';
import { google } from 'googleapis';

dotenv.config();

// EARLY FALLBACKS: ensure common global helpers exist immediately so any
// module imported or executed before full initialization doesn't throw.
if (typeof globalThis.adminLog === 'undefined') globalThis.adminLog = async () => {};
if (typeof globalThis.saveWeekly === 'undefined') globalThis.saveWeekly = async () => {};
if (typeof globalThis.saveMemory === 'undefined') globalThis.saveMemory = async () => {};
if (typeof globalThis.saveHabits === 'undefined') globalThis.saveHabits = async () => {};
if (typeof globalThis.getOpenAIResponse === 'undefined') globalThis.getOpenAIResponse = async () => '';
if (typeof globalThis.validateModel === 'undefined') globalThis.validateModel = async () => ({ ok: false, error: 'no-validate' });

// Early no-op fallbacks for other globals some handlers reference directly
if (typeof globalThis.awardAchievement === 'undefined') globalThis.awardAchievement = async () => false;
if (typeof globalThis.saveAchievements === 'undefined') globalThis.saveAchievements = async () => {};
if (typeof globalThis.saveMessageCounts === 'undefined') globalThis.saveMessageCounts = async () => {};
if (typeof globalThis.startOnboarding === 'undefined') globalThis.startOnboarding = async () => {};
if (typeof globalThis.storage === 'undefined') globalThis.storage = null;

// Provide a safe global adminLog fallback so modules that reference it
// via the global scope won't crash during dynamic loading or execution.
if (typeof globalThis.adminLog === 'undefined') globalThis.adminLog = async () => {};

// Hoisted no-op adminLog declaration to ensure the identifier exists in the
// module scope and avoid ReferenceError if some code calls `adminLog(...)`
// before the richer implementation is defined later in this file.
function adminLog(guild, text) { return Promise.resolve(); }
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
// Express application instance
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

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
// Persistent collections used across the bot lifecycle
let challenges = {}, onboarding = {}, matches = {}, leaderboardPotential = {};
let checkInMutes = {}, healthPosts = [], wealthTips = [], fitnessPosts = [];
let aiHealth = [];
let commandDocsPins = [];
let lastHealthAlert = {};
// New: message counts and achievements store
let messageCounts = {};
let achievementsStore = {}; // { userId: [achId,...] } - persisted under 'achievements'
let leaderRoles = {}; // { guildId: roleId }
let currentChampion = {}; // { guildId: userId }
let modulesMeta = []; // collected module metadata for slash sync
// Map of sanitized slash subcommand name -> handler name (persisted)
let slashNameMap = {};

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
  slashNameMap = await storage.load('slashNameMap', {});
  wealthTips = await storage.load('wealthTips', []);
  fitnessPosts = await storage.load('fitnessPosts', []);
  aiHealth = await storage.load('ai_health', []);
  lastHealthAlert = await storage.load('lastHealthAlert', {});
  messageCounts = await storage.load('messageCounts', {});
  achievementsStore = await storage.load('achievements', {});
  leaderRoles = await storage.load('leaderRoles', {});
  currentChampion = await storage.load('currentChampion', {});
  console.log('All data loaded (storage)');
  await normalizeLoadedData();
}

// Ensure we coerce certain loaded shapes to expected types (robust against file format drift)
async function normalizeLoadedData() {
  if (!Array.isArray(partnerQueue)) partnerQueue = [];
  if (!Array.isArray(healthPosts)) healthPosts = [];
  if (!Array.isArray(wealthTips)) wealthTips = [];
  if (!Array.isArray(fitnessPosts)) fitnessPosts = [];
  if (!messageCounts || typeof messageCounts !== 'object') messageCounts = {};
  if (!achievementsStore || typeof achievementsStore !== 'object') achievementsStore = {};
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
const saveSlashNameMap = async () => storage.save('slashNameMap', slashNameMap);

// Shorthand async save functions
const saveMemory = async () => storage.save('memory', memory);
const saveWeekly = async () => {
  await storage.save('weekly', fitnessWeekly);
  // trigger live leaderboard updates when weekly data changes
  try { await updateLeaderboardChannel(); } catch (e) { console.error('saveWeekly -> updateLeaderboardChannel failed', e); }
};
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
const saveMessageCounts = async () => storage.save('messageCounts', messageCounts);
const saveAchievements = async () => storage.save('achievements', achievementsStore);
const saveLeaderRoles = async () => storage.save('leaderRoles', leaderRoles);
const saveCurrentChampion = async () => storage.save('currentChampion', currentChampion);
// ... other saves


// ----- Additional explicit file handles and helpers requested -----
// Provide the file path constants the user referenced and small save/load helpers
// Backwards-compatible plain-file mapping (some older code paths expect these)
const files = {
  birthdays: path.join(process.cwd(), 'birthdays.json'),
  monthly: path.join(process.cwd(), 'fitnessmonthly.json'),
  partners: path.join(process.cwd(), 'partners.json'),
  partnerQueue: path.join(process.cwd(), 'partnerQueue.json'),
  strikes: path.join(process.cwd(), 'strikes.json'),
  challenges: path.join(process.cwd(), 'challenges.json')
};

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

// Start Express but be resilient to EADDRINUSE by trying the next few ports.
async function startExpressServer(preferredPort = PORT, attempts = 5) {
  let port = preferredPort;
  for (let i = 0; i < attempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
          console.log(`Express server running on port ${port}`);
          resolve(server);
        });
        server.on('error', (err) => reject(err));
      });
      return port;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Port ${port} in use, trying ${port + 1}...`);
        port += 1;
        continue;
      }
      console.error('Failed to start Express server:', err);
      break;
    }
  }
  throw new Error(`Unable to start Express server after ${attempts} attempts (starting at ${preferredPort})`);
}

// Start now (fire-and-forget; errors will be logged)
startExpressServer().catch(e => console.error(e));

// Lightweight debug endpoint to inspect runtime command mapping
app.get('/debug', (req, res) => {
  try {
    const handlers = Object.keys(commandHandlers || {}).slice(0,500);
    return res.json({ ok: true, modulesMeta: modulesMeta || [], handlers, slashNameMap: slashNameMap || {} });
  } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
});

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
    if (storage && storage.mongoDb) {
      entries = await storage.mongoDb.collection('ai_health').find().sort({ ts: -1 }).limit(n).toArray();
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
async function getOpenAIResponse(prompt) {
  try {
    const completion = await openai.chat.completions.create({ model: OPENAI_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.7 });
    return completion?.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    console.error('OpenAI error (primary model):', e?.message || e);
    // Try fallback model once
    if (OPENAI_MODEL && FALLBACK_OPENAI_MODEL && OPENAI_MODEL !== FALLBACK_OPENAI_MODEL) {
      try {
        console.log(`[OpenAI] Attempting fallback model: ${FALLBACK_OPENAI_MODEL}`);
        const completion = await openai.chat.completions.create({ model: FALLBACK_OPENAI_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.7 });
        return completion?.choices?.[0]?.message?.content?.trim() || '';
      } catch (err2) {
        console.error('OpenAI error (fallback):', err2?.message || err2);
      }
    }
    return "I can't respond right now.";
  }
}

// Telemetry entry helper
function recordAiHealthEvent(event) {
  try {
    aiHealth.push(Object.assign({ ts: Date.now() }, event));
    // cap to last 500 entries
    if (aiHealth.length > 500) aiHealth = aiHealth.slice(-500);
    saveAiHealth();
    // also write to Mongo if available
    if (storage && storage.mongoDb) {
      try { storage.mongoDb.collection('ai_health').insertOne(Object.assign({ ts: new Date() }, event)); } catch(e){console.error('mongo write failed',e);}
    }
  } catch (e) { console.error('recordAiHealthEvent error:', e); }
}

// Achievements metadata
const ACHIEVEMENTS = {
  hydrated: { id: 'hydrated', name: 'Hydrated', desc: 'Checked in 7 days in a row' },
  beast_mode: { id: 'beast_mode', name: 'Beast Mode', desc: 'Sent 1,000 messages' },
  night_lifter: { id: 'night_lifter', name: 'Night Lifter', desc: 'Active after 2AM' },
  iron_champion: { id: 'iron_champion', name: 'Iron Champion', desc: 'Rank #1 on the leaderboard' }
};

// Award an achievement to a user (idempotent)
async function awardAchievement(guild, userId, achId) {
  try {
    achievementsStore[userId] = achievementsStore[userId] || [];
    if (achievementsStore[userId].includes(achId)) return false;
    achievementsStore[userId].push(achId);
    await saveAchievements();
    // notify the user in DMs when possible, or post in guild if provided
    try {
      const user = await client.users.fetch(userId).catch(()=>null);
      const meta = ACHIEVEMENTS[achId] || { id:achId, name:achId };
      const text = `🏆 Achievement unlocked: **${meta.name}** — ${meta.desc || ''}`;
      if (user) {
        await user.send(text).catch(()=>{});
      }
      if (guild) {
        try { const ch = guild.systemChannel || guild.channels.cache.find(c=> (c.name||'').toLowerCase().includes('general')); if(ch) ch.send(`${user ? `<@${userId}>` : ''} unlocked **${meta.name}**`).catch(()=>{}); } catch(e){}
      }
    } catch (e) { console.error('notify achievement failed', e); }
    return true;
  } catch (e) { console.error('awardAchievement error', e); return false; }
}

// Expose commonly-used helpers and state on globalThis to maintain
// backwards-compatibility for modules that reference these as globals.
try {
  globalThis.adminLog = globalThis.adminLog || adminLog;
  globalThis.awardAchievement = globalThis.awardAchievement || awardAchievement;
  globalThis.saveWeekly = globalThis.saveWeekly || saveWeekly;
  globalThis.saveMemory = globalThis.saveMemory || saveMemory;
  globalThis.saveHabits = globalThis.saveHabits || saveHabits;
  globalThis.savePartnerQueue = globalThis.savePartnerQueue || savePartnerQueue;
  globalThis.savePartners = globalThis.savePartners || savePartners;
  globalThis.saveMatches = globalThis.saveMatches || saveMatches;
  globalThis.saveStrikes = globalThis.saveStrikes || saveStrikes;
  globalThis.saveChallenges = globalThis.saveChallenges || saveChallenges;
  globalThis.saveMonthly = globalThis.saveMonthly || saveMonthly;
  globalThis.saveMessageCounts = globalThis.saveMessageCounts || saveMessageCounts;
  globalThis.saveAchievements = globalThis.saveAchievements || saveAchievements;
  globalThis.startOnboarding = globalThis.startOnboarding || startOnboarding;
  globalThis.getOpenAIResponse = globalThis.getOpenAIResponse || getOpenAIResponse;
  globalThis.validateModel = globalThis.validateModel || validateModel;
  globalThis.storage = globalThis.storage || storage;
  globalThis.habitTracker = globalThis.habitTracker || habitTracker;
  globalThis.fitnessWeekly = globalThis.fitnessWeekly || fitnessWeekly;
  globalThis.partnerQueue = globalThis.partnerQueue || partnerQueue;
  globalThis.matches = globalThis.matches || matches;
  globalThis.onboarding = globalThis.onboarding || onboarding;
  globalThis.messageCounts = globalThis.messageCounts || messageCounts;
} catch (e) { console.error('Failed to expose globals for compatibility', e); }

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

// ---------------- Matching ----------------
function tryAutoMatch(){
  // ensure partnerQueue is an array (robustness against bad saved shapes)
  if(!Array.isArray(partnerQueue)) partnerQueue = [];
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
  try {
    const everyoneRole = guild.roles.everyone.id;
    const perms = [
      { id: everyoneRole, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userAId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: userBId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];

    // include admin/mod/owner roles if present
    const adminRole = guild.roles.cache.find(r => (r.name||'').toLowerCase() === 'admin');
    const modRole = guild.roles.cache.find(r => (r.name||'').toLowerCase() === 'moderator');
    const ownerRole = guild.roles.cache.find(r => (r.name||'').toLowerCase() === 'owner');
    [adminRole, modRole, ownerRole].forEach(role => {
      if (role) perms.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] });
    });

    const channelName = `partner-${userAId.slice(0, 4)}-${userBId.slice(0, 4)}`;
    const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, permissionOverwrites: perms, reason: 'Create partner private channel' });

    // Initialize partner record and save
    partners[channel.id] = { channelId: channel.id, guildId: guild.id, userA: userAId, userB: userBId, type: pairType || 'goal', createdAt: Date.now(), exposure: { [userAId]: { messagesExchanged: 0, firstInteraction: null }, [userBId]: { messagesExchanged: 0, firstInteraction: null } } };
    matches[userAId] = channel.id; matches[userBId] = channel.id;
    strikes[channel.id] = { [userAId]: 0, [userBId]: 0 };
    savePartners(); if (saveMatches) saveMatches(); if (saveStrikes) saveStrikes();

    // Post initial pinned rules like the other implementation
    try { await postInitialPinnedRules(channel, partners[channel.id]); } catch(e){console.error('postInitialPinnedRules',e)}

    return channel;
  } catch (e) { console.error('createPrivateChannelForPair error:', e); return null; }
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

  try {
    const guild = channel.guild;
    await ensurePinnedMessage(guild, channel, 'Welcome to your private partner channel', rules, 'partner_rules');
    const checkin = `Check-in template:\n• How was your workout today?\n• Any blockers?\n• Plan for tomorrow:`;
    await ensurePinnedMessage(guild, channel, 'Check-in template:', checkin, 'partner_checkin');
  } catch (e) {
    console.error('postInitialPinnedRules ensurePinnedMessage failed', e);
    // fallback to direct send/pin attempt
    try {
      const pinnedRules = await channel.send({ content: rules });
      await pinnedRules.pin();
      const checkinTemplate = await channel.send(`Check-in template:\n• How was your workout today?\n• Any blockers?\n• Plan for tomorrow:`);
      await checkinTemplate.pin();
    } catch (err) { console.error('fallback pin failed', err); }
  }
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

// Update the leaderboard channels across all guilds with a simple snapshot and award Iron Champion
async function updateLeaderboardChannel() {
  try {
    for (const guild of client.guilds.cache.values()) {
      try {
        const channel = guild.channels.cache.find(ch => (ch.name||'').toLowerCase() === 'leaderboard' && ch.type === ChannelType.GuildText);
        if (!channel) continue;

        // Consider all fitnessWeekly entries, but prefer users who are members of this guild.
        const allEntries = Object.entries(fitnessWeekly);
        // sort globally, then we'll filter/fetch top members for this guild
        const globalSorted = allEntries.sort((a,b)=> (b[1].yes||0) - (a[1].yes||0));

        // We'll try to produce a per-guild sorted list of up to 10 users who are guild members.
        const perGuild = [];
        for (const [uid, data] of globalSorted) {
          if (perGuild.length >= 10) break;
          // if member cached, accept immediately
          if (guild.members.cache.has(uid)) { perGuild.push([uid, data]); continue; }
          // try to fetch member from API (best-effort, don't throw)
          try {
            const fetched = await guild.members.fetch(uid).catch(()=>null);
            if (fetched) { perGuild.push([uid, data]); continue; }
          } catch (e) { /* ignore fetch errors */ }
        }

        const sorted = perGuild;
        if (!sorted.length) { await channel.send('No weekly fitness data yet.'); continue; }

        const medals = ['🥇','🥈','🥉'];
        const embed = new EmbedBuilder()
          .setTitle('🏆 WEEKLY LEADERBOARD')
          .setColor(0xFFD700)
          .setTimestamp(new Date())
          .setDescription('Top performers this week — keep grinding!');

        // attempt to add champion avatar as thumbnail and show avatars for top 3
        try {
          const top3 = sorted.slice(0,3);
          if (top3[0]) {
            const champId = top3[0][0];
            const champUser = await client.users.fetch(champId).catch(()=>null);
            if (champUser) embed.setThumbnail(champUser.displayAvatarURL({ extension: 'png', size: 256 }));
          }
          const topFields = [];
          for (let i=0;i<3;i++) {
            const row = top3[i];
            if (!row) break;
            const uid = row[0]; const data = row[1];
            const user = await client.users.fetch(uid).catch(()=>null);
            const name = user ? `${user.username}` : `<@${uid}>`;
            topFields.push({ name: `${medals[i]||'🔹'} ${name}`, value: `**${data.yes||0}** workouts`, inline: true });
          }
          if (topFields.length) embed.addFields(...topFields);
        } catch (e) { /* ignore avatar fetching errors */ }

        let description = '';
        sorted.slice(0,10).forEach(([uid,data],i)=>{
          description += `${medals[i]||'🔹'} <@${uid}> — **${data.yes||0}** workouts\n`;
        });
        embed.addFields({ name: 'Top 10', value: description || 'No data', inline: false });

        // Try to update existing pinned leaderboard message in channel, otherwise send new and pin
        let existingMsg = null;
        try {
          const pins = await channel.messages.fetchPins();
          existingMsg = pins.find(m => m.author?.id === client.user.id && m.embeds?.[0]?.title && (m.embeds[0].title||'').toLowerCase().includes('leaderboard')) || null;
        } catch (e) { existingMsg = null; }

        let sent = null;
        if (existingMsg) {
          try { await existingMsg.edit({ embeds: [embed] }); sent = existingMsg; } catch(e){ sent = null; }
        }
        if (!sent) {
          try { sent = await channel.send({ embeds: [embed] }); try { await sent.pin(); } catch(e){} } catch(e){ console.error('send leaderboard failed', e); }
        }

        // Award the Iron Champion achievement to the top user (idempotent)
        try {
                const topUid = sorted[0] && sorted[0][0];
                if (topUid) {
                  await (globalThis.awardAchievement ? globalThis.awardAchievement(guild, topUid, ACHIEVEMENTS.iron_champion.id) : awardAchievement(guild, topUid, ACHIEVEMENTS.iron_champion.id)).catch(()=>{});
                  // assign leader role if configured
                  try { await assignLeaderRole(guild, topUid); } catch (e) { console.error('assignLeaderRole failed', e); }
                }
              } catch (e) { console.error('award iron champion failed', e); }
      } catch (e) { console.error('updateLeaderboardChannel per-guild error:', e); }
    }
  } catch (e) { console.error('updateLeaderboardChannel error:', e); }
}

// Assign the configured leader role to a user in the guild and revoke from previous champion
async function assignLeaderRole(guild, userId) {
  try {
    const roleId = leaderRoles[guild.id];
    if (!roleId) return; // nothing configured

    const prev = currentChampion[guild.id];
    if (prev === userId) return; // already the champion

    // Revoke role from previous champion
    if (prev) {
      try {
        const prevMember = await guild.members.fetch(prev).catch(()=>null);
        if (prevMember) {
          const role = guild.roles.cache.get(roleId);
          if (role && guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await prevMember.roles.remove(role).catch(()=>{});
          }
        }
      } catch(e){ console.error('revoke prev champion role failed', e); }
    }

    // Grant role to new champion
    try {
      const member = await guild.members.fetch(userId).catch(()=>null);
      if (member) {
        const role = guild.roles.cache.get(roleId);
        if (role && guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await member.roles.add(role).catch(()=>{});
        }
      }
    } catch(e){ console.error('assign champion role failed', e); }

    currentChampion[guild.id] = userId;
    await saveCurrentChampion();
  } catch (e) { console.error('assignLeaderRole error', e); }
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
  try { globalThis.adminLog(message.guild, `User <@${message.author.id}> set model -> ${model} ${saveFlag ? '(saved to .env)' : ''}`); } catch(e){}

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
  try { globalThis.adminLog(message.guild, `User <@${message.author.id}> set fallback model -> ${model} ${saveFlag ? '(saved to .env)' : ''}`); } catch(e){}

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
    if (storage && storage.mongoDb) {
      try {
        entries = await storage.mongoDb.collection('ai_health').find().sort({ ts: -1 }).limit(n).toArray();
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
  try { globalThis.adminLog(message.guild, `AI health check failed by <@${message.author.id}>: ${res.error}`); } catch(e){}
      return reply.edit(`AI check failed: ${res.error}`);
    }

    recordAiHealthEvent({ type: 'testai', user: message.author.id, model: OPENAI_MODEL, ok: true, latency: res.duration, sample: res.sample });
  try { globalThis.adminLog(message.guild, `AI health check OK by <@${message.author.id}>: model ${OPENAI_MODEL} ${res.duration}ms`); } catch(e){}
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
  { name: 'admin', description: 'Admin utilities', subcommands: ['setmodel','getmodel','setfallback','getaihealth','testai','registerslashes','pindocs','listcommands','setleaderrole','clearleaderrole'] }
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

  // Admin: set leader role for champion assignment
  async setleaderrole(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    // Support slash: message.slashOptions.role (Role object), or prefix mention as args[0]
    let role = null;
    if (message.slashOptions && message.slashOptions.role) {
      role = message.slashOptions.role;
    } else {
      const roleMention = args[0];
      if (!roleMention) return message.reply('Usage: `!setleaderrole @Role`');
      const roleId = roleMention.replace(/[^0-9]/g, '');
      role = message.guild.roles.cache.get(roleId);
    }
    if (!role) return message.reply('Role not found in this server.');

    leaderRoles[message.guild.id] = role.id;
    await saveLeaderRoles();
    return message.reply(`Leader role set to ${role.name}`);
  },

  async clearleaderrole(message) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    if (leaderRoles[message.guild.id]) {
      delete leaderRoles[message.guild.id];
      await saveLeaderRoles();
      return message.reply('Leader role cleared for this server.');
    }
    return message.reply('No leader role configured for this server.');
  },

  // Admin: force leaderboard update now
  async forceleaderboard(message) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    try { await updateLeaderboardChannel(); return message.reply('Leaderboard update triggered.'); } catch (e) { console.error('forceleaderboard failed', e); return message.reply('Failed to trigger leaderboard.'); }
  },

  // Admin: force assign champion manually
  async forcechampion(message, args) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const roleMention = args[0] || '';
    const targetId = (roleMention.match(/\d{17,20}/) || [])[0] || null;
    if (!targetId) return message.reply('Usage: `!forcechampion @User`');
  try { const guild = message.guild; await (globalThis.awardAchievement ? globalThis.awardAchievement(guild, targetId, ACHIEVEMENTS.iron_champion.id) : awardAchievement(guild, targetId, ACHIEVEMENTS.iron_champion.id)); await assignLeaderRole(guild, targetId); return message.reply('Forced champion assignment complete.'); } catch (e) { console.error('forcechampion failed', e); return message.reply('Failed to force champion.'); }
  },

  // Admin: force pin admin & logging docs
  async pindocs(message) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    await pinCommandDocs(message.guild);
    return message.reply('Pinned admin/logging docs (if channels found).');
  },

  // Admin: list commands and channel locks
  async listcommands(message) {
    const member = message.guild ? await message.guild.members.fetch(message.author.id).catch(()=>null) : null;
    const isAdmin = member ? member.permissions.has(PermissionFlagsBits.Administrator) : false;
    const isOwner = process.env.BOT_OWNER_ID && message.author.id === process.env.BOT_OWNER_ID;
    if (!isAdmin && !isOwner) return message.reply('You must be a server Administrator or the bot owner to run this command.');

    const lines = Object.keys(commandHandlers).map(n => `• ${n} — ${commandChannelLock[n] || 'any'}`).sort();
    const embed = new EmbedBuilder().setTitle('Commands & Channel Locks').setDescription(lines.join('\n')).setColor(0x3498DB);
    return message.reply({ embeds: [embed] });
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
    modulesMeta = [];
    const dir = path.join(process.cwd(), 'src', 'commands');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    const groups = {};
    for (const f of files) {
      try {
        const modPath = path.join(dir, f);
        const modUrl = pathToFileURL(modPath).href;
        const imported = await import(modUrl);
          const def = imported.default;
          if (def && def.name && typeof def.execute === 'function') {
          // wrap module's execute to match existing handler signature
          const wrapped = async (message, args) => {
            try {
              // debug: show module execution entry and adminLog availability (use globalThis to avoid ReferenceError)
              try { console.log(`Module handler starting: ${def.name} (typeof globalThis.adminLog=${typeof globalThis.adminLog})`); } catch(e){}
              // adminLog may not always be available at module load time due to edit/hoisting
              // protect command execution by providing a no-op fallback. Use globalThis to avoid accidental ReferenceError.
              const adminLogSafe = (typeof globalThis.adminLog === 'function') ? globalThis.adminLog : async () => {};
              const context = {
              client,
              EmbedBuilder,
              PermissionFlagsBits,
              ChannelType,
              getOpenAIResponse: (typeof globalThis.getOpenAIResponse === 'function') ? globalThis.getOpenAIResponse : async () => '',
              validateModel: (typeof globalThis.validateModel === 'function') ? globalThis.validateModel : async () => ({ ok: false, error: 'validateModel unavailable' }),
              adminLog: (typeof globalThis.adminLog === 'function') ? globalThis.adminLog : adminLogSafe,
              // prefer the local storage instance to avoid races during startup
              storage: (typeof storage !== 'undefined' && storage) ? storage : (typeof globalThis.storage !== 'undefined' ? globalThis.storage : null),
              saveHabits: (typeof globalThis.saveHabits === 'function') ? globalThis.saveHabits : async () => {},
              savePartnerQueue: (typeof globalThis.savePartnerQueue === 'function') ? globalThis.savePartnerQueue : async () => {},
              savePartners: (typeof globalThis.savePartners === 'function') ? globalThis.savePartners : async () => {},
              saveMatches: (typeof globalThis.saveMatches === 'function') ? globalThis.saveMatches : async () => {},
              saveStrikes: (typeof globalThis.saveStrikes === 'function') ? globalThis.saveStrikes : async () => {},
              saveChallenges: (typeof globalThis.saveChallenges === 'function') ? globalThis.saveChallenges : async () => {},
              saveWeekly: (typeof globalThis.saveWeekly === 'function') ? globalThis.saveWeekly : async () => {},
              saveMonthly: (typeof globalThis.saveMonthly === 'function') ? globalThis.saveMonthly : async () => {},
              saveMemory: (typeof globalThis.saveMemory === 'function') ? globalThis.saveMemory : async () => {},
              habitTracker: (typeof globalThis.habitTracker !== 'undefined') ? globalThis.habitTracker : {},
              fitnessWeekly: (typeof globalThis.fitnessWeekly !== 'undefined') ? globalThis.fitnessWeekly : {},
              partnerQueue: (typeof globalThis.partnerQueue !== 'undefined') ? globalThis.partnerQueue : [],
              matches: (typeof globalThis.matches !== 'undefined') ? globalThis.matches : {},
              onboarding: (typeof globalThis.onboarding !== 'undefined') ? globalThis.onboarding : {},
              startOnboarding: (typeof globalThis.startOnboarding === 'function') ? globalThis.startOnboarding : async () => {},
              // achievements & message counters
              awardAchievement: (typeof globalThis.awardAchievement === 'function') ? globalThis.awardAchievement : async () => false,
              messageCounts: (typeof globalThis.messageCounts !== 'undefined') ? globalThis.messageCounts : {},
              achievementsStore: (typeof globalThis.achievementsStore !== 'undefined') ? globalThis.achievementsStore : {},
              saveAchievements: (typeof globalThis.saveAchievements === 'function') ? globalThis.saveAchievements : async () => {},
              saveMessageCounts: (typeof globalThis.saveMessageCounts === 'function') ? globalThis.saveMessageCounts : async () => {}
            };
              try {
                // Dump the handler source for debugging (trim to reasonable size)
                try { console.log(`Executing handler ${def.name} source (first 2000 chars):\n${def.execute ? def.execute.toString().slice(0,2000) : '[no-source]'}`); } catch(e){}
                // Temporarily expose common helpers on globalThis so handlers that reference
                // bare globals (legacy code) don't throw ReferenceError. We'll restore
                // previous values afterwards to avoid leaking state between handlers.
                const _prevGlobals = {};
                const toBind = ['adminLog','awardAchievement','saveWeekly','saveMemory','saveHabits','saveMessageCounts','saveAchievements','startOnboarding','getOpenAIResponse','validateModel','storage'];
                try {
                  for (const k of toBind) { _prevGlobals[k] = globalThis[k]; if (typeof context[k] !== 'undefined') globalThis[k] = context[k]; }
                  await def.execute(context, message, args);
                } finally {
                  try { for (const k of toBind) { if (typeof _prevGlobals[k] === 'undefined') delete globalThis[k]; else globalThis[k] = _prevGlobals[k]; } } catch(e){}
                }
              } catch (err) {
                // If it's a ReferenceError, include the missing identifier and handler source
                try {
                  console.error(`Error in module ${def.name} execute:`, err);

                  // Build a structured dump to persist synchronously so it survives process termination
                  try {
                    const dump = {
                      time: new Date().toISOString(),
                      handler: def.name,
                      messageSummary: message && message.author ? { author: message.author.id, channel: message.channel?.id } : null,
                      error: err && err.stack ? err.stack : String(err),
                      handlerSource: (def.execute && def.execute.toString && def.execute.toString().slice(0,10000)) || null
                    };
                    try {
                      fs.appendFileSync(path.join(process.cwd(),'debug-handler-errors.log'), JSON.stringify(dump, null, 2) + '\n---\n');
                      console.error(`Wrote debug dump for handler ${def.name} to debug-handler-errors.log`);
                    } catch (e) {
                      // best-effort: log to console if file write fails
                      console.error('Failed to write debug dump', e);
                    }
                  } catch (e) { console.error('Failed to prepare debug dump', e); }

                  if (err && err.name === 'ReferenceError' && typeof err.message === 'string') {
                    // Try to extract the missing identifier name from the message (e.g. "X is not defined")
                    const m = err.message.match(/^(?:([^\s]+) is not defined)|ReferenceError:\s*([^\s]+) is not defined/i);
                    const missing = (m && (m[1] || m[2])) ? (m[1] || m[2]) : null;
                    if (missing) {
                      console.warn(`Detected missing global identifier '${missing}' in handler ${def.name}. Injecting safe fallback on globalThis and retrying once.`);
                      try {
                        // Provide reasonable defaults for common helpers
                        if (missing === 'adminLog') globalThis.adminLog = globalThis.adminLog || (async () => {});
                        else if (missing === 'awardAchievement') globalThis.awardAchievement = globalThis.awardAchievement || (async () => false);
                        else if (missing.startsWith('save') && typeof globalThis[missing] === 'undefined') globalThis[missing] = async () => {};
                        else if (typeof globalThis[missing] === 'undefined') globalThis[missing] = async () => {};

                        // Attempt one retry of the handler now that the missing symbol is stubbed
                        try {
                          await def.execute(context, message, args);
                          console.log(`Retry of handler ${def.name} succeeded after stubbing ${missing}.`);
                          return;
                        } catch (retryErr) {
                          console.error(`Retry after stubbing '${missing}' failed for handler ${def.name}:`, retryErr);
                          // fall through to notify user below
                        }
                      } catch (injectErr) { console.error('Failed to inject fallback for missing global:', injectErr); }
                    }
                  }
                } catch (ee) { console.error('Error while logging handler failure:', ee); }
                try { if (message && message.reply) await message.reply('Command failed (see bot logs).'); } catch(e){}
              }
            } catch (wrapperErr) {
              console.error(`Error in command wrapper for ${def.name}:`, wrapperErr);
              try { if (message && message.reply) await message.reply('Command wrapper failed (see bot logs).'); } catch(e){}
            }
          };
          commandHandlers[def.name] = wrapped;

          // Register robust aliases so slash subcommands (which may be normalized) map to handlers
          try {
            const nameLower = def.name.toLowerCase();
            const nameStripped = def.name.replace(/[-_]/g, '');
            const nameLowerStripped = nameLower.replace(/[-_]/g, '');
            if (!commandHandlers[nameLower]) commandHandlers[nameLower] = wrapped;
            if (!commandHandlers[nameStripped]) commandHandlers[nameStripped] = wrapped;
            if (!commandHandlers[nameLowerStripped]) commandHandlers[nameLowerStripped] = wrapped;
          } catch (e) { /* ignore alias registration errors */ }

          // collect metadata for auto slash registration
          const groupName = def.group || def.slash?.group || 'misc';
          if (!groups[groupName]) groups[groupName] = { name: groupName, description: groupName + ' commands', subcommands: [] };

          // generate a sanitized slash subcommand name (discord requires lowercase, no spaces)
          const sanitize = (s) => (s||'').toString().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0,32);
          const sanitized = sanitize(def.name);
          // persist mapping (sanitized -> handler name)
          try { slashNameMap[sanitized] = def.name; } catch(e){}

          groups[groupName].subcommands.push({ name: sanitized, originalName: def.name, optionDefs: def.slash?.options || def.slash?.opts || [] });
          // store module-level meta for later sync (flatten)
          modulesMeta.push({ name: def.name, group: groupName, slash: def.slash || {}, description: def.description || '', sanitizedName: sanitized });

          console.log(`Loaded command module: ${def.name} from ${f}`);
        }
      } catch (e) { console.error('Failed to load command module', f, e); }
    }

    // Auto-registration handled separately by buildAndSyncSlashCommands
    // leave modulesMeta populated and return
    // Debug: print modulesMeta summary and registered handler keys (small sample)
    try {
      console.log('modulesMeta summary:', modulesMeta.map(m => ({ name: m.name, group: m.group }))); 
      console.log('registered handlers:', Object.keys(commandHandlers).slice(0,200));
      try {
        if (commandHandlers['track']) {
          console.log('--- track handler source (first 2000 chars) ---');
          const src = commandHandlers['track'].toString();
          console.log(src.slice(0,2000));
          console.log('--- end track handler source ---');
        }
      } catch(e) { console.error('Failed to dump track handler source', e); }
    } catch (e) {}
    return;
  } catch (e) { console.error('loadCommandModules failed', e); }
}

// Minimal startup AI health check to avoid missing symbol on some edits
async function startupAiHealthCheck() {
  try {
    // If runHealthCheck exists, we could execute a no-op call per guild; keep light-weight
    if (typeof runHealthCheck === 'function') {
      // don't block startup for long-running AI calls; run lightly
      for (const guild of client.guilds.cache.values()) {
        try { /* intentionally light: don't call heavy AI on startup */ } catch (e) {}
      }
    }
  } catch (e) { console.error('startupAiHealthCheck error', e); }
}

// ---------------- Message Handler ----------------
// Build and synchronize grouped slash commands from modulesMeta
async function buildAndSyncSlashCommands(targetGuildId = null) {
  try {
    // group modules by their group property
    const groups = {};
    for (const m of modulesMeta) {
      const g = m.group || 'misc';
      if (!groups[g]) groups[g] = { name: g, description: `${g} commands`, subcommands: [] };
      // construct option defs from m.slash.options
      const opts = (m.slash && (m.slash.options || m.slash.opts)) || [];
      const optionDefs = opts.map(o => {
        const t = (typeof o.type === 'string' ? o.type.toUpperCase() : o.type);
        let typeNum = 3; // STRING
        if (t === 6 || t === 'USER') typeNum = 6;
        else if (t === 8 || t === 'ROLE') typeNum = 8;
        else if (t === 4 || t === 'INTEGER') typeNum = 4;
        else if (t === 5 || t === 'BOOLEAN') typeNum = 5;
        else if (t === 7 || t === 'CHANNEL') typeNum = 7;
        return { name: (o.name||'text').slice(0,32), type: typeNum, description: (o.description||'').slice(0,100), required: !!o.required };
      });
      if (!optionDefs.length) optionDefs.push({ name: 'text', type: 3, description: 'Arguments as a single string', required: false });
      // use sanitized name if present in modulesMeta
      const subName = m.sanitizedName || (m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0,32);
      groups[g].subcommands.push({ name: subName, optionDefs });
    }

    // Ensure admin setleaderrole has a ROLE option for good UX
    if (!groups.admin) groups.admin = { name: 'admin', description: 'admin commands', subcommands: [] };
    if (!groups.admin.subcommands.find(s=>s.name==='setleaderrole')) groups.admin.subcommands.push({ name: 'setleaderrole', optionDefs: [{ name: 'role', type: 8, description: 'Role to assign to the champion', required: true }] });

    const cmdDefs = Object.values(groups).map(g => ({ name: g.name.slice(0,32), description: g.description.slice(0,100), options: g.subcommands.map(sc => ({ name: sc.name.slice(0,32), type: 1, description: `Run ${sc.name}`, options: sc.optionDefs })) }));
    if (!cmdDefs.length) return { ok: true, count: 0 };

    // Persist slashNameMap for later resolution and print helpful summary
    try { await saveSlashNameMap(); } catch(e){}
    // Helpful debug summary: print what we'll register (name + subcommand count)
    try {
      console.log('SlashCmds: cmdDefs summary ->', cmdDefs.map(c => ({ name: c.name, subcommands: (c.options||[]).length }))); 
    } catch (e) { /* ignore logging errors */ }

    if (targetGuildId) {
      const tg = client.guilds.cache.get(targetGuildId);
      if (tg) await tg.commands.set(cmdDefs);
    } else if (process.env.SLASH_GUILD_ID) {
      const targetGuild = client.guilds.cache.get(process.env.SLASH_GUILD_ID);
      if (targetGuild) await targetGuild.commands.set(cmdDefs);
    } else if (client.application) {
      await client.application.commands.set(cmdDefs);
    }
    console.log(`Synchronized ${cmdDefs.length} grouped slash commands from modulesMeta`);
    return { ok: true, count: cmdDefs.length };
  } catch (e) { console.error('buildAndSyncSlashCommands failed', e); return { ok: false, error: String(e) }; }
}

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

  // Track message counts for achievements
  try {
    messageCounts[message.author.id] = (messageCounts[message.author.id] || 0) + 1;
    if (messageCounts[message.author.id] === 1000) {
      // award Beast Mode
      await (globalThis.awardAchievement ? globalThis.awardAchievement(message.guild, message.author.id, ACHIEVEMENTS.beast_mode.id) : awardAchievement(message.guild, message.author.id, ACHIEVEMENTS.beast_mode.id));
    }
    // Night Lifter: if message sent after 2AM local time
    const zone = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const hour = new Date().toLocaleString('en-US', { timeZone: zone });
    const h = new Date(hour).getHours();
    if (h >= 2 && h < 5) {
      await (globalThis.awardAchievement ? globalThis.awardAchievement(message.guild, message.author.id, ACHIEVEMENTS.night_lifter.id) : awardAchievement(message.guild, message.author.id, ACHIEVEMENTS.night_lifter.id));
    }
    await saveMessageCounts();
  } catch (e) { console.error('message count/achievement error', e); }

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

  // AI responses (15% chance) using channel-aware persona prompts
  if (!message.content.startsWith("!") && Math.random() < 0.15) {
    try {
      const personaPrompt = await getChannelPersona(message.channel, message.content);
      const reply = await getOpenAIResponse(personaPrompt);
      await message.reply({ embeds: [
        new EmbedBuilder()
          .setDescription(reply)
          .setColor(0x3498db)
      ]});
    } catch (e) {
      console.error("AI reply error:", e);
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

// ---------------- Onboarding ----------------
async function startOnboarding(user, type) {
  try {
    const dm = await user.createDM();

    const questions = type === 'goal' ? [
      { key: 'role', q: 'Confirm "goal" (reply yes to continue)' },
      { key: 'goals', q: 'Main fitness goals? (comma separated)' },
      { key: 'habits', q: 'Which daily habits will you track? (comma separated)' },
      { key: 'checkins', q: 'Check-in frequency? (daily/weekly)' },
      { key: 'tags', q: 'Keywords/interests? (comma separated)' }
    ] : [
      { key: 'role', q: 'Confirm "future" (reply yes to continue)' },
      { key: 'birthdate', q: 'Enter birthdate YYYY-MM-DD' },
      { key: 'interests', q: 'List hobbies/interests (comma separated)' },
  { key: 'values', q: "Values / preferences you'd like a partner to know" },
      { key: 'hidden', q: 'Provide personal info to share with partner (or "none")' },
      { key: 'tags', q: 'Keywords / interests? (comma separated)' }
    ];

    const answers = {};
    let step = 0;
    const collector = dm.createMessageCollector({ time: 1000 * 60 * 10 });
    await dm.send(questions[step].q);

    collector.on('collect', m => {
      if (m.author.id !== user.id) return;
      if (m.content.toLowerCase() === 'cancel') { collector.stop('cancelled'); return; }
      const text = m.content.trim();
      const currentQ = questions[step];
      if (currentQ.key === 'birthdate') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) { dm.send('Format YYYY-MM-DD'); return; }
        const age = Math.floor((Date.now() - new Date(text).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
        if (age < 18) { dm.send('You must be 18+ to participate.'); collector.stop('underage'); return; }
        answers.birthdate = text;
      } else {
        answers[currentQ.key] = text;
      }
      step++;
      if (step >= questions.length) collector.stop('finished');
      else dm.send(questions[step].q).catch(()=>{});
    });

    collector.on('end', async (collected, reason) => {
      if (reason === 'cancelled') { dm.send('Cancelled'); return; }
      if (reason === 'underage') return;
      onboarding[user.id] = {
        userId: user.id,
        type,
        timestamp: Date.now(),
        raw: answers,
        tags: (answers.tags || answers.interests || answers.goals || '').split(',').map(s => s.trim()).filter(Boolean),
        hidden: answers.hidden || null
      };
      await saveOnboarding();
      partnerQueue.push(user.id);
      await savePartnerQueue();
      await dm.send('Application recorded. Use !leavequeue to exit.');
    });
  } catch (e) { console.error('Onboarding error:', e); }
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
        let pinsRaw;
        try { pinsRaw = await ch.messages.fetchPins(); } catch (err) { pinsRaw = null; }
        // Normalize various return shapes (Collection, Map, Array) into an array we can search
        let pins = [];
        if (pinsRaw) {
          if (Array.isArray(pinsRaw)) pins = pinsRaw;
          else if (typeof pinsRaw.find === 'function') pins = pinsRaw; // Collection-like
          else if (pinsRaw.values && typeof pinsRaw.values === 'function') pins = Array.from(pinsRaw.values());
          else pins = [];
        }
        existingMessage = (pins && typeof pins.find === 'function') ? pins.find(m => m.author?.id === client.user.id && m.embeds?.[0]?.title?.includes('GymBotBro — Health Scan')) || null : null;
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
          // Use a resilient lookup for admin channels. Some runtime edits may have
          // hoisted or moved findAdminChannels; fall back to an inline discovery
          // function if the named helper is not available.
          const adminChs = await (async (g) => {
            const channels = {};
            const lc = s => (s || '').toLowerCase();
            const byExact = name => g.channels.cache.find(ch => lc(ch.name) === name && ch.type === ChannelType.GuildText);
            const byContains = name => g.channels.cache.find(ch => lc(ch.name).includes(name) && ch.type === ChannelType.GuildText);
            channels.logging = byExact('logging') || byExact('log') || byContains('log') || null;
            channels.admin = byExact('admin') || byContains('admin') || byContains('staff') || null;
            channels.mod = byExact('mod') || byExact('moderator') || byContains('mod') || null;
            if (!channels.logging && g.systemChannel) channels.logging = g.systemChannel;
            if (!channels.admin && g.systemChannel) channels.admin = g.systemChannel;
            if (!channels.mod && g.systemChannel) channels.mod = g.systemChannel;
            return channels;
          })(guild);
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
// Provide a safe fallback for checkMutedUsers if missing from earlier edits
async function checkMutedUsers() {
  try {
    // iterate muted users and remove expired entries
    const now = Date.now();
    let changed = false;
    for (const uid of Object.keys(checkInMutes || {})) {
      const rec = checkInMutes[uid];
      if (!rec) continue;
      if (rec.until && rec.until !== Infinity && now > rec.until) {
        delete checkInMutes[uid]; changed = true;
      }
    }
    if (changed) await saveCheckInMutes();
  } catch (e) { console.error('checkMutedUsers error', e); }
}

cron.schedule('0 10 * * *', checkMutedUsers);

// ---------------- Health posts ----------------

// ---------------- Wealth tips ----------------
cron.schedule(WEALTH_TIP_CRON, postWealthTip);

// ---------------- Fitness posts ----------------
cron.schedule(FITNESS_POST_CRON, postFitnessContent);

// ---------------- Daily motivation (9 AM) ----------------
// run auto-match every minute for quicker pairing
setInterval(() => {
  tryAutoMatch();
} , 60 * 1000);

// ---------------- CRON JOBS ----------------
// Health posts (twice daily)
cron.schedule(HEALTH_POST_CRON, async () => {
  const ch = client.channels.cache.find(c => (c.name || '').toLowerCase().includes('health'));
  if (ch) {
    const news = await getHealthNews();
    await ch.send({ embeds: [
      new EmbedBuilder()
        .setTitle("🩺 Health Tip")
        .setDescription(news)
        .setColor(0x2ecc71)
        .setTimestamp()
    ]});
  }
});

// Wealth tips (twice daily)
cron.schedule(WEALTH_TIP_CRON, async () => {
  const ch = client.channels.cache.find(c => (c.name || '').toLowerCase().includes('wealth'));
  if (ch) {
    const tips = wealthTips.length ? wealthTips[Math.floor(Math.random() * wealthTips.length)] : "Save 10% before you spend 💰";
    await ch.send({ embeds: [
      new EmbedBuilder()
        .setTitle("💰 Wealth Tip")
        .setDescription(tips)
        .setColor(0xf1c40f)
        .setTimestamp()
    ]});
  }
});

// Fitness posts (3x daily)
cron.schedule(FITNESS_POST_CRON, async () => {
  const ch = client.channels.cache.find(c => (c.name || '').toLowerCase().includes('fitness'));
  if (ch) {
    const videos = await getRandomFitnessVideos(1);
    await ch.send({ embeds: [
      new EmbedBuilder()
        .setTitle("🏋️ Fitness Motivation")
        .setDescription(videos[0])
        .setColor(0xe74c3c)
        .setTimestamp()
    ]});
  }
});

// Role expiry processor: run every 10 minutes and clear temporary role grants
cron.schedule('*/10 * * * *', async () => {
  try {
    const grants = await storage.load('tempRoleGrants', {}); // { guildId: { userId: [{ roleId, expiresAt }] } }
    let changed = false;
    for (const guildId of Object.keys(grants || {})) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      for (const userId of Object.keys(grants[guildId] || {})) {
        const entries = grants[guildId][userId];
        const remain = [];
        for (const e of entries) {
          if (Date.now() > e.expiresAt) {
            // revoke role
            try {
              const member = await guild.members.fetch(userId).catch(()=>null);
              if (member) {
                const role = guild.roles.cache.get(e.roleId);
                if (role && guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                  await member.roles.remove(role).catch(()=>{});
                }
              }
            } catch (err) { console.error('revoke role error', err); }
            changed = true;
          } else {
            remain.push(e);
          }
        }
        if (remain.length) grants[guildId][userId] = remain; else delete grants[guildId][userId];
      }
      if (Object.keys(grants[guildId] || {}).length === 0) delete grants[guildId];
    }
    if (changed) await storage.save('tempRoleGrants', grants);
  } catch (e) { console.error('temp role expiry cron failed', e); }
});

// ---------------- Bot Ready ----------------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("!help for commands");
  try { await loadAllData(); } catch (e) { console.error('loadAllData failed', e); }
  // Load optional command modules from src/commands (allows modular commands)
  await loadCommandModules();
  setInterval(() => tryAutoMatch(), 1000 * 30); // every 30s

  // Run startup AI health check and pin admin docs to admin/mod/logging channels
  await tryConnectMongo();
  await startupAiHealthCheck();

  for (const guild of client.guilds.cache.values()) {
    try {
      if (typeof pinCommandDocs === 'function') await pinCommandDocs(guild);
      // log that pinning was attempted
      try { (globalThis.adminLog ? globalThis.adminLog(guild, `Pinned admin docs and logging docs during startup.`) : adminLog(guild, `Pinned admin docs and logging docs during startup.`)); } catch(e){}
    } catch (e) { console.error('Error pinning docs for guild', guild.id, e); }
  }

  // Post a brief startup health message into #gbb-health where available
  try {
    // Run an initial full health run (and schedule periodic updates)
    const healthContext = { client, storage, validateModel, aiHealth, getOpenAIResponse, adminLog,
      // provide the common in-memory stores so health checks can run commands safely
      fitnessWeekly, habitTracker, partnerQueue, messageCounts, achievementsStore, saveHabits, saveWeekly, savePartnerQueue };
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

  // --- Slash command registration: register slash commands from modules ---
  try {
    // Attempt to auto-sync all module-defined slash commands
    await buildAndSyncSlashCommands();
    console.log('Attempted to synchronize module slash commands at startup');
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

// During debugging, capture uncaught exceptions to log them rather than letting
// the process exit immediately. In production you may want to remove or alter this.
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Map slash command interactions to existing prefix handlers
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isCommand?.()) return;

    // Wrap interaction response methods to suppress known double-ack errors
    // (DiscordAPIError[40060]) which can occur in race conditions when handlers
    // attempt to reply after the interaction is already acknowledged.
    try {
      const wrap = (fnName) => {
        if (!interaction[fnName] || interaction[fnName].__wrapped) return;
        const orig = interaction[fnName].bind(interaction);
        interaction[fnName] = async (...args) => {
          try {
            return await orig(...args);
          } catch (err) {
            try {
              const code = err && (err.code || err?.status);
              if (code === 40060 || (err && err.message && err.message.includes('already been acknowledged'))) {
                console.warn(`Suppressed DiscordAPIError[40060] during interaction.${fnName}`);
                return null;
              }
            } catch (ee) {}
            throw err;
          }
        };
        interaction[fnName].__wrapped = true;
      };
      wrap('reply'); wrap('editReply'); wrap('followUp');
    } catch (wrapErr) { console.error('Failed to wrap interaction methods', wrapErr); }

    const DEBUG = !!process.env.DEBUG_COMMANDS;

    // Support slash commands: group is the top-level command, sub is subcommand name when using grouped commands
    const group = interaction.commandName;
    const sub = interaction.options.getSubcommand(false); // null if none

    // Choose the handler: prefer the subcommand when present
    let handlerName = sub || group;
    // Build args: prefer explicit 'text' argument, then append other named options
    let args = [];
    const text = interaction.options.getString('text') || '';
    if (text.trim()) args = args.concat(text.trim().split(/ +/g));

    // Collect other named option values
    for (const opt of interaction.options.data || []) {
      if (opt.name !== 'text' && typeof opt.value !== 'undefined') args.push(opt.value);
    }

    // First try strict mapping from sanitized slash name -> handler
    let handler = null;
    try {
      const sanitized = (sub || group || '').toString().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (slashNameMap[sanitized]) {
        const mapped = slashNameMap[sanitized];
        if (commandHandlers[mapped]) { handler = commandHandlers[mapped]; handlerName = mapped; }
      }
    } catch(e) {}

    // Normalize handler lookup: try direct, lowercase, and relaxed variants
    if (!handler) {
      const tryNames = [handlerName, handlerName && handlerName.toLowerCase()];
      if (handlerName) tryNames.push(handlerName.replace(/[-_]/g, ''));
      if (handlerName) tryNames.push(handlerName.replace(/[-_]/g, '').toLowerCase());
      for (const n of tryNames) {
        if (!n) continue;
        if (commandHandlers[n]) { handler = commandHandlers[n]; handlerName = n; break; }
      }
    }

    // Fallback: search modulesMeta by matching name to sub/group or relaxed match
    if (!handler && Array.isArray(modulesMeta)) {
      const wanted = (sub || group || '').toLowerCase();
      const found = modulesMeta.find(m => (m.name || '').toLowerCase() === wanted || (m.sanitizedName || '').toLowerCase() === wanted);
      if (found && commandHandlers[found.name]) { handler = commandHandlers[found.name]; handlerName = found.name; }
    }

    if (DEBUG) {
      console.log('[DEBUG_COMMANDS] interaction:', { guild: interaction.guild?.id, channel: interaction.channel?.id, command: group, sub, resolvedHandler: handlerName, args });
      if (!handler) console.log('[DEBUG_COMMANDS] available handlers:', Object.keys(commandHandlers).slice(0,200));
    }

    if (!handler) {
      return interaction.reply({ content: 'Command handler not found for: ' + (sub || group), ephemeral: true });
    }

    // enforce channel locks for interactions
    if (!isCommandAllowedInChannel(handlerName, interaction.channel)) {
      const allowed = commandChannelLock[handlerName];
      return interaction.reply({ content: 'That command must be used in the `' + allowed + '` channel. Please try there.', ephemeral: true });
    }

    // Build slashOptions map for typed inputs (role/user/channel/id etc.)
    const slashOptions = {};
    try {
      for (const opt of interaction.options.data || []) {
        slashOptions[opt.name] = opt.value || (opt.resolved ? opt.resolved : null);
        if (interaction.options.getRole && interaction.options.getRole(opt.name)) slashOptions[opt.name] = interaction.options.getRole(opt.name);
        if (interaction.options.getUser && interaction.options.getUser(opt.name)) slashOptions[opt.name] = interaction.options.getUser(opt.name);
        if (interaction.options.getChannel && interaction.options.getChannel(opt.name)) slashOptions[opt.name] = interaction.options.getChannel(opt.name);
      }
    } catch (e) { /* ignore */ }
  // Try to defer reply to avoid the 3s interaction timeout for long handlers
  let didDefer = false;
  try { await interaction.deferReply({ ephemeral: false }); didDefer = true; } catch (e) { /* ignore if already deferred/replied */ }
  // In some edge cases deferReply may throw but the interaction object already reports
  // being deferred or replied. Reflect that in didDefer so reply() uses editReply/followUp.
  try { didDefer = didDefer || !!interaction.deferred || !!interaction.replied; } catch (e) { /* ignore */ }

              const fakeMessage = {
      author: interaction.user,
      member: interaction.member,
      guild: interaction.guild,
      channel: interaction.channel,
      slashOptions,
      // Ensure we only attempt a primary acknowledgement once. Subsequent replies use followUp.
      reply: (() => {
        let responseSent = false;
        // serialize attempts to avoid races
        return async (payload) => {
          const contentObj = (typeof payload === 'string') ? { content: payload } : (payload && typeof payload === 'object') ? payload : { content: JSON.stringify(payload) };
          try {
            // If we already sent a primary response, always use followUp
            if (responseSent) {
              try { return await interaction.followUp(contentObj); } catch (e) { console.error('followUp after responseSent failed:', e); return null; }
            }

            // Prefer editReply/followUp when deferred or already replied
            if (didDefer || interaction.deferred || interaction.replied) {
              try {
                responseSent = true; // reserve primary response slot immediately to avoid races
                if (interaction.deferred && !interaction.replied) {
                  await interaction.editReply(contentObj);
                } else {
                  await interaction.followUp(contentObj);
                }
                return;
              } catch (e) {
                // fallback to followUp if editReply fails
                try { responseSent = true; await interaction.followUp(contentObj); return; } catch (e2) { console.error('Failed to send via editReply/followUp:', e, e2); }
              }
            }

            // Otherwise attempt a normal reply, with fallbacks
            try {
              responseSent = true; // mark reserved before awaiting to avoid concurrent callers racing
              await interaction.reply(contentObj);
              return;
            } catch (errReply) {
              // common failure: interaction already acknowledged; try followUp
              try { responseSent = true; await interaction.followUp(contentObj); return; } catch (e) { console.error('Failed to send interaction response after reply failed:', e); }
            }
          } catch (err) {
            // Last-resort: try followUp
            try { await interaction.followUp(contentObj); responseSent = true; return; } catch (e) { console.error('Failed to send interaction response (final fallback):', e); }
          }
        };
      })()
    };

    await handler(fakeMessage, args);
  } catch (e) {
    console.error('interaction handler error:', e);
    try { if (!interaction.replied) await interaction.reply({ content: 'Error running command', ephemeral: true }); } catch(e){}
  }
});

// ---------------- Start Bot ----------------
client.login(process.env.DISCORD_TOKEN);
