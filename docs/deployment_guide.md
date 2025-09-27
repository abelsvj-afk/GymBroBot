# GymBotBro Deployment Guide

This guide provides step-by-step instructions for deploying the GymBotBro Discord bot to Railway.

## Prerequisites

Before deploying, ensure you have:

1. A Discord account with a registered application and bot
2. An OpenAI API key
3. A GitHub account connected to Railway
4. The merged GymBotBro repository

## Step 1: Prepare Your Environment Variables

GymBotBro requires the following environment variables:

- `DISCORD_TOKEN`: Your Discord bot token
- `OPENAI_API_KEY`: Your OpenAI API key
- `PORT`: The port for the Express server (default: 3000)

## Step 2: Deploy to Railway

### Option 1: Deploy from GitHub Repository

1. Log in to [Railway](https://railway.app/)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your GymBotBro repository
5. Select the main branch
6. Click "Deploy"

### Option 2: Deploy from CLI

1. Install the Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```

2. Login to Railway:
   ```bash
   railway login
   ```

3. Link to your project:
   ```bash
   railway link
   ```

4. Deploy the project:
   ```bash
   railway up
   ```

## Step 3: Configure Environment Variables in Railway

1. Go to your project in the Railway dashboard
2. Click on the "Variables" tab
3. Add the following variables:
   - `DISCORD_TOKEN`
   - `OPENAI_API_KEY`
   - `PORT` (set to 3000)
4. Click "Save Changes"

## Step 4: Configure Discord Bot Settings

Ensure your Discord bot has the following settings:

1. **Privileged Gateway Intents**:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent

2. **Bot Permissions**:
   - Send Messages
   - Embed Links
   - Attach Files
   - Read Message History
   - Add Reactions
   - Manage Messages
   - Manage Channels
   - Read Messages/View Channels

## Step 5: Invite Bot to Your Server

1. Go to the Discord Developer Portal
2. Select your application
3. Go to the "OAuth2" tab
4. Select "bot" under "Scopes"
5. Select the required permissions:
   - Manage Channels
   - Read Messages/View Channels
   - Send Messages
   - Manage Messages
   - Embed Links
   - Attach Files
   - Read Message History
   - Add Reactions
6. Copy the generated URL and open it in your browser
7. Select your server and authorize the bot

## Step 6: Set Up Discord Server Channels

Ensure your Discord server has the following channels for full functionality:

1. **General Channels**:
   - `#general` (for daily motivation)
   - `#announcements`
   - `#daily-check-ins` (for check-in reminders)
   - `#tips-and-guides`
   - `#mens-style`
   - `#open-up`
   - `#health` (for health content)
   - `#wealth` (for wealth tips)
   - `#fitness` (for fitness content)
   - `#sports`
   - `#leaderboard`
   - `#accountability-lounge`

2. **Voice Channels**:
   - `#general`
   - `#Hype-Room`

3. **Admin Channels**:
   - `#mod`
   - `#admin`
   - `#logging` (for bot logs)

4. **Podcast Category**:
   - `#links`
   - `#pictures`
   - `#videos`
   - `#vlogs`

5. **Welcome Category**:
   - `#welcome`
   - `#rules`

## Step 7: Verify Deployment

1. Check Railway logs to ensure the bot started successfully
2. In your Discord server, type `!help` to verify the bot responds
3. Check that the Express server is running by visiting the Railway-provided URL

## Step 8: Monitor and Maintain

### Monitoring

1. Set up Railway monitoring to track:
   - Memory usage
   - CPU usage
   - Disk usage
   - Uptime

2. Check Discord logs channel for:
   - Strike applications
   - Channel creations/deletions
   - Partner matches

### Maintenance

1. **Regular Backups**:
   - Set up automated backups of the data directory
   - Consider using Railway's volume feature for persistent storage

2. **Updates**:
   - Pull latest changes from the repository
   - Test in a staging environment before deploying to production
   - Deploy during low-usage periods

3. **Scaling**:
   - Monitor resource usage as your server grows
   - Upgrade Railway plan if needed for additional resources

## Troubleshooting

### Bot Not Responding

1. Check Railway logs for errors
2. Verify environment variables are set correctly
3. Ensure bot has proper permissions in Discord
4. Check Discord's status page for API issues

### Data Not Persisting

1. Verify data directory exists and is writable
2. Check for file permission issues
3. Ensure Railway volume is properly configured

### Scheduled Tasks Not Running

1. Check timezone configuration
2. Verify cron expressions are correct
3. Check for errors in task execution logs

### OpenAI API Issues

1. Verify API key is valid
2. Check for rate limiting issues
3. Ensure prompt formatting is correct

## Support and Resources

- Discord.js Documentation: [https://discord.js.org/](https://discord.js.org/)
- Railway Documentation: [https://docs.railway.app/](https://docs.railway.app/)
- OpenAI API Documentation: [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- GymBotBro GitHub Repository: [https://github.com/abelsvj-afk/GymBroBot](https://github.com/abelsvj-afk/GymBroBot)