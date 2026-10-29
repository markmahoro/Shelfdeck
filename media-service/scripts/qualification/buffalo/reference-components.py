"""Export deterministic preprocessing oracles without loading recognition models."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from insightface.utils.face_align import norm_crop, estimate_norm

root = Path("/reference")
out = Path("/output/components")
out.mkdir(exist_ok=False)
report = json.loads((root / "reference.json").read_text())
items = []
for name in ["original-0", "original-1", "two-people", "rolled-35"]:
    case = next(item for item in report["cases"] if item["name"] == name)
    raw = np.frombuffer((root / case["rawFile"]).read_bytes(), dtype=np.uint8).reshape(case["height"], case["width"], 3)
    ratio = case["height"] / case["width"]
    width, height = (int(640 / ratio), 640) if ratio > 1 else (640, int(640 * ratio))
    resized = cv2.resize(raw, (width, height))
    (out / (name + "-resized.rgb")).write_bytes(resized.tobytes())
    item = {"name": name, "width": width, "height": height}
    if name != "rolled-35":
        landmarks = np.array(case["faces"][0]["landmarks"], dtype=np.float32)
        aligned = norm_crop(raw, landmarks)
        (out / (name + "-aligned.rgb")).write_bytes(aligned.tobytes())
        item["transform"] = estimate_norm(landmarks).tolist()
    else:
        rotation = case["faces"][0]["box"]["rotation_applied"]
        rotated = np.array(Image.fromarray(raw).rotate(rotation, expand=True))
        (out / (name + "-rotated.rgb")).write_bytes(rotated.tobytes())
        item.update({"rotation": rotation, "rotatedWidth": rotated.shape[1], "rotatedHeight": rotated.shape[0]})
    items.append(item)
(out / "components.json").write_text(json.dumps(items, indent=2))
print(json.dumps({"componentCases": len(items)}))
