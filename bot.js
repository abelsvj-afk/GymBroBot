// ------------------ Express Keep-Alive Server ------------------
import express from "express";
const app = express();

app.get("/", (req, res) => res.send("GymBotBro is alive!"));
app.listen(process.env.PORT || 3000, () => console.log("Server running"));

// ------------------ Load Env Variables ------------------
import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// ------------------ Required Modules ------------------
import fs from "fs";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import cron from "node-cron";
import axios from "axios";
import cheerio from "cheerio";
import instagramScraper from "instagram-scraping";

// ------------------ Debug Env Variables ------------------
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "✅ Exists" : "❌ Missing");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ Exists" : "❌ Missing");
console.log("NEWS_API_KEY:", process.env.NEWS_API_KEY ? "✅ Exists" : "❌ Missing");

// ------------------ Validate Critical Variables ------------------
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

// ------------------ Memory ------------------
const MEMORY_FILE = "./conversationmemory.json";
let memory = {};
if (fs.existsSync(MEMORY_FILE)) {
  memory = JSON.parse(fs.readFileSync(MEMORY_FILE));
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ------------------ Birthday Tracking ------------------
const BIRTHDAY_FILE = "./birthdays.json";
let birthdays = {};
if (fs.existsSync(BIRTHDAY_FILE)) {
  birthdays = JSON.parse(fs.readFileSync(BIRTHDAY_FILE));
}

function saveBirthdays() {
  fs.writeFileSync(BIRTHDAY_FILE, JSON.stringify(birthdays, null, 2));
}

// ------------------ Instagram Influencers ------------------
const instagramInfluencers = ["iamchriskabeya", "arturkramer", "magno_scavo"];

async function getLiveInstagramPost(username) {
  try {
    const posts = await instagramScraper.scrapeUserPage(username);
    if (!posts || posts.length === 0) return `No recent posts from @${username}.`;
    const topPost = posts[0];
    const caption = topPost.description || "No caption";
    const url = topPost.url || "";
    return `@${username}: ${caption}\n${url}`;
  } catch (err) {
    console.error(`Error fetching Instagram post for ${username}:`, err.message);
    return `Could not fetch @${username} posts right now.`;
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
    const articles = res.data.articles;
    if (!articles || articles.length === 0) return "No health news today.";
    const top = articles[0];
    return `📰 **${top.title}**\n${top.description || ""}\n${top.url}`;
  } catch (err) {
    console.error("News API Error:", err.response?.data || err.message);
    return "Could not fetch health news.";
  }
}

// ------------------ Combat Sports Helper Functions ------------------
async function getSherdogEvents() {
  try {
    const res = await axios.get("https://www.sherdog.com/events/upcoming");
    const $ = cheerio.load(res.data);
    const events = [];
    $(".event-title").each((i, el) => {
      events.push($(el).text().trim());
    });
    return events.slice(0, 5).join(" | ") || "No upcoming Sherdog events found.";
  } catch (err) {
    console.error("Sherdog Error:", err.message);
    return "Could not fetch Sherdog events.";
  }
}

async function getFightNews() {
  try {
    const res = await axios.get("https://www.fightnews.com/");
    const $ = cheerio.load(res.data);
    const headlines = [];
    $(".headline").each((i, el) => {
      headlines.push($(el).text().trim());
    });
    return headlines.slice(0, 5).join(" | ") || "No FightNews updates found.";
  } catch (err) {
    console.error("FightNews Error:", err.message);
    return "Could not fetch FightNews updates.";
  }
}

async function getBoxRecEvents() {
  try {
    const res = await axios.get("https://boxrec.com/en/events");
    const $ = cheerio.load(res.data);
    const events = [];
    $("table.events tr td.event-name").each((i, el) => {
      events.push($(el).text().trim());
    });
    return events.slice(0, 5).join(" | ") || "No BoxRec events found.";
  } catch (err) {
    console.error("BoxRec Error:", err.message);
    return "Could not fetch BoxRec events.";
  }
}

// ------------------ Bot Ready ------------------
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Daily motivational check-in at 7 AM
  cron.schedule("0 7 * * *", async () => {
    const channel = client.channels.cache.find(ch => ch.name === "daily-check-in");
    if (channel) await channel.send("💪 Rise and grind! Time for your workout check-in!");
  });

  // Daily wealth tip at 9 AM
  cron.schedule("0 9 * * *", async () => {
    const channel = client.channels.cache.find(ch => ch.name === "wealth");
    if (channel) {
      const tip = await getOpenAIResponse(
        "Provide a practical daily wealth tip for investing, business, money management, stocks, crypto, life insurance, entrepreneurship, leveraging debt, LLCs, banking, and financial growth."
      );
      await channel.send(`💰 Daily Wealth Tip:\n${tip}`);
    }
  });

  // Daily health news at 10 AM
  cron.schedule("0 10 * * *", async () => {
    const channel = client.channels.cache.find(ch => ch.name === "health");
    if (channel) {
      const news = await getHealthNews();
      await channel.send(`🏥 Daily Health News:\n${news}`);
    }
  });

  // Combat sports updates multiple times per day (8AM, 12PM, 4PM)
  const fightTimes = ["0 8 * * *", "0 12 * * *", "0 16 * * *"];
  fightTimes.forEach(cronTime => {
    cron.schedule(cronTime, async () => {
      const channel = client.channels.cache.find(ch => ch.name === "sports");
      if (!channel) return;

      const mma = await getSherdogEvents();
      const fightNews = await getFightNews();
      const boxing = await getBoxRecEvents();

      channel.send(`🥊 Combat Sports Update:\nMMA: ${mma}\nFightNews: ${fightNews}\nBoxing: ${boxing}`);
    });
  });

  // Birthday check at 8 AM
  cron.schedule("0 8 * * *", async () => {
    const channel = client.channels.cache.find(ch => ch.name === "general");
    if (!channel) return;

    const today = new Date();
    const todayMonthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    for (const [userID, date] of Object.entries(birthdays)) {
      const birthMonthDay = date.slice(5); // MM-DD
      if (birthMonthDay === todayMonthDay) {
        channel.send(`🎉 Today is <@${userID}>'s birthday! Go shout them a happy birthday! 💪`);
      }
    }
  });
});

