FROM node:22-slim

RUN apt-get update && apt-get install -y \
  chromium \
  ffmpeg \
  pulseaudio \
  dbus \
  xvfb \
  fonts-liberation \
  fonts-noto-color-emoji \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/dbus

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

COPY src/web/public/ ./dist/web/public/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV WEB_PORT=3000
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
