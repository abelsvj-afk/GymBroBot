import fs from 'fs';
import path from 'path';

const dataDir = './data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const safeWrite = (file, obj) => { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch(e){ console.error(`Error saving ${file}:`, e); } };
const safeRead = (file, fallback) => { try { if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e){ console.error(`Error loading ${file}:`, e); } return fallback; };

export const files = {
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
  weeklySnapshots: path.join(dataDir, 'weeklySnapshots.json'),
  monthlySnapshots: path.join(dataDir, 'monthlySnapshots.json'),
  yearlySnapshots: path.join(dataDir, 'yearlySnapshots.json'),
  yearly: path.join(dataDir, 'yearly.json'),
  checkInMutes: path.join(dataDir, 'checkInMutes.json'),
  healthPosts: path.join(dataDir, 'healthPosts.json'),
  wealthTips: path.join(dataDir, 'wealthTips.json'),
  fitnessPosts: path.join(dataDir, 'fitnessPosts.json'),
  aiHealth: path.join(dataDir, 'ai_health.json'),
  guildConfigs: path.join(dataDir, 'guildConfigs.json')
};

export const state = {
  memory: {}, birthdays: {}, fitnessWeekly: {}, fitnessMonthly: {}, fitnessYearly: {},
  weeklySnapshots: [], monthlySnapshots: [], yearlySnapshots: [],
  partnerQueue: [], partners: {}, strikes: {}, habitTracker: {},
  challenges: {}, onboarding: {}, matches: {}, leaderboardPotential: {},
  checkInMutes: {}, healthPosts: [], wealthTips: [], fitnessPosts: [], aiHealth: [], guildConfigs: {}
};

export const saveLoadMap = {
  memory: [() => safeWrite(files.memory, state.memory), () => state.memory = safeRead(files.memory, {})],
  weekly: [() => safeWrite(files.weekly, state.fitnessWeekly), () => state.fitnessWeekly = safeRead(files.weekly, {})],
  monthly: [() => safeWrite(files.monthly, state.fitnessMonthly), () => state.fitnessMonthly = safeRead(files.monthly, {})],
  yearly: [() => safeWrite(files.yearly, state.fitnessYearly), () => state.fitnessYearly = safeRead(files.yearly, {})],
  partnerQueue: [() => safeWrite(files.partnerQueue, state.partnerQueue), () => state.partnerQueue = safeRead(files.partnerQueue, [])],
  partners: [() => safeWrite(files.partners, state.partners), () => state.partners = safeRead(files.partners, {})],
  strikes: [() => safeWrite(files.strikes, state.strikes), () => state.strikes = safeRead(files.strikes, {})],
  habits: [() => safeWrite(files.habits, state.habitTracker), () => state.habitTracker = safeRead(files.habits, {})],
  challenges: [() => safeWrite(files.challenges, state.challenges), () => state.challenges = safeRead(files.challenges, {})],
  onboarding: [() => safeWrite(files.onboarding, state.onboarding), () => state.onboarding = safeRead(files.onboarding, {})],
  matches: [() => safeWrite(files.matches, state.matches), () => state.matches = safeRead(files.matches, {})],
  leaderboard: [() => safeWrite(files.leaderboard, state.leaderboardPotential), () => state.leaderboardPotential = safeRead(files.leaderboard, {})],
  weeklySnapshots: [() => safeWrite(files.weeklySnapshots, state.weeklySnapshots), () => state.weeklySnapshots = safeRead(files.weeklySnapshots, [])],
  monthlySnapshots: [() => safeWrite(files.monthlySnapshots, state.monthlySnapshots), () => state.monthlySnapshots = safeRead(files.monthlySnapshots, [])],
  yearlySnapshots: [() => safeWrite(files.yearlySnapshots, state.yearlySnapshots), () => state.yearlySnapshots = safeRead(files.yearlySnapshots, [])],
  yearly: [() => safeWrite(files.yearly, state.fitnessYearly), () => state.fitnessYearly = safeRead(files.yearly, {})],
  checkInMutes: [() => safeWrite(files.checkInMutes, state.checkInMutes), () => state.checkInMutes = safeRead(files.checkInMutes, {})],
  healthPosts: [() => safeWrite(files.healthPosts, state.healthPosts), () => state.healthPosts = safeRead(files.healthPosts, [])],
  wealthTips: [() => safeWrite(files.wealthTips, state.wealthTips), () => state.wealthTips = safeRead(files.wealthTips, [])],
  fitnessPosts: [() => safeWrite(files.fitnessPosts, state.fitnessPosts), () => state.fitnessPosts = safeRead(files.fitnessPosts, [])],
  aiHealth: [() => safeWrite(files.aiHealth, state.aiHealth), () => state.aiHealth = safeRead(files.aiHealth, [])],
  guildConfigs: [() => safeWrite(files.guildConfigs, state.guildConfigs), () => state.guildConfigs = safeRead(files.guildConfigs, {})]
};

export function loadAllData() { Object.values(saveLoadMap).forEach(([_, load]) => load()); console.log('All data loaded (persistence)'); }
export function saveAllData() { Object.values(saveLoadMap).forEach(([save]) => save()); }

export const saveMemory = () => saveLoadMap.memory[0]();
export const saveWeekly = () => saveLoadMap.weekly[0]();
export const saveMonthly = () => saveLoadMap.monthly[0]();
export const savePartnerQueue = () => saveLoadMap.partnerQueue[0]();
export const savePartners = () => saveLoadMap.partners[0]();
export const saveStrikes = () => saveLoadMap.strikes[0]();
export const saveHabits = () => saveLoadMap.habits[0]();
export const saveChallenges = () => saveLoadMap.challenges[0]();
export const saveOnboarding = () => saveLoadMap.onboarding[0]();
export const saveMatches = () => saveLoadMap.matches[0]();
export const saveLeaderboard = () => saveLoadMap.leaderboard[0]();
export const saveCheckInMutes = () => saveLoadMap.checkInMutes[0]();
export const saveHealthPosts = () => saveLoadMap.healthPosts[0]();
export const saveWealthTips = () => saveLoadMap.wealthTips[0]();
export const saveFitnessPosts = () => saveLoadMap.fitnessPosts[0]();
export const saveAiHealth = () => saveLoadMap.aiHealth[0]();

export const loadBirthdays = () => { try { state.birthdays = safeRead(files.birthdays, {}); } catch(e){ state.birthdays = {}; } };
export const saveBirthdays = () => { try { safeWrite(files.birthdays, state.birthdays); } catch(e){ console.error('saveBirthdays', e); } };

// keep old-style aliases if other modules still call them
export const loadPartnerQueue = () => saveLoadMap.partnerQueue[1]();
export const loadPartners = () => saveLoadMap.partners[1]();
export const loadStrikes = () => saveLoadMap.strikes[1]();
export const loadChallenges = () => saveLoadMap.challenges[1]();

export default { files, state, saveLoadMap, loadAllData, saveAllData };
