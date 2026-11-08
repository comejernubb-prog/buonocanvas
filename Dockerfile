FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs index.html pdf-vector.js ./
COPY tests ./tests
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
