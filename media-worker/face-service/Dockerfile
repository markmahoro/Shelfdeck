FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    INSIGHTFACE_HOME=/models/insightface \
    FACE_MODEL_NAME=buffalo_l \
    FACE_DET_SIZE=640

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip setuptools wheel \
  && pip install -r requirements.txt

COPY app.py ./

EXPOSE 19110

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "19110"]
