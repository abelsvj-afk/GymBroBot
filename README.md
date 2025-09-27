# GymBotBro

A comprehensive Discord bot for fitness accountability, workout tracking, habit building, and gym community management.

## Features

### Core Functionality
- **Fitness Tracking**: Log workouts, track progress, and view leaderboards
- **Habit Building**: Create and track daily habits with streak monitoring
- **Coaching**: Get personalized fitness advice and workout plans
- **Motivation**: Receive motivational quotes and daily encouragement
- **Birthday Tracking**: Never miss a community member's birthday
- **Fitness Challenges**: Create and participate in community fitness challenges
- **Role Rewards**: Earn special roles based on your fitness achievements
- **Sports Updates**: Get the latest news on sports, MMA, and boxing

### Partner System
- **Goal Partners**: Get matched with accountability partners based on fitness goals
- **Future Partners**: Connect with potential partners through incremental information reveal
- **Private Channels**: Automatically created for matched partners
- **Strike System**: Enforce community guidelines with a three-strike policy

### Channel-Specific Features
- **Daily Check-ins**: Automated reminders throughout the day
- **Health Channel**: Daily posts about natural healing and alternative health information
- **Wealth Channel**: Daily wealth-building tips and strategies
- **Fitness Channel**: Daily workout tips and video recommendations

## Commands

### Fitness Commands
- `!track yes/no` - Log your daily workout
- `!progress` - View your workout statistics
- `!leaderboard` - See the community workout leaderboard
- `!workoutplan [type]` - Get a workout plan (general, push, pull, legs)

### Habit Commands
- `!addhabit [habit]` - Start tracking a new habit
- `!habits` - View all your tracked habits
- `!check [habit]` - Mark a habit as completed for today

### Coaching Commands
- `!coach [question]` - Ask for fitness advice
- `!quote` - Get a motivational quote

### Partner Commands
- `!partner goal` - Find an accountability partner
- `!partner future` - Find a future partner
- `!leavequeue` - Exit the partner matching queue

### Check-in Commands
- `!mutecheck [day/week/forever]` - Mute check-in reminders
- `!unmutecheck` - Unmute check-in reminders

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

### General Commands
- `!help` - Display all available commands

## Setup

### Prerequisites
- Node.js 16.x or higher
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
PORT=3000
```

4. Start the bot:
```bash
node bot.js
```

### Discord Server Setup
For optimal functionality, set up the following channels:
- `#general` - For daily motivation and general chat
- `#welcome` - Welcome new members
- `#announcements` - Important bot announcements
- `#daily-check-ins` - For workout check-in reminders
- `#tips-and-guides` - Fitness tips and guides
- `#faith` - Faith-based discussions
- `#mens-style` - Style advice
- `#open-up` - Mental health support
- `#health` - For health content and discussions
- `#wealth` - For wealth tips and financial advice
- `#fitness` - For fitness content and discussions
- `#sports` - Sports updates
- `#leaderboard` - For community rankings
- `#accountability-lounge` - For community support

## Documentation
- [User Guide](docs/user_guide.md) - Guide for server members
- [Deployment Guide](docs/deployment_guide.md) - Instructions for deploying the bot
- [Testing Strategy](docs/testing_strategy.md) - Comprehensive testing approach

## Content
The bot includes curated content for automated posting:
- Health topics focusing on natural healing and alternative health information
- Wealth-building tips and strategies
- Fitness content with workout tips and video recommendations

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

## Acknowledgments
- Built with Discord.js
- Powered by OpenAI's GPT models
- Developed for fitness communities and accountability groups