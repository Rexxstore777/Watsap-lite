FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev && npm rebuild better-sqlite3

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]