"""Classify and export index-only slots from a previously verified generation."""
import json
import sqlite3
from pathlib import Path
from usearch.index import Index

root = Path("/catalogue")
audit = json.loads(Path("/reference/catalogue-audit.json").read_text())
faces = json.loads((root / "faces.json").read_text())
yaws = json.loads((root / "face_yaw.json").read_text())
db = sqlite3.connect("file:/catalogue/performers.db?mode=ro&immutable=1", uri=True)
unmapped = [key for (key,) in db.execute("SELECT embedding_index FROM faces") if key >= len(faces) or faces[key] is None]
if unmapped:
    raise RuntimeError("LIVE_SQLITE_IDENTITY_MAPPING_MISSING")
index = Index(ndim=512, metric="cos")
index.view(str(root / "face_embeddings.usearch"))
vectors = []
for key in audit["indexWithoutSqlite"]:
    if faces[key] is not None or yaws[key] is not None:
        raise RuntimeError("INDEX_ONLY_SLOT_IS_NOT_EXPLICITLY_NULL")
    vectors.append({"key": key, "vector": index.get(key).tolist()})
Path("/output/retired-slot-vectors.json").write_text(json.dumps(vectors))
print(json.dumps({"liveMappings": sum(value is not None for value in faces), "sqliteMappingsMissing": 0,
                  "explicitNullSlots": [item["key"] for item in vectors]}))
