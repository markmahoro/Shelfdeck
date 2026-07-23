# Build the frozen Admin Web.
FROM node:20-bookworm AS web-builder
WORKDIR /build/web
COPY media-service/web/package.json media-service/web/package-lock.json ./
RUN npm ci
COPY media-service/web/ ./
RUN npm run build

# linuxserver/ffmpeg supplies the service-local FFmpeg/FFprobe runtime.
# Keep this base free of a build toolchain: the final image must only contain
# the service runtime, never the former Python/worker face stack.
FROM linuxserver/ffmpeg:latest AS service-base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
      intel-media-va-driver mesa-va-drivers libvulkan1 mesa-vulkan-drivers \
      intel-opencl-icd \
    && rm -rf /var/lib/apt/lists/*

# better-sqlite3 currently needs node-gyp fallback on Node 20.  Compile all
# native modules in a disposable stage built from the exact same runtime base
# so the copied binaries retain ABI compatibility without shipping Python,
# make, or a compiler in the service image.
FROM service-base AS service-dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY media-service/package.json media-service/package-lock.json ./
RUN npm ci --omit=dev

FROM service-base AS service-runtime
WORKDIR /app

# The FFmpeg base carries a distro Python interpreter even though this service
# does not.  Native modules were already compiled in service-dependencies, so
# remove the interpreter/runtime from the final image instead of retaining a
# latent Python execution surface.
RUN rm -f /usr/bin/python /usr/bin/python3 /usr/bin/python3.* \
    && rm -rf /usr/lib/python3 /usr/lib/python3.* /usr/share/python3 /usr/share/doc/python3* \
    && find /usr/local -maxdepth 3 -iname '*python*' -exec rm -rf {} +

COPY media-service/package.json media-service/package-lock.json ./
COPY --from=service-dependencies /app/node_modules ./node_modules
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
