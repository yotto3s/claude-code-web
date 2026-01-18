# Claude Code Web Server
FROM node:20-alpine

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application source
COPY . .

# Create directories with open permissions (container runs as host user)
RUN mkdir -p /app/data/environment /home/node && \
    chmod -R 777 /app/data /home/node

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
