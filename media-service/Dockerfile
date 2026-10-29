# Build the frozen Admin Web.
FROM node:20-bookworm AS node-runtime
FROM node-runtime AS web-builder
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

# Use the same official Node runtime as the web build. Installing from an
# optional apt repository can silently choose the distribution's older Node.
COPY --from=node-runtime /usr/local/ /usr/local/
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      intel-media-va-driver mesa-va-drivers libvulkan1 mesa-vulkan-drivers \
      intel-opencl-icd fonts-dejavu-core fonts-noto-cjk \
    && node -e "if(Number(process.versions.node.split('.')[0])!==20)throw new Error('Node 20 runtime required');" \
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
RUN ONNXRUNTIME_NODE_INSTALL=skip npm ci --omit=dev
COPY media-service/resources/face-models ./resources/face-models
COPY media-service/src/helix/contracts/us-adult-face-model-pack.json ./src/helix/contracts/us-adult-face-model-pack.json
COPY media-service/scripts/install-face-models.js ./scripts/install-face-models.js
RUN node scripts/install-face-models.js

FROM service-base AS service-runtime
WORKDIR /app

# Sharp's bundled text renderer still needs the system Fontconfig configuration
# to discover the installed Latin and CJK fonts.
# Do not reinstall apt ffmpeg: linuxserver/ffmpeg already provides the encoder;
# the old Ubuntu package pin breaks on current apt (CI).
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*
ENV FONTCONFIG_FILE=/etc/fonts/fonts.conf

# The FFmpeg base carries a distro Python interpreter even though this service
# does not.  Native modules were already compiled in service-dependencies, so
# remove the interpreter/runtime from the final image instead of retaining a
# latent Python execution surface.
RUN rm -f /usr/bin/python /usr/bin/python3 /usr/bin/python3.* \
    && rm -rf /usr/lib/python3 /usr/lib/python3.* /usr/share/python3 /usr/share/doc/python3* \
    && find /usr/local -maxdepth 3 -iname '*python*' -exec rm -rf {} +

COPY media-service/package.json media-service/package-lock.json ./
COPY --from=service-dependencies /app/node_modules ./node_modules
COPY --from=service-dependencies /app/resources/face-models ./resources/face-models
# Use the lockfile-pinned service probe (same as main). Keep configured path.
RUN node -e "const fs=require('fs'),source=require('@ffprobe-installer/ffprobe').path,target='/usr/local/bin/ffprobe'; fs.unlinkSync(target); fs.copyFileSync(source,target); fs.chmodSync(target,0o755);"
# Directory copies avoid Docker "max depth exceeded" from 100+ single-file COPY layers.
COPY media-service/src/ ./src/
COPY media-service/scripts/ ./scripts/
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

# CI retrigger twin for overlay-depth Dockerfile fix
