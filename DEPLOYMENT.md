# GymBroBot Deployment Guide

## 🚀 Current Status
- ✅ Bot tested and working locally
- ✅ All 24 commands functioning  
- ✅ MongoDB connection stable
- ✅ OpenAI integration active
- ✅ Syntax errors resolved
- ✅ Latest code pushed to main branch

## 🔧 Environment Variables Required

### Essential Variables:
```
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
MONGO_URI=your_mongodb_connection_string
CLIENT_ID=your_discord_client_id
GUILD_ID=your_discord_guild_id (optional)
```

### Optional Variables:
```
NEWS_API_KEY=your_news_api_key
YOUTUBE_API_KEY=your_youtube_api_key
GITHUB_TOKEN=your_github_token
THESPORTSDB_KEY=your_sports_api_key
PORT=3000
OPENAI_MODEL=gpt-3.5-turbo
FALLBACK_OPENAI_MODEL=gpt-3.5-turbo
ADMIN_DASH_SECRET=your_admin_secret
BOT_OWNER_ID=your_discord_user_id
```

## 🚂 Railway Deployment (Recommended)

### Step 1: Connect Repository
1. Go to [Railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `GymBroBot` repository
4. Choose the `main` branch

### Step 2: Configure Environment Variables
In Railway dashboard:
1. Go to your project → Variables tab
2. Add all required environment variables from above
3. **Important**: Use the same values from your `.env` file

### Step 3: Set Start Command
In Railway settings:
- **Start Command**: `node bot.js`
- **Root Directory**: `/` (default)

### Step 4: Deploy
- Railway will automatically deploy when you push to main
- Monitor logs in Railway dashboard

## 🐳 Docker Deployment (Alternative)

### Create Dockerfile:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "bot.js"]
```

### Deploy with Docker:
```bash
docker build -t gymbotbro .
docker run -d --env-file .env -p 3000:3000 gymbotbro
```

## ☁️ Heroku Deployment (Alternative)

### Prepare for Heroku:
```bash
# Install Heroku CLI
npm install -g heroku

# Login and create app
heroku login
heroku create your-gymbot-name

# Set environment variables
heroku config:set DISCORD_TOKEN=your_token
heroku config:set OPENAI_API_KEY=your_key
# ... add all other variables

# Deploy
git push heroku main
```

## 🔍 Health Monitoring

### Built-in Health Endpoints:
- `GET /health` - Basic health check
- `GET /admin/ai-health?secret=YOUR_SECRET` - AI system status
- Bot includes automatic health monitoring and alerts

### Key Metrics to Monitor:
- Bot uptime and restart frequency
- MongoDB connection status  
- OpenAI API response times
- Discord API rate limits
- Memory usage and performance

## 🧪 Testing Deployment

### Local Testing:
```bash
npm run test:commands  # Test all commands
npm run health:cli     # Health check
npm start              # Start bot
```

### Production Testing:
1. Verify bot appears online in Discord
2. Test basic commands: `/fitness track yes`
3. Check admin panel: `/admin health`
4. Monitor logs for errors

## 🔧 Troubleshooting

### Common Issues:
1. **Bot offline**: Check DISCORD_TOKEN validity
2. **Commands not working**: Verify bot permissions in Discord
3. **Database errors**: Check MONGO_URI connection
4. **AI failures**: Verify OPENAI_API_KEY and model availability

### Debug Mode:
Set `DEBUG_COMMANDS=1` environment variable for detailed logging.

## 📊 Post-Deployment Checklist

- [ ] Bot shows online in Discord server
- [ ] All slash commands registered successfully  
- [ ] Database connection established
- [ ] OpenAI integration working
- [ ] Health monitoring active
- [ ] Admin commands functional
- [ ] Scheduled tasks running (fitness posts, etc.)
- [ ] Error logging operational

## 🔄 Continuous Deployment

The bot includes GitHub Actions that:
- Run tests on pull requests
- Deploy automatically to Railway on main branch pushes
- Create reminders to verify environment variables

## 📞 Support

If you encounter issues:
1. Check Railway/deployment platform logs
2. Verify all environment variables are set
3. Test locally first with same environment
4. Check Discord bot permissions and scopes