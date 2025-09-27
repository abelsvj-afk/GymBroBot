# GymBotBro

This repository contains `bot.js`, a Discord bot that provides fitness accountability, partner matching, AI coaching, and automated content posting. The bot integrates with OpenAI and optionally stores AI telemetry in MongoDB.

## Quick status
- Ensure `OPENAI_API_KEY` and `DISCORD_TOKEN` are configured before starting the bot.
- Optional: `MONGO_URI` to persist audit logs to MongoDB (Atlas or Railway plugin).
- Default AI model is `gpt-3.5-turbo` unless you set `OPENAI_MODEL`.

## Running locally (development)
1. Install dependencies:

```powershell
npm install
```

2. Create a `.env` file in the repo root with the following keys (example):

```
OPENAI_API_KEY=sk-...
DISCORD_TOKEN=bot-token-here
OPENAI_MODEL=gpt-3.5-turbo
FALLBACK_OPENAI_MODEL=gpt-3.5-turbo
MONGO_URI=mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/mydb
BOT_OWNER_ID=your-discord-id
```

3. Syntax-check the bot (quick):

```powershell
node --check bot.js
```

4. Start the bot:

```powershell
node bot.js
```

Notes:
- If you run the bot locally and want to test admin commands, use an account with Administrator rights in a test server and set `BOT_OWNER_ID` if you want owner-only privileges.

## Railway and Mongo

- Railway provides a plugin to host MongoDB for you. When you add the MongoDB plugin to a Railway project, Railway deploys a managed MongoDB instance and exposes a connection string. To use it:
  1. Open your Railway project dashboard.
  2. Click the MongoDB plugin/resource you added.
  3. In the plugin details you will see a connection string or Environment Variable — copy that value and paste it into the `MONGO_URI` environment variable for your service.
  4. Restart the Railway service.

- The bot writes audit logs to `data/ai_health.json` locally. If `MONGO_URI` is set, the bot also writes the same events to the `ai_health` collection in MongoDB.

### Do I need a separate Mongo account?

- Not necessarily. Railway offers a MongoDB plugin that provisions a managed MongoDB instance for your project. If you added that plugin, Railway will have deployed a Mongo instance for you and exposed a connection string.
- Check your Railway project under the Plugins/Resources section. If you see MongoDB listed there and it shows "deployed" or similar, Railway has already provisioned it. Click it and find the connection string. Use that as `MONGO_URI`.
- Alternatively, you can sign up for MongoDB Atlas (free tier) and create a cluster yourself. Both options work.

### How to wire Railway's Mongo to this bot
1. In Railway project, open the MongoDB plugin/resource you created.
2. Find the connection string — Railway usually shows it as an environment variable or a URI. Copy it.
3. In your Railway Service, open Environment Variables and add `MONGO_URI` with that connection string value.
4. Restart the Railway service.

### How to use the admin dashboard (quick)

- Set `ADMIN_DASH_SECRET` in Railway env variables (pick a strong random string). For local testing, add it to `.env`.
- Visit: `https://<your-railway-service-url>/admin/ai-health?secret=<ADMIN_DASH_SECRET>`
- Or via curl (JSON):

```powershell
curl -H "Accept: application/json" "https://<your-railway-service-url>/admin/ai-health?secret=<ADMIN_DASH_SECRET>&n=50"
```

- The dashboard shows recent `ai_health` events from Mongo (if connected) or the local `data/ai_health.json` fallback.

If you want, I can add a small login or GitHub-Auth protected page, but for now the secret-based route is a simple lightweight solution.

## Admin commands (in Discord)
- `!setmodel <model> [--save] [--force]` — change primary model at runtime. `--save` writes to `.env` in the repo (local only). `--force` bypasses validation.
- `!setfallback <model> [--save]` — change fallback model.
- `!getmodel` — show current and fallback models.
- `!testai` — quick AI health check (60s cooldown per guild).
- `!getaihealth [N]` — show recent AI telemetry (admins only).

## CI and deployment notes

- The repository contains a GitHub Actions CI workflow that runs `npm install` and `node --check bot.js` on push/PR to catch syntax issues.
- A lightweight automation is provided to create a GitHub issue on every push to `main` reminding you to set environment variables in Railway. This is a safer alternative to giving a bot direct access to your Railway API keys.

## Security

- Never commit real API keys to the repository. Use Railway environment variables in production. The `.env` file is for local testing only.

## Troubleshooting

- If AI features fail, check `data/ai_health.json`, the pinned message in `#logging` in your server, and the logs in Railway.

If you want, I can add a small admin web dashboard to view `ai_health` entries (requires a backing persistent store and simple authentication).
# GymBroBot

A Discord bot for fitness accountability, workout tracking, and gym community management.

## Features

- **Daily Check-ins**: Track your workout progress with daily check-ins
- **Accountability Partners**: Get paired with accountability partners to stay motivated
- **Fitness Leaderboard**: Compete with others on the fitness leaderboard
- **AI Coaching**: Get personalized coaching advice using OpenAI integration
- **Birthday Tracking**: Never miss a community member's birthday
- **Habit Tracking**: Track your fitness habits and streaks
- **Fitness Challenges**: Create and participate in community fitness challenges
- **Role Rewards**: Earn special roles based on your fitness achievements
- **Sports Updates**: Get the latest news on sports, MMA, and boxing
- **Health News**: Daily health news updates
- **Wealth Tips**: Daily financial advice for overall well-being

## Setup

### Prerequisites

- Node.js 20.x
- Discord Bot Token
- OpenAI API Key
- (Optional) News API Key
- (Optional) YouTube API Key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/abelsvj-afk/GymBroBot.git
cd GymBroBot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
NEWS_API_KEY=your_news_api_key (optional)
YOUTUBE_API_KEY=your_youtube_api_key (optional)
```

4. Start the bot:
```bash
npm start
```

## Discord Server Setup

For optimal functionality, create the following channels in your Discord server:

- `#general` - General chat and birthday announcements
- `#welcome` - Welcome new members
- `#announcements` - Important bot announcements
- `#daily-check-ins` - For workout check-ins
- `#tips-and-guide` - Fitness tips and guides
- `#faith` - Faith-based discussions
- `#mens-style` - Style advice
- `#open-up` - Mental health support
- `#health` - Health news and discussions
- `#wealth` - Financial advice
- `#sports` - Sports updates
- `#fitness` - Fitness discussions
- `#leaderboard` - Automated fitness leaderboard
- `#accountability-lounge` - For finding accountability partners

## Commands

### General Commands
- `!coach [topic]` - Get AI coaching advice on a specific topic
- `!progress` - View your fitness progress stats

### Partner System
- `/partner queue` - Join the accountability partner queue
- `/partner cancel` - Cancel your partner queue request
- `/partner end` - End your current partner pairing
- `/partner status` - Check the partner queue status
- `!findpartner` - Alternative to join the partner queue
- `!endpartner` - End your current partner pairing (in partner channel)

### Birthday System
- `setbirthday MM-DD` - Set your birthday for reminders

### Moderation Commands
- `/strike add @user [reason]` - Add a strike to a user (mod only)
- `/strike check @user` - Check a user's strikes (mod only)
- `/strike clear @user` - Clear a user's strikes (mod only)

### Challenge System
- `!challenge create [challenge text]` - Create a new fitness challenge
- `!challenge join [challenge ID]` - Join an existing challenge
- `!challenges` - List all active challenges

## Deployment

This bot is designed to be deployed on platforms like Railway, Heroku, or any other Node.js hosting service.

### Railway Deployment
1. Connect your GitHub repository to Railway
2. Add the required environment variables
3. Deploy the main branch

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.