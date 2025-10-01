#!/bin/bash

# GymBroBot Deployment Script
# This script helps deploy the bot to various platforms

set -e

echo "🤖 GymBroBot Deployment Script"
echo "=============================="

# Check if we're in the right directory
if [ ! -f "bot.js" ]; then
    echo "❌ Error: bot.js not found. Please run this script from the project root."
    exit 1
fi

# Check if environment variables are set
check_env_vars() {
    local missing_vars=()

    if [ -z "$DISCORD_TOKEN" ]; then
        missing_vars+=("DISCORD_TOKEN")
    fi

    if [ -z "$OPENAI_API_KEY" ]; then
        missing_vars+=("OPENAI_API_KEY")
    fi

    if [ -z "$MONGO_URI" ]; then
        missing_vars+=("MONGO_URI")
    fi

    if [ ${#missing_vars[@]} -gt 0 ]; then
        echo "❌ Missing required environment variables:"
        printf '   - %s\n' "${missing_vars[@]}"
        echo "Please set these variables before deploying."
        exit 1
    fi

    echo "✅ All required environment variables are set"
}

# Run tests
run_tests() {
    echo "🧪 Running tests..."

    # Syntax check
    echo "   Checking syntax..."
    node --check bot.js

    # Command tests
    echo "   Testing commands..."
    npm run test:commands

    echo "✅ All tests passed"
}

# Deploy to Railway
deploy_railway() {
    echo "🚂 Deploying to Railway..."

    # Check if Railway CLI is installed
    if ! command -v railway &> /dev/null; then
        echo "❌ Railway CLI not found. Installing..."
        npm install -g @railway/cli
    fi

    # Login to Railway (will prompt if not logged in)
    railway login

    # Link to project (will prompt to select if not linked)
    railway link

    # Deploy
    railway up

    echo "✅ Deployed to Railway"
}

# Deploy to Heroku
deploy_heroku() {
    echo "🟣 Deploying to Heroku..."

    # Check if Heroku CLI is installed
    if ! command -v heroku &> /dev/null; then
        echo "❌ Heroku CLI not found. Please install it first."
        exit 1
    fi

    # Check if logged in
    if ! heroku auth:whoami &> /dev/null; then
        echo "Please login to Heroku first:"
        heroku login
    fi

    # Create app if it doesn't exist
    read -p "Enter your Heroku app name (or press Enter to create new): " app_name

    if [ -n "$app_name" ]; then
        heroku git:remote -a "$app_name"
    else
        heroku create
    fi

    # Set environment variables
    echo "Setting environment variables..."
    heroku config:set DISCORD_TOKEN="$DISCORD_TOKEN"
    heroku config:set OPENAI_API_KEY="$OPENAI_API_KEY"
    heroku config:set MONGO_URI="$MONGO_URI"
    heroku config:set CLIENT_ID="$CLIENT_ID"

    if [ -n "$GUILD_ID" ]; then
        heroku config:set GUILD_ID="$GUILD_ID"
    fi

    # Deploy
    git push heroku main

    echo "✅ Deployed to Heroku"
}

# Build Docker image
build_docker() {
    echo "🐳 Building Docker image..."

    docker build -t gymbotbro:latest .

    echo "✅ Docker image built successfully"
    echo "To run locally: docker run --env-file .env -p 3000:3000 gymbotbro:latest"
}

# Main menu
main() {
    echo ""
    echo "Choose deployment option:"
    echo "1. Railway (Recommended)"
    echo "2. Heroku"
    echo "3. Docker build only"
    echo "4. Run tests only"
    echo "5. Check environment variables"
    echo ""
    read -p "Enter your choice (1-5): " choice

    case $choice in
        1)
            check_env_vars
            run_tests
            deploy_railway
            ;;
        2)
            check_env_vars
            run_tests
            deploy_heroku
            ;;
        3)
            run_tests
            build_docker
            ;;
        4)
            run_tests
            ;;
        5)
            check_env_vars
            ;;
        *)
            echo "❌ Invalid choice. Please run the script again."
            exit 1
            ;;
    esac

    echo ""
    echo "🎉 Deployment complete!"
    echo "Don't forget to check the deployment logs and test the bot in Discord."
}

# Load environment variables from .env if it exists
if [ -f ".env" ]; then
    echo "📋 Loading environment variables from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
fi

# Run main function
main
