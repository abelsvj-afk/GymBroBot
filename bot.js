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
  ]
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 3000;

// Data storage
let memory = {};
let birthdays = {};
let fitnessWeekly = {};
let fitnessMonthly = {};
let partnerQueue = [];
let partners = {};
let strikes = {};
let habitTracker = {};
let challenges = {};

// File paths
const dataDir = './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const memoryFile = path.join(dataDir, 'memory.json');
const birthdaysFile = path.join(dataDir, 'birthdays.json');
const weeklyFile = path.join(dataDir, 'weekly.json');
const monthlyFile = path.join(dataDir, 'monthly.json');
const partnerQueueFile = path.join(dataDir, 'partnerQueue.json');
const partnersFile = path.join(dataDir, 'partners.json');
const strikesFile = path.join(dataDir, 'strikes.json');
const habitsFile = path.join(dataDir, 'habits.json');
const challengesFile = path.join(dataDir, 'challenges.json');

// Save/Load functions
function saveMemory() {
  try {
    fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
  } catch (e) {
    console.error("Error saving memory:", e);
  }
}

function loadMemory() {
  try {
    if (fs.existsSync(memoryFile)) {
      memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
    }
  } catch (e) {
    console.error("Error loading memory:", e);
    memory = {};
  }
}

function saveWeekly() {
  try {
    fs.writeFileSync(weeklyFile, JSON.stringify(fitnessWeekly, null, 2));
  } catch (e) {
    console.error("Error saving weekly data:", e);
  }
}

function loadWeekly() {
  try {
    if (fs.existsSync(weeklyFile)) {
      fitnessWeekly = JSON.parse(fs.readFileSync(weeklyFile, 'utf8'));
    }
  } catch (e) {
    console.error("Error loading weekly data:", e);
    fitnessWeekly = {};
  }
}

function saveHabits() {
  try {
    fs.writeFileSync(habitsFile, JSON.stringify(habitTracker, null, 2));
  } catch (e) {
    console.error("Error saving habits:", e);
  }
}

function loadHabits() {
  try {
    if (fs.existsSync(habitsFile)) {
      habitTracker = JSON.parse(fs.readFileSync(habitsFile, 'utf8'));
    }
  } catch (e) {
    console.error("Error loading habits:", e);
    habitTracker = {};
  }
}

function loadData() {
  loadMemory();
  loadWeekly();
  loadHabits();
  console.log("Data loaded successfully");
}

// Express server
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    status: 'GymBotBro is running!', 
    uptime: process.uptime(),
    guilds: client.guilds.cache.size,
    users: client.users.cache.size
  });
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

// OpenAI function
async function getOpenAIResponse(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    });
    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error("OpenAI API error:", error);
    return "I'm having trouble thinking right now. Try again in a moment.";
  }
}

// Command handlers
const commandHandlers = {
  async help(message) {
    const embed = new EmbedBuilder()
      .setTitle("🏋️ GymBotBro Commands")
      .setDescription("Your accountability partner for fitness and life!")
      .addFields(
        { name: "🎯 Fitness", value: "`!track yes/no` - Log workout\n`!progress` - View stats\n`!leaderboard` - Rankings", inline: true },
        { name: "📈 Habits", value: "`!addhabit [habit]` - Track habit\n`!habits` - View habits\n`!check [habit]` - Check off", inline: true },
        { name: "💪 Coaching", value: "`!coach [question]` - Get advice\n`!quote` - Motivation\n`!workoutplan` - Get workout", inline: true }
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
    return message.reply(`🏋️ **Your Workout Plan:**\n\n${workout}\n\n*Rest 60-90 seconds between sets*`);
  }
};

// Message handler
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

// Daily motivation (9 AM)
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

// Weekly reset (Sunday midnight)
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

// Bot ready
client.once("clientready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("!help for commands");
  loadData();
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

// Start bot
client.login(process.env.DISCORD_TOKEN);
