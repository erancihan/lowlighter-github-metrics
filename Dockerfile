# Base image
FROM node:20-bookworm-slim

# Copy repository
COPY . /metrics
WORKDIR /metrics

# Setup
RUN chmod +x /metrics/source/app/action/index.mjs
# Install latest chrome dev package, fonts to support major charsets and skip chromium download on puppeteer install
# Based on https://github.com/GoogleChrome/puppeteer/blob/master/docs/troubleshooting.md#running-puppeteer-in-docker
RUN apt-get update
RUN apt-get install -y build-essential
RUN apt-get install -y wget gnupg ca-certificates libgconf-2-4
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
RUN sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'
RUN apt-get update
RUN apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 libx11-xcb1 libxtst6 lsb-release --no-install-recommends
# Install deno for miscellaneous scripts
RUN apt-get install -y curl unzip 
RUN curl -fsSL https://deno.land/x/install/install.sh | DENO_INSTALL=/usr/local sh 
# Install ruby to support github licensed gem
RUN apt-get install -y ruby-full git g++ cmake pkg-config libssl-dev 
RUN apt-get install -y ruby-dev
RUN gem install licensed 
# Install python for node-gyp
RUN apt-get install -y python3 
# Clean apt/lists
RUN rm -rf /var/lib/apt/lists/* 
# Install node modules and rebuild indexes
RUN npm ci 
RUN npm run build

# Environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV PUPPETEER_BROWSER_PATH "google-chrome-stable"

# Execute GitHub action
ENTRYPOINT node /metrics/source/app/action/index.mjs
