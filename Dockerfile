FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src/ ./src/

ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "src/index.js"]
