FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev deps after build to keep image small
RUN npm prune --omit=dev

RUN apk del python3 make g++

# Data directory for persistent cache
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
