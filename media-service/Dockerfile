# Build the frozen Admin Web.
FROM node:20-bookworm AS node-runtime
FROM node-runtime AS web-builder
WORKDIR /build/web
COPY media-service/web/package.json media-service/web/package-lock.json ./
RUN npm ci
COPY media-service/web/ ./
RUN npm run build

# Minimal CUDA 13 + cuDNN 9 runtime shared libraries required by
# onnxruntime-node@1.30.0 CUDA EP (host injects libcuda.so.1 via NVIDIA runtime).
FROM nvidia/cuda:13.5.0-cudnn-runtime-ubuntu24.04 AS cuda-runtime
RUN mkdir -p /opt/onnxruntime-cuda \
    && for dir in /usr/local/cuda/lib64 /usr/lib/x86_64-linux-gnu; do \
         [ -d "$dir" ] || continue; \
         for pattern in 'libcudart.so.1[23]' 'libcublas.so.1[23]' 'libcublasLt.so.1[23]' 'libcurand.so.10' 'libcufft.so.1[012]' 'libnvrtc.so.1[23]' 'libnvrtc-builtins.so*' 'libnvJitLink.so.1[23]' 'libcudnn*.so.9'; do \
           for f in "$dir"/$pattern; do \
             [ -e "$f" ] && cp -L "$f" /opt/onnxruntime-cuda/ || true; \
           done; \
         done; \
       done \
    && ln -sf libcudnn.so.9 /opt/onnxruntime-cuda/libcudnn.so \
    && ln -sf libnvrtc.so.13 /opt/onnxruntime-cuda/libnvrtc.so \
    && test -e /opt/onnxruntime-cuda/libcudart.so.13 \
    && test -e /opt/onnxruntime-cuda/libcublas.so.13 \
    && test -e /opt/onnxruntime-cuda/libcublasLt.so.13 \
    && test -e /opt/onnxruntime-cuda/libcurand.so.10 \
    && test -e /opt/onnxruntime-cuda/libcudnn.so.9 \
    && test -e /opt/onnxruntime-cuda/libcudnn.so

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
ARG ONNXRUNTIME_NODE_INSTALL=cuda12
RUN GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE="" ONNXRUNTIME_NODE_INSTALL=${ONNXRUNTIME_NODE_INSTALL} npm ci --omit=dev \
    && rm -rf node_modules/onnxruntime-node/bin/napi-v6/win32 \
              node_modules/onnxruntime-node/bin/napi-v6/darwin \
              node_modules/onnxruntime-node/bin/napi-v6/linux/arm64 \
              node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt.so
COPY media-service/resources/face-models ./resources/face-models
COPY media-service/resources/buffalo-models ./resources/buffalo-models
COPY media-service/src/helix/contracts/us-adult-face-model-pack.json ./src/helix/contracts/us-adult-face-model-pack.json
COPY media-service/src/helix/contracts/buffalo-model-pack.json ./src/helix/contracts/buffalo-model-pack.json
COPY media-service/scripts/install-face-models.js ./scripts/install-face-models.js
COPY media-service/scripts/install-buffalo-models.js ./scripts/install-buffalo-models.js
RUN node scripts/install-face-models.js \
  && node scripts/install-buffalo-models.js

FROM service-base AS service-runtime
WORKDIR /app

# Sharp's bundled text renderer still needs the system Fontconfig configuration
# to discover the installed Latin and CJK fonts.
# Distro ffmpeg provides /usr/bin/ffprobe for MPEG-TS/MKV probing (unpinned so
# CI apt stays reliable), while linuxserver/ffmpeg remains at /usr/local/bin/ffmpeg
# for encoding.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig ffmpeg \
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
COPY --from=cuda-runtime /opt/onnxruntime-cuda/ /usr/local/lib/onnxruntime-cuda/
RUN echo "/usr/local/lib/onnxruntime-cuda" > /etc/ld.so.conf.d/onnxruntime-cuda.conf \
    && ldconfig \
    && test -f /app/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so \
    && ! (ldd /app/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so | grep 'not found' | grep -v 'libcuda\.so\.1')
COPY --from=service-dependencies /app/resources/face-models ./resources/face-models
COPY --from=service-dependencies /app/resources/buffalo-models ./resources/buffalo-models
# linuxserver/ffmpeg builds crash on some MPEG-TS streams and lack modern probe
# paths, while distro /usr/bin/ffprobe must prefer system shared libraries over
# /usr/local/lib to avoid symbol-version collisions. Keep /usr/local/bin/ffprobe
# as the configured FFPROBE_PATH wrapper entrypoint.
RUN printf '%s\n' '#!/bin/sh' 'export LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' 'exec /usr/bin/ffprobe "$@"' > /usr/local/bin/ffprobe \
    && chmod 0755 /usr/local/bin/ffprobe
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
