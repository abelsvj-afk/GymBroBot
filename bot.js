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
import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";
import OpenAI from "openai";
import cron from "node-cron";
import axios from "axios";
import * as cheerio from "cheerio";
// instagram scraping removed per request
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

// ------------------ Discord Client ------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ------------------ OpenAI Setup ------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------------------ YouTube API Setup ------------------
const youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });

// ------------------ Memory & Tracking ------------------
const MEMORY_FILE = "./conversationmemory.json";
const BIRTHDAY_FILE = "./birthdays.json";
const FITNESS_WEEKLY_FILE = "./fitnessWeekly.json";
const FITNESS_MONTHLY_FILE = "./fitnessMonthly.json";

let memory = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE)) : {};
let birthdays = fs.existsSync(BIRTHDAY_FILE) ? JSON.parse(fs.readFileSync(BIRTHDAY_FILE)) : {};
let fitnessWeekly = fs.existsSync(FITNESS_WEEKLY_FILE) ? JSON.parse(fs.readFileSync(FITNESS_WEEKLY_FILE)) : {};
let fitnessMonthly = fs.existsSync(FITNESS_MONTHLY_FILE) ? JSON.parse(fs.readFileSync(FITNESS_MONTHLY_FILE)) : {};

const saveMemory = () => fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
const saveBirthdays = () => fs.writeFileSync(BIRTHDAY_FILE, JSON.stringify(birthdays, null, 2));
const saveWeekly = () => fs.writeFileSync(FITNESS_WEEKLY_FILE, JSON.stringify(fitnessWeekly, null, 2));
const saveMonthly = () => fs.writeFileSync(FITNESS_MONTHLY_FILE, JSON.stringify(fitnessMonthly, null, 2));

// ------------------ YouTube Fitness Video Fetch (keywords updated) ------------------
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
    // choose a random query from the array
    const q = fitnessQueries[Math.floor(Math.random() * fitnessQueries.length)];
    const res = await youtube.search.list({
      part: "snippet",
      q,
      maxResults: 10,
      type: "video",
      videoDuration: "short,medium,long",
      relevanceLanguage: "en"
    });
    const items = res.data.items;
    if (!items || items.length === 0) return ["No fitness videos found today."];
    const shuffled = items.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).map(
      item => `🏋️‍♂️ ${item.snippet.title}\nhttps://www.youtube.com/watch?v=${item.id.videoId}`
    );
  } catch (err) {
    console.error("YouTube API error:", err.message);
    return ["Error fetching videos from YouTube."];
  }
}

// ------------------ Helper Functions ------------------
async function getOpenAIResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI Error:", err.response?.data || err.message);
    return "Sorry, something went wrong.";
  }
}

async function getHealthNews() {
  if (!process.env.NEWS_API_KEY) return "No News API key provided.";
  try {
    const res = await axios.get(
      `https://newsapi.org/v2/top-headlines?category=health&language=en&apiKey=${process.env.NEWS_API_KEY}`
    );
    const top = res.data.articles?.[0];
    return top ? `📰 **${top.title}**\n${top.description || ""}\n${top.url}` : "No health news today.";
  } catch (err) {
    console.error("News API Error:", err.response?.data || err.message);
    return "Could not fetch health news.";
  }
}

// ------------------ TheSportsDB (tolerant) ------------------
// We'll attempt to query TheSportsDB (free test key '1' is commonly used). If unavailable or no results, we safe-fail.
const THESPORTSDB_KEY = process.env.THESPORTSDB_KEY || "1"; // fallback to demo key

