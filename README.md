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