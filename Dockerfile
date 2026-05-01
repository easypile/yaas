FROM node:22-alpine AS runtime
WORKDIR /app

COPY package.json server.js ./
COPY data ./data

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "server.js"]