async function getSportsUpdates() {
  // We'll attempt multiple endpoints; because TheSportsDB's structure varies per sport, we do a tolerant approach.
  try {
    // Example: try to pull next 5 events for NBA and NFL (if available) and attempt a boxing search.
    const results = [];

    // NBA next events (league id 4387 is NBA on TheSportsDB)
    try {
      const resNBA = await axios.get(`https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/eventsnextleague.php?id=4387`);
      const events = resNBA.data.events;
      if (events && events.length) {
        results.push("Basketball (NBA): " + events.slice(0, 5).map(e => `${e.strEvent} - ${e.dateEvent}`).join(" | "));
      }
    } catch (e) { /* ignore */ }

    // NFL next events (league id 4391)
    try {
      const resNFL = await axios.get(`https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/eventsnextleague.php?id=4391`);
      const events = resNFL.data.events;
      if (events && events.length) {
        results.push("Football (NFL): " + events.slice(0, 5).map(e => `${e.strEvent} - ${e.dateEvent}`).join(" | "));
      }
    } catch (e) { /* ignore */ }

    // Boxing / Combat: try searching for "Boxing" events via filter
    try {
      const resBoxing = await axios.get(`https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/searchfilename.php?e=boxing`);
      // Note: searchfilename may be empty; we handle gracefully
      if (resBoxing.data && Object.keys(resBoxing.data).length) {
        results.push("Boxing/MMA/Muay Thai: Check official fight calendars for latest events.");
      }
    } catch (e) { /* ignore */ }

    if (results.length === 0) return "No new sports updates available today.";
    return results.join("\n");
  } catch (err) {
    console.error("TheSportsDB Error:", err.message);
    return "No new sports updates available today.";
  }
}

// ------------------ Update Leaderboard (manual and scheduled both use this)
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
  const leaderboardChannel = client.channels.cache.find(ch => ch.name.toLowerCase() === "leaderboard");
  if (!leaderboardChannel) return;
  const msg = buildLeaderboardMessage();
  try {
    // attempt to tidy channel a bit; ignore if not allowed
    try { await leaderboardChannel.bulkDelete(10); } catch (e) { /* ignore permission errors */ }
    await leaderboardChannel.send({ content: msg });
  } catch (err) {
    console.error("Error updating leaderboard channel:", err.message);
  }
}

