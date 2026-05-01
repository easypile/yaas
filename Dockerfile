FROM node:20-alpine AS runtime
WORKDIR /app

# Downgrade npm to avoid Alpine npm 10.x bugs
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
