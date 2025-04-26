FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]
