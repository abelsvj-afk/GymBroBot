# Use Node.js 20 LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Expose port (Railway will set PORT env var)
EXPOSE $PORT

# Install curl and bash for health checks and startup script
RUN apk add --no-cache curl bash

# Make start script executable
RUN chmod +x start.sh

# Health check with shorter intervals for Railway
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the bot directly
CMD ["node", "bot.js"]
