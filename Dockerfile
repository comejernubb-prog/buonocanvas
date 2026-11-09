FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs index.html pdf-vector.js v13-core.js backup-utils.mjs ./
COPY tests ./tests
RUN npm test && npm test
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