// ------------------ Bot Ready ------------------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // ------------------ Pinned How-To Messages ------------------
  const howToMessages = {
    general: "💡 **Welcome to General!** Chat freely. Ask questions or interact with channels. Log birthdays with `setbirthday MM-DD`. Bot reminds everyone on their birthday! 🎉",
    welcome: "💡 **Welcome Channel:** Introduce yourself & get guidance.",
    announcements: "💡 **Announcements:** Important updates posted here.",
    "daily-check-ins": "💡 **Daily Check-Ins:** Post workouts/motivation. Example: `Did a 30-min run today!` 💪",
    "tips and guide": "💡 **Tips & Guide:** Ask about fitness, health, style, faith, or wealth. The bot will respond contextually.",
    faith: "💡 **Faith:** Questions about Christianity, God, Jesus Christ, Holy Spirit. Example: `How can I strengthen my prayer life? 🙏`",
    "mens-style": "💡 **Men's Style:** Ask about fashion, outfits, or style tips. Example: `How should I style a casual outfit for fall? 👔`",
    "open-up": "💡 **Open Up:** Share struggles or mental health concerns. Example: `I’m feeling stressed about work. 💙`",
    health: "💡 **Health:** Ask about wellness, diet, remedies, superfoods. Example: `Best exercises for back pain? 🏥`",
    wealth: "💡 **Wealth:** Investing, business, stocks, crypto, financial growth. Example: `Smart first step for investing? 💰`",
    sports: "💡 **Sports:** MMA, boxing, Muay Thai, combat sports events. Example: `Who’s fighting in the UFC this weekend? 🥊`",
    fitness: "💡 **Fitness:** Log workouts daily, see leaderboard, check-ins posted automatically. 🏋️‍♂️",
    leaderboard: "💡 **Leaderboard:** Public leaderboard updates daily with flair & emojis. Weekly & monthly winners highlighted. No comments allowed. 🏆"
  };

  for (const [channelName, message] of Object.entries(howToMessages)) {
    const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === channelName);
    if (!channel) continue;
    try {
      const pinned = await channel.messages.fetchPinned();
      if (!pinned.some(msg => msg.content === message)) {
        const sent = await channel.send(message);
        await sent.pin();
      }
    } catch (err) {
      console.error(`Error pinning message in #${channelName}:`, err.message);
    }
  }

  // ------------------ Cron Jobs (Timezone set to America/New_York) ------------------
  // Check-in reminder times (7am, 10am, 2pm, 6pm, 9pm Eastern)
  const checkInTimes = ["0 7 * * *", "0 10 * * *", "0 14 * * *", "0 18 * * *", "0 21 * * *"];
  checkInTimes.forEach(time => {
    cron.schedule(time, async () => {
      console.log(`[Cron] Check-in reminder triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
      const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "daily-check-ins");
      if (channel) {
        await channel.send("💪 Time for your check-in! Log your progress and stay accountable!");
      }
    }, { timezone: "America/New_York" });
  });

  // Daily Wealth Tip -> 11 AM ET
  cron.schedule("0 11 * * *", async () => {
    console.log(`[Cron] Wealth tip triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "wealth");
    if (channel) {
      const tip = await getOpenAIResponse(
        "Provide a practical daily wealth tip for investing, business, money management, stocks, crypto, life insurance, entrepreneurship, leveraging debt, LLCs, banking, and financial growth."
      );
      await channel.send(`💰 Daily Wealth Tip:\n${tip}`);
    }
  }, { timezone: "America/New_York" });

  // Daily Health News -> 10 AM ET (unchanged)
  cron.schedule("0 10 * * *", async () => {
    console.log(`[Cron] Health news triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "health");
    if (channel) {
      const news = await getHealthNews();
      await channel.send(`🏥 Daily Health News:\n${news}`);
    }
  }, { timezone: "America/New_York" });

  // Sports updates -> 8am, 12pm, 4pm ET (uses TheSportsDB tolerant fetch)
  const fightTimes = ["0 8 * * *", "0 12 * * *", "0 16 * * *"];
  fightTimes.forEach(cronTime => {
    cron.schedule(cronTime, async () => {
      console.log(`[Cron] Sports update triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
      const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "sports");
      if (!channel) return;
      const sportUpdates = await getSportsUpdates();
      await channel.send(`🥊 Combat & Sports Update:\n${sportUpdates}`);
    }, { timezone: "America/New_York" });
  });

  // Fitness videos -> 12 PM ET (midday)
  cron.schedule("0 12 * * *", async () => {
    console.log(`[Cron] Fitness video posting triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "fitness");
    if (!channel) return;
    const videos = await getRandomFitnessVideos(Math.floor(Math.random() * 2) + 2); // 2-3 videos
    for (const video of videos) {
      await channel.send(video);
    }
  }, { timezone: "America/New_York" });

  // Birthday announcer -> 8 AM ET daily
  cron.schedule("0 8 * * *", async () => {
    console.log(`[Cron] Birthday check triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "general");
    if (!channel) return;
    const today = new Date();
    const todayMonthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    for (const [userID, date] of Object.entries(birthdays)) {
      const birthMonthDay = date.slice(5);
      if (birthMonthDay === todayMonthDay) {
        channel.send(`🎉 Today is <@${userID}>'s birthday! Go shout them a happy birthday! 💪`);
      }
    }
  }, { timezone: "America/New_York" });

  // Weekly leaderboard dump -> Sunday midnight ET
  cron.schedule("0 0 * * 0", async () => {
    console.log(`[Cron] Weekly leaderboard dump triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "leaderboard");
    if (!channel) return;
    const sorted = Object.entries(fitnessWeekly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    let msg = "**🏅 Weekly Fitness Winner 🏅**\n";
    if (sorted.length > 0) msg += `🥇 <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += "\n💥 Weekly Top 5:\n";
    sorted.slice(0, 5).forEach(([uid, data], idx) => {
      const medals = ["🥇","🥈","🥉","🏋️","💪"];
      msg += `${medals[idx]} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`;
    });
    await channel.send({ content: msg });
    // reset weekly counts after posting
    for (const uid in fitnessWeekly) fitnessWeekly[uid] = { yes: 0, no: 0 };
    saveWeekly();
    console.log("[Cron] Weekly fitness data reset after dump.");
  }, { timezone: "America/New_York" });

  // Monthly leaderboard dump -> 1st of month midnight ET
  cron.schedule("0 0 1 * *", async () => {
    console.log(`[Cron] Monthly leaderboard dump triggered at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    const channel = client.channels.cache.find(ch => ch.name.toLowerCase() === "leaderboard");
    if (!channel) return;
    const sorted = Object.entries(fitnessMonthly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    let msg = "**🏆 Monthly Fitness Winner 🏆**\n";
    if (sorted.length > 0) msg += `🥇 <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += "\n🔥 Monthly Top 5:\n";
    sorted.slice(0, 5).forEach(([uid, data], idx) => {
      const medals = ["🥇","🥈","🥉","🏆","💪"];
      msg += `${medals[idx]} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`;
    });
    await channel.send({ content: msg });
    // reset monthly counts after posting
    for (const uid in fitnessMonthly) fitnessMonthly[uid] = { yes: 0, no: 0 };
    saveMonthly();
    console.log("[Cron] Monthly fitness data reset after dump.");
  }, { timezone: "America/New_York" });
});