// ------------------ Message Handling ------------------
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const channel = message.channel.name;
  const user = message.author.id;

  // Initialize memory
  if (!memory[channel]) memory[channel] = {};
  if (!memory[channel][user]) memory[channel][user] = [];
  memory[channel][user].push(message.content);

  let prompt = "";

  // ------------------ Birthday Command ------------------
  const args = message.content.split(" ");
  if (args[0] === "setbirthday") {
    const date = args[1]; // Expect MM-DD
    if (!date || !/^\d{2}-\d{2}$/.test(date)) {
      return message.reply("Please provide your birthday in MM-DD format, e.g., `setbirthday 09-23`");
    }
    birthdays[user] = `${new Date().getFullYear()}-${date}`;
    saveBirthdays();
    return message.reply(`Got it! Your birthday has been saved as ${date}. 🎉`);
  }

  // ------------------ Channel-specific prompts ------------------
  switch (channel) {
    case "faith":
      prompt = `You are a Christian advisor. Respond ONLY about Christianity, God, Jesus Christ, and the Holy Spirit. Use context from previous messages: ${memory[channel][user].join(" | ")}. Latest: "${message.content}"`;
      break;
    case "wealth":
      prompt = `You are a financial advisor. Respond to all questions about investing, business, money management, stocks, crypto, life insurance, entrepreneurship, leveraging debt, LLCs, banking, and financial growth. Use context from previous messages: ${memory[channel][user].join(" | ")}. Latest: "${message.content}"`;
      break;
    case "health":
      prompt = `You are a health advisor. Answer questions about wellness, diet, natural remedies, family and kids health, political health news, and superfoods. Use context from previous messages: ${memory[channel][user].join(" | ")}. Latest: "${message.content}"`;
      break;
    case "daily-check-in":
      prompt = `You are a motivational gym bro. Respond positively and encourage the user to take action. Latest: "${message.content}"`;
      break;
    case "mens-style":
      const influencerPosts = await Promise.all(instagramInfluencers.map(i => getLiveInstagramPost(i)));
      prompt = `You are a men's style advisor. Base your response on the user's message and the Instagram caption of the selected influencer posts (ignore irrelevant hashtags). Use context from previous messages: ${memory[channel][user].join(" | ")}. Latest: "${message.content}". Influencer posts: ${influencerPosts.join(" | ")}`;
      break;
    case "open-up":
      const recentMessages = Object.values(memory[channel]).flat().slice(-50);
      prompt = `You are a supportive advisor. Help users in the 'open-up' channel talk about personal struggles. Consider recent messages for context: ${recentMessages.join(" | ")}. Latest: "${message.content}"`;
      break;
    case "sports":
      const mma = await getSherdogEvents();
      const fightNews = await getFightNews();
      const boxing = await getBoxRecEvents();
      prompt = `You are a sports analyst. Focus on combat sports (boxing, MMA, Muay Thai) and sprinkle in football/basketball updates. Use recent news:\nMMA: ${mma}\nFightNews: ${fightNews}\nBoxing: ${boxing}\nUser question: "${message.content}"`;
      break;
    default:
      prompt = `You are a friendly assistant. Respond contextually to the user. Latest: "${message.content}"`;
  }

  const reply = await getOpenAIResponse(prompt);
  await message.reply(reply);
  saveMemory();
});

// ------------------ Login ------------------
client.login(process.env.DISCORD_TOKEN);
