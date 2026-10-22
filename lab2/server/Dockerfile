FROM node:22-alpine
WORKDIR /app

# Сначала только package*.json — слой с зависимостями кэшируется, пока они не меняются
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/app/uploads
EXPOSE 4000
CMD ["node", "src/index.js"]
