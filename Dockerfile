FROM node:22-alpine AS runtime
WORKDIR /app

COPY package.json server.js template.html favicon.svg ./
COPY data ./data
COPY docs ./docs

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "server.js"]
