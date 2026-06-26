# Stage 1: Build admin web UI
FROM node:20-alpine AS web-builder
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Production runtime
# linuxserver/ffmpeg ships a full-featured ffmpeg with NVENC + QSV + VAAPI + AMF + libx265
FROM linuxserver/ffmpeg:latest
WORKDIR /app

# Install Node.js 20 on top of Ubuntu base
RUN apt-get update && apt-get install -y curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Intel Media Driver for QSV (included in linuxserver/ffmpeg but ensure present)
RUN apt-get update && apt-get install -y --no-install-recommends \
    intel-media-va-driver mesa-va-drivers p7zip-full \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional

COPY src/ ./src/
COPY --from=web-builder /build/dist/admin ./dist/admin/

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 18080
ENV MEDIA_SERVICE_PORT=18080
ENV MEDIA_SERVICE_DATA_DIR=/app/data
# Use linuxserver's full-featured ffmpeg instead of npm's ffmpeg-static (CPU-only)
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe

# Clear inherited ENTRYPOINT from linuxserver/ffmpeg base image
ENTRYPOINT []
CMD ["node", "src/server.js"]
