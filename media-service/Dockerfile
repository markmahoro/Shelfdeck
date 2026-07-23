# Build the frozen Admin Web.
FROM node:20-bookworm AS web-builder
WORKDIR /build/web
COPY media-service/web/package.json media-service/web/package-lock.json ./
RUN npm ci
COPY media-service/web/ ./
RUN npm run build

# linuxserver/ffmpeg supplies the service-local FFmpeg/FFprobe runtime.
FROM linuxserver/ffmpeg:latest
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
      intel-media-va-driver mesa-va-drivers libvulkan1 mesa-vulkan-drivers \
      intel-opencl-icd \
    && rm -rf /var/lib/apt/lists/*

COPY media-service/package.json media-service/package-lock.json ./
RUN npm ci --omit=dev
COPY media-service/src/server.js ./src/server.js
COPY media-service/src/clean-service-host.js ./src/clean-service-host.js
COPY media-service/src/admin-credential-secret-store.js ./src/admin-credential-secret-store.js
COPY media-service/src/helix ./src/helix
COPY media-service/scripts/helix-clean-init.js ./scripts/helix-clean-init.js
COPY media-service/scripts/helix-operational-safety.js ./scripts/helix-operational-safety.js
COPY --from=web-builder /build/dist/admin ./dist/admin

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 18080
ENV MEDIA_SERVICE_PORT=18080
ENV MEDIA_SERVICE_DATA_DIR=/app/data
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe

# The deployment must inject SHELFDECK_SECRET_ROOT through its secret facility.
ENTRYPOINT []
CMD ["node", "src/server.js"]
