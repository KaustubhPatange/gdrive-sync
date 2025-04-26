FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.js ./
ENV NODE_ENV=production

# Install crond
RUN apk add --no-cache tzdata dcron

# Create log file
RUN touch /var/log/cron.log

# Create entry point script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
