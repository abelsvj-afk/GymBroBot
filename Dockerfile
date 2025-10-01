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

# Health check with proper port handling and longer startup time
HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=5 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the bot using the startup script
CMD ["./start.sh"]