FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    WORKER_PORT=19000 \
    WORKER_TEMP_ROOT=/tmp/shelfdeck-worker \
    WORKER_AI_DATA_ROOT=/data/ai

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY config.example.json ./config.example.json

EXPOSE 19000
CMD ["node", "src/server.js"]
