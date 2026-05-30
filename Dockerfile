FROM node:20-alpine
RUN apk add --no-cache openssh-client
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN [ -f /app/deploy_key ] && chmod 600 /app/deploy_key || true
EXPOSE 5000
CMD ["node", "server.js"]
