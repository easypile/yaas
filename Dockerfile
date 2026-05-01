FROM node:20-alpine AS runtime
WORKDIR /app

# Downgrade npm to v9 to avoid npm 10.x crash on Alpine Linux
# See: https://github.com/npm/cli/issues/4769
RUN npm install -g npm@9

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY server.js template.html favicon.svg ./
COPY data ./data
COPY docs ./docs

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "server.js"]
