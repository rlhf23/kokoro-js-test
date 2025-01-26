
FROM node:20-slim

# Install FFmpeg and other dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create a directory for input/output files
RUN mkdir -p /data

# Set the working directory for input/output files
VOLUME /data
WORKDIR /data

ENTRYPOINT ["node", "/app/kokoro-js-test.mjs"]
