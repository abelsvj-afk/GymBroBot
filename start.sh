#!/bin/bash

# Railway startup script for GymBroBot
# Ensures all services are ready before health checks pass

echo "Starting GymBroBot..."
echo "Node version: $(node --version)"
echo "Port: ${PORT:-3000}"

# Check if required environment variables are set
if [ -z "$DISCORD_TOKEN" ]; then
  echo "ERROR: DISCORD_TOKEN is not set"
  exit 1
fi

if [ -z "$OPENAI_API_KEY" ]; then
  echo "ERROR: OPENAI_API_KEY is not set"
  exit 1
fi

if [ -z "$MONGO_URI" ]; then
  echo "ERROR: MONGO_URI is not set"
  exit 1
fi

echo "Environment variables validated ✓"
echo "Starting bot..."

# Start the bot
exec node bot.js
