FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev deps after build to keep image small
RUN npm prune --omit=dev

# Data directory for persistent cache
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
