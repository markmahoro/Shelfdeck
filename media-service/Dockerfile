# Stage 1: Build admin web UI
FROM node:20-alpine AS web-builder
WORKDIR /build/web
COPY media-service/web/package.json media-service/web/package-lock.json ./
RUN npm ci
COPY media-service/web/ ./
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

# Intel Media Driver for QSV/VAAPI and Intel OpenCL runtime for OpenVINO GPU inference.
RUN apt-get update && apt-get install -y --no-install-recommends \
    intel-media-va-driver mesa-va-drivers libvulkan1 mesa-vulkan-drivers vulkan-tools \
    intel-opencl-icd clinfo p7zip-full python3 python3-venv make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY media-service/package.json media-service/package-lock.json ./
RUN npm ci --omit=dev --omit=optional \
    && npm install --omit=dev --no-save @img/sharp-linux-x64@0.35.2 @img/sharp-libvips-linux-x64@1.3.1

COPY media-worker/face-service ./face-service
COPY media-service/face-service-requirements.txt ./face-service-requirements.txt
RUN python3 -m venv /opt/shelfdeck-face \
  && /opt/shelfdeck-face/bin/python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /opt/shelfdeck-face/bin/python -m pip install --no-cache-dir -r /app/face-service-requirements.txt

COPY media-service/src/ ./src/
COPY media-service/scripts/v3-data-migration.js ./scripts/v3-data-migration.js
COPY media-service/scripts/helix-data-preflight.js ./scripts/helix-data-preflight.js
COPY media-service/scripts/kairox-beta-cutover.js ./scripts/kairox-beta-cutover.js
COPY media-service/scripts/kairox-beta-production-e2e.js ./scripts/kairox-beta-production-e2e.js
COPY media-service/scripts/all-in-one-supervisor.py /usr/local/bin/shelfdeck-all-in-one
COPY --from=web-builder /build/dist/admin ./dist/admin/

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 18080
ENV MEDIA_SERVICE_PORT=18080
ENV MEDIA_SERVICE_DATA_DIR=/app/data
# Use linuxserver's full-featured ffmpeg instead of npm's ffmpeg-static (CPU-only)
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe
ENV FACE_EMBEDDINGS_URL=http://127.0.0.1:19110/v1/face/embeddings
ENV FACE_MODEL_DIR=/app/data/face-models
ENV FACE_ONNX_PROVIDER=OpenVINOExecutionProvider
ENV FACE_OPENVINO_DEVICE=AUTO:GPU,CPU

# Clear inherited ENTRYPOINT from linuxserver/ffmpeg base image
ENTRYPOINT []
CMD ["/opt/shelfdeck-face/bin/python", "/usr/local/bin/shelfdeck-all-in-one"]
