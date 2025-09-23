// ------------------ Express Keep-Alive Server ------------------
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("GymBotBro is alive!"));
app.listen(process.env.PORT || 3000, () => console.log("Server running"));

// ------------------ Bot Setup ------------------
require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const cron = require('node-cron');
const axios = require('axios');

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
const MEMORY_FILE = './memory.json';
let memory = {};

if (fs.existsSync(MEMORY_FILE)) {
  memory = JSON.parse(fs.readFileSync(MEMORY_FILE));
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ------------------ Helper Functions ------------------
async function getOpenAIResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI Error:', err.response?.data || err.message);
    return 'Sorry, something went wrong.';
  }
}

async function getHealthNews() {
  try {
    const res = await axios.get(
      `https://newsapi.org/v2/top-headlines?category=health&language=en&apiKey=${process.env.NEWS_API_KEY}`
    );
    const articles = res.data.articles;
    if (!articles || articles.length === 0) return 'No health news today.';
    const top = articles[0];
    return `📰 **${top.title}**\n${top.description || ''}\n${top.url}`;
  } catch (err) {
    console.error('News API Error:', err.response?.data || err.message);
    return 'Could not fetch health news.';
  }
}

// ------------------ Bot Ready ------------------
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Daily motivational check-in at 7 AM
  cron.schedule('0 7 * * *', async () => {
    const channel = client.channels.cache.find(ch => ch.name === 'daily-check-in');
    if (channel) await channel.send('💪 Rise and grind! Time for your workout check-in!');
  });

  // Daily wealth tip at 9 AM
  cron.schedule('0 9 * * *', async () => {
    const channel = client.channels.cache.find(ch => ch.name === 'wealth');
    if (channel) {
      const tip = await getOpenAIResponse(
        'Provide a practical daily wealth tip for investing, business, money management, stocks, crypto, life insurance, entrepreneurship, leveraging debt, LLCs, banking, and financial growth.'
      );
      await channel.send(`💰 Daily Wealth Tip:\n${tip}`);
    }
  });

  // Daily health news at 10 AM
  cron.schedule('0 10 * * *', async () => {
    const channel = client.channels.cache.find(ch => ch.name === 'health');
    if (channel) {
      const news = await getHealthNews();
      await channel.send(`🏥 Daily Health News:\n${news}`);
    }
  });
});

// ------------------ Message Handling ------------------
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const channel = message.channel.name;
  const user = message.author.id;

  if (!memory[channel]) memory[channel] = {};
  if (!memory[channel][user]) memory[channel][user] = [];

  memory[channel][user].push(message.content);

  let prompt = '';

  switch (channel) {
    case 'faith':
      prompt = `You are a Christian advisor. Respond ONLY about Christianity, God, Jesus Christ, and the Holy Spirit. Use context from previous messages: ${memory[channel][user].join(' | ')}. Latest: "${message.content}"`;
      break;
    case 'wealth':
      prompt = `You are a financial advisor. Respond to all questions about investing, business, money management, stocks, crypto, life insurance, entrepreneurship, leveraging debt, LLCs, banking, and financial growth. Use context from previous messages: ${memory[channel][user].join(' | ')}. Latest: "${message.content}"`;
      break;
    case 'health':
      prompt = `You are a health advisor. Answer questions about wellness, diet, natural remedies, family and kids health, political health news, and superfoods. Use context from previous messages: ${memory[channel][user].join(' | ')}. Latest: "${message.content}"`;
      break;
    case 'daily-check-in':
      prompt = `You are a motivational gym bro. Respond positively and encourage the user to take action. Latest: "${message.content}"`;
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
