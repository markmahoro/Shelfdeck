import base64
import os
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


# ─── Request/response models ────────────────────────────────────────────────

class ImagePayload(BaseModel):
    imageId: str = ""
    imageIndex: int = 0
    data: str
    mimeType: str = "image/jpeg"


class EmbeddingsRequest(BaseModel):
    images: List[ImagePayload]
    detect: bool = True
    returnCrops: bool = True
    # Faces whose embedding cosine-similarity >= blacklistThreshold against any
    # supplied blacklist embedding are dropped (dismissed actors). Optional.
    blacklist: Optional[List[List[float]]] = None
    blacklistThreshold: float = 0.5


app = FastAPI(title="ShelfDeck Face Embeddings", version="2.0.0")

# Lazy-loaded singletons (SCRFD detector + ArcFace recognizer).
detector_session: Optional[ort.InferenceSession] = None
recognizer_session: Optional[ort.InferenceSession] = None
session_providers: List[str] = []

# SCRFD det_10g uses 3 strides (8, 16, 32) with 2 anchors per location.
_STRIDES = (8, 16, 32)
_NUM_ANCHORS = 2
_DET_INPUT = int(os.environ.get("FACE_DET_SIZE", "640"))

# ArcFace (w600k_r50) alignment template — InsightFace standard 5-point ref.
_ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


# ─── Model resolution ────────────────────────────────────────────────────────

def model_dir() -> Path:
    return Path(os.environ.get("FACE_MODEL_DIR", "/data/face-models"))


def recognizer_path() -> Path:
    return model_dir() / "w600k_r50.onnx"


def detector_path() -> Path:
    return model_dir() / "det_10g.onnx"


def ensure_models() -> None:
    """Extract det_10g.onnx + w600k_r50.onnx from buffalo_l if missing."""
    det = detector_path()
    rec = recognizer_path()
    if det.exists() and det.stat().st_size > 1024 * 1024 and rec.exists() and rec.stat().st_size > 1024 * 1024:
        return
    model_dir().mkdir(parents=True, exist_ok=True)
    zip_path = model_dir() / "buffalo_l.zip"
    if not zip_path.exists():
        url = os.environ.get(
            "FACE_MODEL_URL",
            "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
        )
        urllib.request.urlretrieve(url, zip_path)
    wanted = {"det_10g.onnx", "w600k_r50.onnx"}
    with zipfile.ZipFile(zip_path) as zf:
        for name in wanted:
            out = model_dir() / name
            if out.exists() and out.stat().st_size > 1024 * 1024:
                continue
            member = next((n for n in zf.namelist() if n.endswith(name)), "")
            if not member:
                raise RuntimeError(f"{name} not found in face model archive")
            with zf.open(member) as src, out.open("wb") as dst:
                dst.write(src.read())


def resolve_providers() -> List[Any]:
    """Resolve ONNX Runtime providers.

    Service all-in-one uses OpenVINO on Intel hosts (FACE_OPENVINO_DEVICE
    defaults to AUTO:GPU,CPU). Worker all-in-one can still select CUDA via env.
    """
    available = ort.get_available_providers()
    preferred = os.environ.get("FACE_ONNX_PROVIDER", "OpenVINOExecutionProvider").strip()
    providers: List[Any] = []
    if preferred and preferred in available:
        if preferred == "OpenVINOExecutionProvider":
            options: Dict[str, str] = {
                "device_type": os.environ.get("FACE_OPENVINO_DEVICE", "AUTO:GPU,CPU"),
            }
            cache_dir = os.environ.get("FACE_OPENVINO_CACHE_DIR", "")
            if cache_dir:
                options["cache_dir"] = cache_dir
            providers.append((preferred, options))
        else:
            providers.append(preferred)
    if "CPUExecutionProvider" in available:
        providers.append("CPUExecutionProvider")
    if not providers:
        providers = available
    require_gpu = os.environ.get("FACE_REQUIRE_GPU", "false").lower() in {"1", "true", "yes"}
    if require_gpu and "CUDAExecutionProvider" not in providers:
        raise RuntimeError(f"CUDAExecutionProvider is required but unavailable; providers={available}")
    return providers