// ------------------ Message Handling ------------------
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  const channelName = (message.channel.name || "").toLowerCase();
  const user = message.author.id;

  // --- memory tracking
  if (!memory[channelName]) memory[channelName] = {};
  if (!memory[channelName][user]) memory[channelName][user] = [];
  memory[channelName][user].push(message.content);
  saveMemory();

  // ------------------ Quick Test Command (now only YouTube)
  if (message.content === "!test") {
    try {
      const videos = await getRandomFitnessVideos(2);
      if (videos.length === 0) return message.reply("No content found for testing.");
      for (const item of videos) await message.channel.send(item);
    } catch (err) {
      console.error("Error in !test command:", err);
      return message.reply("❌ Something went wrong while fetching test content.");
    }
    return;
  }

  // ------------------ Leaderboard Manual Command (only respond in #leaderboard)
  if (message.content === "!leaderboard") {
    if (channelName !== "leaderboard") {
      return message.reply("Please run `!leaderboard` in the #leaderboard channel only.");
    }
    const msg = buildLeaderboardMessage();
    return message.channel.send({ content: msg });
  }

  // Birthday Command: setbirthday
  const args = message.content.split(" ");
  if (args[0] === "setbirthday") {
    const date = args[1];
    if (!date || !/^\d{2}-\d{2}$/.test(date)) {
      return message.reply("Please provide your birthday in MM-DD format, e.g., `setbirthday 09-23`");
    }
    birthdays[user] = `${new Date().getFullYear()}-${date}`;
    saveBirthdays();
    return message.reply(`Got it! Your birthday has been saved as ${date}. 🎉`);
  }

  // Birthday listing (only in #general)
  if (message.content === "!birthdays") {
    if (channelName !== "general") {
      return message.reply("You can only run `!birthdays` in the #general channel.");
    }
    const entries = Object.entries(birthdays);
    if (entries.length === 0) return message.channel.send("No birthdays stored yet.");
    let out = "**Saved Birthdays:**\n";
    entries.forEach(([uid, date]) => {
      out += `<@${uid}> → ${date}\n`;
    });
    return message.channel.send(out);
  }

  // ------------------ Fitness Check-ins (channel: daily-check-ins)
  if (channelName === "daily-check-ins") {
    if (!fitnessWeekly[user]) fitnessWeekly[user] = { yes: 0, no: 0 };
    if (!fitnessMonthly[user]) fitnessMonthly[user] = { yes: 0, no: 0 };
    if (/done|✅|yes/i.test(message.content)) {
      fitnessWeekly[user].yes += 1;
      fitnessMonthly[user].yes += 1;
      console.log(`[Check-in] ${message.author.tag} marked YES. Weekly:${fitnessWeekly[user].yes} Monthly:${fitnessMonthly[user].yes}`);
    } else if (/not done|❌|no/i.test(message.content)) {
      fitnessWeekly[user].no += 1;
      fitnessMonthly[user].no += 1;
      console.log(`[Check-in] ${message.author.tag} marked NO. Weekly:${fitnessWeekly[user].no} Monthly:${fitnessMonthly[user].no}`);
    } else {
      // Not an explicit yes/no - ignore (but keep memory)
      return;
    }
    saveWeekly();
    saveMonthly();
    // Only update leaderboard channel snapshot, don't spam the check-in channel
    await updateLeaderboardChannel();
    return;
  }

  // ------------------ Check-in Test Command (runs in daily-check-ins to test weekly dump/reset)
  // This simulates triggering the weekly dump (so you can test reset without waiting).
  if (message.content === "!checkin-test") {
    if (channelName !== "daily-check-ins") {
      return message.reply("Please run `!checkin-test` in the #daily-check-ins channel for safety.");
    }

    // Basic permission check: only allow users with ManageMessages permission to run test
    try {
      const member = await message.guild.members.fetch(message.author.id);
      if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("You must have Manage Messages permission to run this test.");
      }
    } catch (e) { /* if fetch fails, still allow for now */ }

    // simulate running the weekly dump flow:
    const leaderboardChannel = client.channels.cache.find(ch => ch.name.toLowerCase() === "leaderboard");
    if (!leaderboardChannel) {
      return message.reply("No #leaderboard channel found. Create it first to run test.");
    }

    // Build weekly snapshot from fitnessWeekly
    const sorted = Object.entries(fitnessWeekly).sort((a, b) => (b[1].yes - b[1].no) - (a[1].yes - a[1].no));
    let msg = "**🏅 WEEKLY FITNESS TEST DUMP 🏅**\n";
    if (sorted.length > 0) msg += `🥇 <@${sorted[0][0]}> with ✅ ${sorted[0][1].yes} | ❌ ${sorted[0][1].no}\n`;
    msg += "\n💥 Weekly Top 5 (TEST):\n";
    sorted.slice(0, 5).forEach(([uid, data], idx) => {
      const medals = ["🥇","🥈","🥉","🏋️","💪"];
      msg += `${medals[idx]} <@${uid}> - ✅ ${data.yes} | ❌ ${data.no}\n`;
    });

    await leaderboardChannel.send({ content: msg });
    // Reset weekly data (like normal weekly job)
    for (const uid in fitnessWeekly) fitnessWeekly[uid] = { yes: 0, no: 0 };
    saveWeekly();
    message.reply("Check-in test completed: weekly snapshot posted to #leaderboard and weekly data reset.");
    return;
  }

  // ------------------ OpenAI Response with Personality ------------------
  if (["tips and guide", "wealth", "health", "faith", "fitness"].includes(channelName)) {
    const userMemory = {
      lastMessage: message.content,
      previousMessages: memory[channelName][user]?.slice(-5) || []
    };

    const personaPrompt = () => {
      const basePersona = `
You are GymBotBro, a disciplined, stoic, God-fearing mentor with military-level strength and a strategic mindset.
Always give advice with authority, clarity, and motivation.
`;

      let channelTraits = "";
      switch (channelName) {
        case "faith":
          channelTraits = `
Encourage the user spiritually, provide prayerful guidance, and reinforce Christian faith.
Include Bible references, practical advice for daily struggles, and empathetic encouragement.
Speak with warmth and conviction, making the user feel personally supported and guided by God.
`;
          break;
        case "wealth":
          channelTraits = `
Provide strategic financial guidance, investment insight, and entrepreneurial motivation.
Focus on actionable steps and discipline in building wealth.
`;
          break;
        case "health":
          channelTraits = `
Offer disciplined health, wellness, and lifestyle advice to improve daily habits.
Encourage consistency, nutrition, and mental well-being.
`;
          break;
        case "fitness":
          channelTraits = `
Encourage consistent workouts, celebrate progress, and push resilience and discipline.
Provide actionable fitness tips and maintain motivation.
`;
          break;
        case "tips and guide":
          channelTraits = `
Provide tactical advice, life hacks, and motivational guidance tailored to real-life challenges.
Focus on clarity and practical steps the user can implement immediately.
`;
          break;
        default:
          channelTraits = `
Respond with authority, clarity, and actionable advice.
`;
      }

      const context = userMemory.previousMessages.length
        ? `Consider the user's previous messages for context: ${userMemory.previousMessages.join(" | ")}`
        : "";

      return `${basePersona}\n${channelTraits}\n${context}\nUser message: "${userMemory.lastMessage}"\nRespond concisely, authoritatively, motivatingly, and for faith, make it warm, empathetic, and scripture-based.`;
    };

    try {
      const response = await getOpenAIResponse(personaPrompt());
      return message.reply(response);
    } catch (err) {
      console.error("OpenAI Response Error:", err);
      return message.reply("❌ Something went wrong while generating a response.");
    }
  }
});

// ------------------ Login ------------------
client.login(process.env.DISCORD_TOKEN);
