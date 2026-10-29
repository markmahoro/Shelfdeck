"""Offline qualification oracle; never imported by the ShelfDeck runtime."""
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import sqlite3
import time

os.environ["NO_ALBUMENTATIONS_UPDATE"] = "1"
os.environ["MPLCONFIGDIR"] = "/tmp/matplotlib"
os.environ["OPENBLAS_NUM_THREADS"] = "1"

import numpy as np
from PIL import Image
from usearch.index import Index
from embeddings import FaceEmbeddingGenerator, load_image
from matching import MatchingConfig, match_face


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def main():
    root = Path("/qualification")
    output = Path(os.environ.get("BUFFALO_REFERENCE_OUTPUT", "/output/reference"))
    output.mkdir(exist_ok=False)
    catalogue = Path("/catalogue")
    policy = json.loads((root / "engine/parity-policy.json").read_text())
    manifest = json.loads((catalogue / "manifest.json").read_text())
    if manifest["version"] != policy["databaseVersion"]:
        raise RuntimeError("CATALOGUE_GENERATION_CHANGED")
    print("VERIFYING_CATALOGUE", flush=True)
    for name, expected in manifest["checksums"].items():
        if digest(catalogue / name) != expected.removeprefix("sha256:"):
            raise RuntimeError("CATALOGUE_CHECKSUM_CHANGED:" + name)
    for item in policy["models"]:
        model = catalogue / "models/models/buffalo_l" / item["file"]
        if model.stat().st_size != item["bytes"] or digest(model) != item["sha256"]:
            raise RuntimeError("MODEL_CHECKSUM_CHANGED")
    db = sqlite3.connect("file:/catalogue/performers.db?mode=ro&immutable=1", uri=True)
    index = Index(ndim=512, metric="cos")
    index.view(str(catalogue / "face_embeddings.usearch"))
    print("AUDITING_INDEX_KEYS", flush=True)
    # IndexedKeys scalar access scans an internal key map; use its bulk slice.
    keys = set(int(key) for key in index.keys[:])
    sqlite_keys = set(row[0] for row in db.execute("SELECT embedding_index FROM faces WHERE embedding_index IS NOT NULL"))
    index_missing = sorted(keys - sqlite_keys)
    metadata_missing = sorted(sqlite_keys - keys)
    audit = {"manifestFaces": manifest["face_count"], "indexFaces": len(index),
             "sqliteFaces": len(sqlite_keys), "indexWithoutSqlite": index_missing[:20],
             "indexWithoutSqliteCount": len(index_missing), "sqliteWithoutIndex": metadata_missing[:20],
             "sqliteWithoutIndexCount": len(metadata_missing),
             "sqliteIntegrity": db.execute("PRAGMA integrity_check").fetchone()[0],
             "genderCounts": db.execute("SELECT gender,COUNT(*) FROM performers GROUP BY gender").fetchall()}
    (output / "catalogue-audit.json").write_text(json.dumps(audit, indent=2))
    print(json.dumps({"catalogueAudit": audit}), flush=True)
    del keys, sqlite_keys
    gc.collect()
    faces_mapping = json.loads((catalogue / "faces.json").read_text())
    performers = json.loads((catalogue / "performers.json").read_text())
    yaws = json.loads((catalogue / "face_yaw.json").read_text())
    groups = json.loads((catalogue / "performer_links.json").read_text())
    links = {uid: [other for other in group if other != uid] for group in groups for uid in group}
    aliases = json.loads((catalogue / "aliases.json").read_text())
    inputs = []
    originals = []
    for number in range(3):
        raw = load_image((root / f"sample-{number}.image").read_bytes())
        originals.append(raw)
        inputs.append((f"original-{number}", raw))
        smaller = Image.fromarray(raw).resize((max(1, raw.shape[1] // 2), max(1, raw.shape[0] // 2)))
        inputs.append((f"smaller-{number}", np.array(smaller)))
    inputs.append(("rolled-35", np.array(Image.fromarray(originals[0]).rotate(35, expand=True))))
    inputs.append(("mirrored", np.array(Image.fromarray(originals[0]).transpose(Image.Transpose.FLIP_LEFT_RIGHT))))
    canvas = Image.new("RGB", (1200, 700))
    for number in range(2):
        portrait = Image.fromarray(originals[number])
        portrait.thumbnail((600, 700))
        canvas.paste(portrait, (number * 600, 0))
    inputs.append(("two-people", np.array(canvas)))
    inputs.append(("blank", np.zeros((640, 640, 3), dtype=np.uint8)))
    inputs.append(("noise", np.random.RandomState(22029).randint(0, 256, (640, 640, 3), dtype=np.uint8)))
    generator = FaceEmbeddingGenerator(device="cpu", models_dir=catalogue / "models")
    generator.face_analyzer
    config = MatchingConfig(query_k=100, max_results=5, max_distance=0.6)
    report = {"policyDigest": digest(root / "engine/parity-policy.json"), "packages": {
        name: importlib.metadata.version(name) for name in
        ["insightface", "onnxruntime", "opencv-python-headless", "numpy", "usearch", "Pillow", "scikit-image"]},
        "audit": audit, "cases": []}
    for name, raw in inputs:
        started = time.perf_counter()
        raw_file = name + ".rgb"
        (output / raw_file).write_bytes(raw.tobytes())
        Image.fromarray(raw).save(output / (name + ".png"))
        detected = generator.detect_faces(raw, min_confidence=0.5)
        case = {"name": name, "rawFile": raw_file, "width": raw.shape[1], "height": raw.shape[0],
                "sha256": digest(output / raw_file), "faces": []}
        for face in detected:
            if face.bbox["w"] < 40 or face.bbox["h"] < 40:
                continue
            vector = face.embedding
            nearest = index.search(vector, 100)
            result = match_face(vector, index, faces_mapping, performers, config,
                                face_yaw=yaws, performer_link_index=links, endpoint_priority_domains=[],
                                aliases=aliases, prefer_western_names=False)
            case["faces"].append({"box": face.bbox, "confidence": face.confidence,
                                  "landmarks": face.landmarks.tolist(), "vector": vector.tolist(),
                                  "raw": [{"key": int(key), "distance": float(distance)}
                                          for key, distance in zip(nearest.keys, nearest.distances)],
                                  "matches": [{"key": item.face_index, "uid": item.universal_id,
                                               "name": item.name, "distance": item.distance,
                                               "combinedDistance": item.combined_distance}
                                              for item in result.matches]})
        case["elapsedMs"] = (time.perf_counter() - started) * 1000
        report["cases"].append(case)
        print(json.dumps({"case": name, "faces": len(case["faces"]), "elapsedMs": case["elapsedMs"]}), flush=True)
    report["maximumRssKiB"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    (output / "reference.json").write_text(json.dumps(report, indent=2))
    db.close()
    print(json.dumps({"completed": len(report["cases"]), "maximumRssKiB": report["maximumRssKiB"]}), flush=True)


if __name__ == "__main__":
    main()