def create_session(model_path: Path) -> ort.InferenceSession:
    providers = resolve_providers()
    try:
        return ort.InferenceSession(str(model_path), providers=providers)
    except Exception as exc:
        print(f"ONNX provider initialization failed for {model_path.name}: {exc}", flush=True)
        if providers != ["CPUExecutionProvider"] and "CPUExecutionProvider" in ort.get_available_providers():
            print(f"falling back to CPUExecutionProvider for {model_path.name}", flush=True)
            return ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        raise


def get_detector() -> ort.InferenceSession:
    global detector_session
    if detector_session is None:
        ensure_models()
        detector_session = create_session(detector_path())
    return detector_session


def get_recognizer() -> ort.InferenceSession:
    global recognizer_session
    if recognizer_session is None:
        ensure_models()
        recognizer_session = create_session(recognizer_path())
    return recognizer_session


# ─── Image decoding ──────────────────────────────────────────────────────────

def decode_image(data: str) -> np.ndarray:
    try:
        raw = base64.b64decode(data.split(",", 1)[-1], validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {exc}") from exc
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Image decode failed")
    return image


# ─── SCRFD detection ─────────────────────────────────────────────────────────
# Minimal, dependency-free SCRFD post-processing for det_10g (9-output variant:
# per-stride scores + bbox deltas + 5 landmark deltas). Produces axis-aligned
# bboxes ranked by score, plus the 5 landmarks used for ArcFace alignment.

def detect_faces(image: np.ndarray, max_faces: int = 8, score_thresh: float = 0.5) -> List[Dict[str, Any]]:
    """Run SCRFD on the image, return [{bbox, kps, score}] sorted by area desc."""
    sess = get_detector()
    input_name = sess.get_inputs()[0].name

    ih, iw = image.shape[:2]
    # Letterbox-resize to DET square input.
    scale = _DET_INPUT / max(ih, iw)
    resized = cv2.resize(image, (int(iw * scale), int(ih * scale))
                         if max(ih, iw) != _DET_INPUT
                         else (iw, ih))
    rh, rw = resized.shape[:2]
    padded = np.full((_DET_INPUT, _DET_INPUT, 3), 0, dtype=np.uint8)
    padded[:rh, :rw] = resized

    blob = cv2.dnn.blobFromImage(padded, 1.0 / 128.0, (_DET_INPUT, _DET_INPUT), (127.5, 127.5, 127.5), swapRB=True)
    outputs = sess.run(None, {input_name: blob})

    # Decode using anchors aligned to the padded input.
    detections = _decode_scrfd_clean(outputs, _DET_INPUT, score_thresh)
    if not detections:
        return []

    # NMS + map back to original image coords.
    boxes = np.array([d["bbox"] for d in detections], dtype=np.float32)
    scores = np.array([d["score"] for d in detections], dtype=np.float32)
    kps = np.array([d["kps"] for d in detections], dtype=np.float32).reshape(-1, 5, 2)

    # Scale padded coords -> resized coords -> original coords.
    sx = iw / rw
    sy = ih / rh
    boxes[:, 0::2] *= sx
    boxes[:, 1::2] *= sy
    kps[:, :, 0] *= sx
    kps[:, :, 1] *= sy

    keep_idx = _nms(boxes, scores, iou_thresh=0.4)
    keep_idx = sorted(keep_idx, key=lambda i: (boxes[i][2] - boxes[i][0]) * (boxes[i][3] - boxes[i][1]), reverse=True)[:max_faces]

    results = []
    for i in keep_idx:
        x1, y1, x2, y2 = boxes[i]
        results.append({
            "bbox": [float(max(0, x1)), float(max(0, y1)), float(min(iw, x2)), float(min(ih, y2))],
            "kps": kps[i].tolist(),
            "score": float(scores[i]),
        })
    return results


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _normalize_scores(raw: np.ndarray) -> np.ndarray:
    """Return SCRFD scores as probabilities.

    Some exported SCRFD models emit probabilities, while others emit logits.
    Applying sigmoid unconditionally to probability outputs turns near-zero
    background scores into ~0.5, which floods detection with false faces.
    """
    scores = raw.reshape(-1).astype(np.float32)
    if scores.size and float(np.nanmin(scores)) >= 0.0 and float(np.nanmax(scores)) <= 1.0:
        return scores
    return _sigmoid(scores)


def _decode_scrfd_clean(outputs: List[np.ndarray], input_size: int, score_thresh: float) -> List[Dict[str, Any]]:
    """Decode SCRFD det_10g outputs.

    det_10g emits 9 tensors in three contiguous groups by stride (8,16,32):
      [0..2]  scores   shape (H*W*2, 1)  — raw logits, need sigmoid
      [3..5]  bboxes   shape (H*W*2, 4)  — [dx1,dy1,dx2,dy2]*stride from anchor center
      [6..8]  kps      shape (H*W*2, 10) — 5 landmarks (dx,dy)*stride from anchor center
    Anchor count per location is 2 (_NUM_ANCHORS).
    """
    scores_parts = []
    bbox_parts = []
    kps_parts = []
    anchor_parts = []

    for level in range(3):
        stride = _STRIDES[level]
        fsize = input_size // stride
        # anchor centers: repeat each cell 2x (2 anchors per location)
        ys = (np.arange(fsize) * stride + stride // 2)
        xs = (np.arange(fsize) * stride + stride // 2)
        gx, gy = np.meshgrid(xs, ys)
        centers = np.stack([gx, gy], axis=-1).reshape(-1, 2).astype(np.float32)
        centers = np.repeat(centers, _NUM_ANCHORS, axis=0)  # (fsize*fsize*2, 2)

        scores = _normalize_scores(outputs[level])           # (fsize*fsize*2,)
        bboxes = outputs[3 + level].reshape(-1, 4) * stride  # already matches centers length
        kps = outputs[6 + level].reshape(-1, 10) * stride

        keep = scores > score_thresh
        scores_parts.append(scores[keep])
        bbox_parts.append(bboxes[keep])
        kps_parts.append(kps[keep])
        anchor_parts.append(centers[keep])

    if not scores_parts or sum(len(s) for s in scores_parts) == 0:
        return []

    scores = np.concatenate(scores_parts)
    bboxes = np.concatenate(bbox_parts)
    kps = np.concatenate(kps_parts)
    anchors = np.concatenate(anchor_parts)

    # bbox deltas are distances from anchor center: [left, top, right, bottom].
    x1 = anchors[:, 0] - bboxes[:, 0]
    y1 = anchors[:, 1] - bboxes[:, 1]
    x2 = anchors[:, 0] + bboxes[:, 2]
    y2 = anchors[:, 1] + bboxes[:, 3]

    landmarks = np.empty((len(scores), 5, 2), dtype=np.float32)
    lm = kps.reshape(-1, 5, 2)
    for j in range(5):
        landmarks[:, j, 0] = anchors[:, 0] + lm[:, j, 0]
        landmarks[:, j, 1] = anchors[:, 1] + lm[:, j, 1]

    out = []
    for i in range(len(scores)):
        out.append({
            "bbox": [float(x1[i]), float(y1[i]), float(x2[i]), float(y2[i])],
            "kps": landmarks[i].tolist(),
            "score": float(scores[i]),
        })
    return out


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float) -> List[int]:
    """Greedy NMS on [x1,y1,x2,y2] boxes."""
    if len(boxes) == 0:
        return []
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        union = areas[i] + areas[rest] - inter
        iou = np.divide(inter, union, out=np.zeros_like(inter), where=union > 0)
        order = rest[iou <= iou_thresh]
    return keep


# ─── ArcFace alignment + embedding ───────────────────────────────────────────

def _align_face(image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    """Affine-warp to the standard ArcFace 112x112 template using 5 landmarks."""
    src = landmarks.astype(np.float32)
    # Estimate a partial affine transform from src -> dst, then warp.
    transform, _ = cv2.estimateAffinePartial2D(src, _ARCFACE_DST, method=cv2.LMEDS)
    if transform is None:
        # Fallback: simple crop+resize if alignment fails.
        return cv2.resize(image, (112, 112), interpolation=cv2.INTER_AREA)
    return cv2.warpAffine(image, transform, (112, 112), borderValue=0.0)


def embed_aligned(aligned: np.ndarray) -> List[float]:
    """Run ArcFace on an already 112x112 aligned BGR face."""
    rgb = cv2.cvtColor(aligned, cv2.COLOR_BGR2RGB).astype(np.float32)
    blob = np.transpose((rgb - 127.5) / 127.5, (2, 0, 1))[None, :, :, :]
    sess = get_recognizer()
    input_name = sess.get_inputs()[0].name
    output = sess.run(None, {input_name: blob})[0][0].astype(np.float32)
    norm = np.linalg.norm(output)
    if norm > 0:
        output = output / norm
    return [float(x) for x in output.tolist()]


def cosine(a: List[float], b: List[float]) -> float:
    av = np.asarray(a, dtype=np.float32)
    bv = np.asarray(b, dtype=np.float32)
    if av.size == 0 or bv.size == 0 or av.size != bv.size:
        return 0.0
    na = np.linalg.norm(av)
    nb = np.linalg.norm(bv)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(av, bv) / (na * nb))


# ─── Encoding helpers ────────────────────────────────────────────────────────

def crop_to_base64(image: np.ndarray, bbox: List[float]) -> str:
    x1, y1, x2, y2 = [int(v) for v in bbox]
    h, w = image.shape[:2]
    x1 = max(0, min(x1, w)); x2 = max(0, min(x2, w))
    y1 = max(0, min(y1, h)); y2 = max(0, min(y2, h))
    if x2 <= x1 or y2 <= y1:
        return ""
    crop = image[y1:y2, x1:x2]
    ok, encoded = cv2.imencode(".jpg", crop)
    return base64.b64encode(encoded.tobytes()).decode("ascii") if ok else ""


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/v1/health")
def health() -> Dict[str, Any]:
    ready = detector_path().exists() and recognizer_path().exists()
    return {
        "ok": True,
        "detector": "scrfd-det_10g",
        "recognizer": "arcface-w600k_r50",
        "detInput": _DET_INPUT,
        "modelsReady": ready,
        "availableProviders": ort.get_available_providers(),
        "activeProviders": detector_session.get_providers() if detector_session else [],
    }


@app.post("/v1/face/embeddings")
def embeddings(req: EmbeddingsRequest) -> Dict[str, Any]:
    if not req.images:
        raise HTTPException(status_code=400, detail="images is required")

    blacklist = req.blacklist or []
    bl_thresh = float(req.blacklistThreshold or 0.5)

    rows: List[Dict[str, Any]] = []
    for image_idx, payload in enumerate(req.images):
        image = decode_image(payload.data)
        detections = detect_faces(image) if req.detect else [{
            "bbox": [0.0, 0.0, float(image.shape[1]), float(image.shape[0])],
            "kps": None,
            "score": 1.0,
        }]
        for face_idx, det in enumerate(detections):
            bbox = det["bbox"]
            kps = det.get("kps")
            if kps is not None:
                aligned = _align_face(image, np.asarray(kps, dtype=np.float32))
            else:
                aligned = cv2.resize(image, (112, 112), interpolation=cv2.INTER_AREA)
            embedding = embed_aligned(aligned)

            # Blacklist filter: drop dismissed actors so they never reach the
            # service's protagonist-decision step.
            blacklisted = any(cosine(embedding, bl) >= bl_thresh for bl in blacklist) if blacklist else False
            if blacklisted:
                continue

            row = {
                "faceId": f"{payload.imageId or image_idx}-{face_idx}",
                "clusterId": f"{payload.imageId or image_idx}-{face_idx}",
                "imageId": payload.imageId,
                "imageIndex": payload.imageIndex,
                "bbox": [float(x) for x in bbox],
                "detectionScore": float(det.get("score", 0.0)),
                "confidence": float(det.get("score", 0.0)),
                "embedding": embedding,
            }
            if req.returnCrops:
                row["sampleImageBase64"] = crop_to_base64(image, bbox)
            rows.append(row)

    return {"faces": rows}
