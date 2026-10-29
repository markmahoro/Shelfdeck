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
COPY media-service/src/server.js ./src/server.js
COPY media-service/src/clean-poster-renderer.js ./src/clean-poster-renderer.js
COPY media-service/scripts/formation-retirement-history.js ./scripts/formation-retirement-history.js
COPY media-service/scripts/formation-retirement-journal.js ./scripts/formation-retirement-journal.js
COPY media-service/scripts/formation-retirement-operator.js ./scripts/formation-retirement-operator.js
COPY media-service/scripts/formation-retirement-plan.js ./scripts/formation-retirement-plan.js
COPY media-service/scripts/formation-stopped-transcode.js ./scripts/formation-stopped-transcode.js
COPY media-service/scripts/helix-formation-retirement-schema-copy.js ./scripts/helix-formation-retirement-schema-copy.js
COPY media-service/scripts/helix-architecture/formation-retirement-schema-copy.js ./scripts/helix-architecture/formation-retirement-schema-copy.js
COPY media-service/scripts/helix-plan-contract-schema-copy.js ./scripts/helix-plan-contract-schema-copy.js
COPY media-service/scripts/helix-plan-contract-cutover.js ./scripts/helix-plan-contract-cutover.js
COPY media-service/scripts/helix-import-plan-contracts.js ./scripts/helix-import-plan-contracts.js
COPY media-service/scripts/helix-architecture/plan-contract-schema-copy.js ./scripts/helix-architecture/plan-contract-schema-copy.js
COPY media-service/scripts/helix-architecture/plan-contract-import.js ./scripts/helix-architecture/plan-contract-import.js
COPY media-service/scripts/helix-architecture/history-import-bundle.js ./scripts/helix-architecture/history-import-bundle.js
COPY media-service/scripts/helix-architecture/history-evidence ./scripts/helix-architecture/history-evidence
COPY media-service/src/admin-credential-secret-store.js ./src/admin-credential-secret-store.js
COPY media-service/src/clean-service-host.js ./src/clean-service-host.js
COPY media-service/src/clean-admin-static.js ./src/clean-admin-static.js
COPY media-service/src/clean-runtime-operations.js ./src/clean-runtime-operations.js
COPY media-service/src/clean-runtime-supervisor.js ./src/clean-runtime-supervisor.js
COPY media-service/src/clean-generation-lease.js ./src/clean-generation-lease.js
COPY media-service/src/clean-reset-bootstrap.js ./src/clean-reset-bootstrap.js
COPY media-service/src/clean-reset-error-copy.js ./src/clean-reset-error-copy.js
COPY media-service/src/clean-reset-generation-fence.js ./src/clean-reset-generation-fence.js
COPY media-service/src/clean-reset-management-host.js ./src/clean-reset-management-host.js
COPY media-service/src/clean-reset-workflow.js ./src/clean-reset-workflow.js
COPY media-service/src/clean-session-cookies.js ./src/clean-session-cookies.js
COPY media-service/scripts/formation-reset-backup.js ./scripts/formation-reset-backup.js
COPY media-service/scripts/formation-reset-bootstrap.js ./scripts/formation-reset-bootstrap.js
COPY media-service/scripts/formation-reset-cleanup.js ./scripts/formation-reset-cleanup.js
COPY media-service/scripts/formation-reset-cold-backup.js ./scripts/formation-reset-cold-backup.js
COPY media-service/scripts/formation-reset-deployment-backup.js ./scripts/formation-reset-deployment-backup.js
COPY media-service/scripts/formation-reset-copy.js ./scripts/formation-reset-copy.js
COPY media-service/scripts/formation-reset-generation.js ./scripts/formation-reset-generation.js
COPY media-service/scripts/formation-reset-inspect.js ./scripts/formation-reset-inspect.js
COPY media-service/scripts/formation-reset-normalize.js ./scripts/formation-reset-normalize.js
COPY media-service/scripts/formation-reset-offline.js ./scripts/formation-reset-offline.js
COPY media-service/scripts/formation-reset-operator-lease.js ./scripts/formation-reset-operator-lease.js
COPY media-service/scripts/formation-reset-owner-policy.js ./scripts/formation-reset-owner-policy.js
COPY media-service/scripts/formation-reset-people-references.js ./scripts/formation-reset-people-references.js
COPY media-service/scripts/formation-reset-people-recovery.js ./scripts/formation-reset-people-recovery.js
COPY media-service/scripts/formation-reset-people-recovery-run.js ./scripts/formation-reset-people-recovery-run.js
COPY media-service/scripts/formation-reset-owner-retention.json ./scripts/formation-reset-owner-retention.json
COPY media-service/scripts/formation-reset-owner-snapshot.js ./scripts/formation-reset-owner-snapshot.js
COPY media-service/scripts/formation-reset-preflight.js ./scripts/formation-reset-preflight.js
COPY media-service/scripts/formation-reset-process-child.js ./scripts/formation-reset-process-child.js
COPY media-service/scripts/formation-reset-process.js ./scripts/formation-reset-process.js
COPY media-service/scripts/formation-reset-responsibilities.js ./scripts/formation-reset-responsibilities.js
COPY media-service/scripts/formation-reset-runtime-port.js ./scripts/formation-reset-runtime-port.js
COPY media-service/scripts/formation-reset-schema.js ./scripts/formation-reset-schema.js
COPY media-service/scripts/formation-reset-snapshot-digest.js ./scripts/formation-reset-snapshot-digest.js
COPY media-service/scripts/formation-reset-stage.js ./scripts/formation-reset-stage.js
COPY media-service/scripts/formation-reset-storage.js ./scripts/formation-reset-storage.js
COPY media-service/scripts/formation-reset-verify.js ./scripts/formation-reset-verify.js
COPY media-service/scripts/formation-reset-workspace-protection.js ./scripts/formation-reset-workspace-protection.js
COPY media-service/src/clean-maintenance-window.js ./src/clean-maintenance-window.js
COPY media-service/src/clean-people-image-port.js ./src/clean-people-image-port.js
COPY media-service/src/clean-people-artifact-reclamation-port.js ./src/clean-people-artifact-reclamation-port.js
COPY media-service/src/clean-us-adult-frame-extractor.js ./src/clean-us-adult-frame-extractor.js
COPY media-service/src/clean-us-adult-inventory-analysis-port.js ./src/clean-us-adult-inventory-analysis-port.js
COPY media-service/src/clean-formation-reset-port.js ./src/clean-formation-reset-port.js
COPY media-service/src/clean-arca-inventory-port.js ./src/clean-arca-inventory-port.js
COPY media-service/src/clean-series-root-relocation-port.js ./src/clean-series-root-relocation-port.js
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
COPY media-service/scripts/helix-us-adult-schema-copy.js ./scripts/helix-us-adult-schema-copy.js
COPY media-service/scripts/helix-lifecycle-schema-copy.js ./scripts/helix-lifecycle-schema-copy.js
COPY media-service/scripts/helix-series-presentation-schema-copy.js ./scripts/helix-series-presentation-schema-copy.js
COPY media-service/scripts/helix-architecture/series-presentation-schema-copy.js ./scripts/helix-architecture/series-presentation-schema-copy.js
COPY media-service/scripts/helix-architecture/lifecycle-schema-copy.js ./scripts/helix-architecture/lifecycle-schema-copy.js
COPY media-service/scripts/helix-architecture/us-adult-schema-copy.js ./scripts/helix-architecture/us-adult-schema-copy.js
COPY media-service/scripts/helix-architecture/paused-release-batch-proof.js ./scripts/helix-architecture/paused-release-batch-proof.js
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
