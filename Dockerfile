# Use Node.js 24 LTS - latest LTS version
# Using slim (Debian-based) instead of Alpine due to npm compatibility issues
# See: https://github.com/npm/cli/issues/4769
FROM node:24-slim AS base

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Install production dependencies using npm ci for reproducible builds
# npm ci requires package-lock.json and is faster and more reliable than npm install
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy application files
COPY server.js ./
COPY views ./views
COPY public ./public
COPY data ./data
COPY docs ./docs

# Set NODE_ENV to production
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Use non-root user for security
USER node

# Start the application
CMD ["node", "server.js"]
