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
# Use the lockfile-pinned service probe on both supported platforms. The base
# FFprobe 8.1 omits HEVC VUI primaries/transfer that the pinned artifact observes.
# Keep the configured executable path and preserve unknown-media rejection.
RUN node -e "const fs=require('fs'),source=require('@ffprobe-installer/ffprobe').path,target='/usr/local/bin/ffprobe'; fs.unlinkSync(target); fs.copyFileSync(source,target); fs.chmodSync(target,0o755);"
COPY media-service/src/server.js ./src/server.js
COPY media-service/src/admin-credential-secret-store.js ./src/admin-credential-secret-store.js
COPY media-service/src/clean-service-host.js ./src/clean-service-host.js
COPY media-service/src/clean-admin-static.js ./src/clean-admin-static.js
COPY media-service/src/clean-runtime-operations.js ./src/clean-runtime-operations.js
COPY media-service/src/clean-formation-reset-port.js ./src/clean-formation-reset-port.js
COPY media-service/src/clean-arca-inventory-port.js ./src/clean-arca-inventory-port.js
COPY media-service/src/clean-arca-recycle-port.js ./src/clean-arca-recycle-port.js
COPY media-service/src/clean-arca-target-commit-slot.js ./src/clean-arca-target-commit-slot.js
COPY media-service/src/clean-compute-device-runtime.js ./src/clean-compute-device-runtime.js
COPY media-service/src/clean-ffmpeg-process-registry.js ./src/clean-ffmpeg-process-registry.js
COPY media-service/src/clean-field-access-binding-probe.js ./src/clean-field-access-binding-probe.js
COPY media-service/src/clean-field-observation-enumerator.js ./src/clean-field-observation-enumerator.js
COPY media-service/src/clean-layout-observer.js ./src/clean-layout-observer.js
COPY media-service/src/clean-local-filesystem-mount-probe.js ./src/clean-local-filesystem-mount-probe.js
COPY media-service/src/clean-media-probe.js ./src/clean-media-probe.js
COPY media-service/src/clean-media-production-effect-port.js ./src/clean-media-production-effect-port.js
COPY media-service/src/clean-offdeck-deletion-port.js ./src/clean-offdeck-deletion-port.js
COPY media-service/src/clean-product-production-port.js ./src/clean-product-production-port.js
COPY media-service/src/clean-shelf-target-folder-probe.js ./src/clean-shelf-target-folder-probe.js
COPY media-service/src/clean-western-analysis-port.js ./src/clean-western-analysis-port.js
COPY media-service/src/clean-workspace-product-port.js ./src/clean-workspace-product-port.js
COPY media-service/src/clean-workspace-root-admin.js ./src/clean-workspace-root-admin.js
COPY media-service/src/helix ./src/helix
COPY media-service/scripts/helix-clean-init.js ./scripts/helix-clean-init.js
COPY media-service/scripts/helix-jav-schema-copy.js ./scripts/helix-jav-schema-copy.js
COPY media-service/scripts/helix-libra-schema-copy.js ./scripts/helix-libra-schema-copy.js
COPY media-service/scripts/helix-architecture/libra-workshop-schema-copy.js ./scripts/helix-architecture/libra-workshop-schema-copy.js
COPY media-service/scripts/helix-architecture/jav-release-schema-copy.js ./scripts/helix-architecture/jav-release-schema-copy.js
COPY media-service/scripts/helix-architecture/jav-release-effect-history-proof.js ./scripts/helix-architecture/jav-release-effect-history-proof.js
COPY media-service/scripts/helix-architecture/readonly-history-projections.js ./scripts/helix-architecture/readonly-history-projections.js
COPY media-service/scripts/helix-operational-safety.js ./scripts/helix-operational-safety.js
COPY media-service/scripts/helix-predeck-pipeline-migration.js ./scripts/helix-predeck-pipeline-migration.js
COPY media-service/scripts/helix-formation-reset.js ./scripts/helix-formation-reset.js
COPY media-service/scripts/user-formation-reset.js ./scripts/user-formation-reset.js
COPY media-service/scripts/user-formation-reset-worker.js ./scripts/user-formation-reset-worker.js
COPY media-service/scripts/helix-prod033-execution-residual-repair.js ./scripts/helix-prod033-execution-residual-repair.js
COPY media-service/scripts/helix-prod034-one-time-correction.js ./scripts/helix-prod034-one-time-correction.js
COPY media-service/scripts/helix-prod047-aftercare-reclaim-residual-correction.js ./scripts/helix-prod047-aftercare-reclaim-residual-correction.js
COPY media-service/scripts/helix-prod064-aftercare-placement-incident-correction.js ./scripts/helix-prod064-aftercare-placement-incident-correction.js
COPY media-service/scripts/helix-prod064-aftercare-settlement-residual-correction.js ./scripts/helix-prod064-aftercare-settlement-residual-correction.js
COPY media-service/scripts/helix-observation-storage-compact.js ./scripts/helix-observation-storage-compact.js
COPY media-service/scripts/helix-cifs-mount-probe-correction.js ./scripts/helix-cifs-mount-probe-correction.js
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
