# Claude Code Web Server
FROM node:20-alpine

# Install build dependencies for node-pty and Claude CLI
RUN apk add --no-cache python3 make g++ bash bash-completion curl git

# Install Starship prompt
RUN sh -c "$(curl -fsSL https://starship.rs/install.sh)" -- --yes

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
RUN mkdir -p /app/data/environment /home/node/.config && \
    chmod -R 777 /app/data /home/node

# Copy starship configuration
COPY starship.toml /home/node/.config/starship.toml
RUN chmod 644 /home/node/.config/starship.toml

# Configure bash with starship and completions
RUN echo 'export STARSHIP_CONFIG=/home/node/.config/starship.toml' >> /etc/bash.bashrc && \
    echo 'export STARSHIP_CACHE=/tmp/starship' >> /etc/bash.bashrc && \
    echo 'eval "$(starship init bash 2>/dev/null)"' >> /etc/bash.bashrc && \
    echo '[ -f /usr/share/bash-completion/bash_completion ] && source /usr/share/bash-completion/bash_completion' >> /etc/bash.bashrc && \
    echo 'export PS1="\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "' >> /etc/bash.bashrc.fallback && \
    echo 'if command -v starship >/dev/null 2>&1; then eval "$(starship init bash 2>/dev/null)"; else source /etc/bash.bashrc.fallback; fi' > /etc/profile.d/starship.sh && \
    chmod +x /etc/profile.d/starship.sh

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
