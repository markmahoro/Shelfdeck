import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


children = []


def log(message: str) -> None:
    print(f"[shelfdeck] {time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}", flush=True)


def env_default(key: str, value: str) -> str:
    if not os.environ.get(key):
        os.environ[key] = value
    return os.environ[key]


def wait_http(url: str, name: str, timeout_sec: int = 120) -> None:
    deadline = time.time() + timeout_sec
    last_error = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as res:
                if 200 <= res.status < 500:
                    log(f"{name} is ready")
                    return
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
        time.sleep(1)
    raise RuntimeError(f"{name} did not become ready at {url}: {last_error}")


def start(cmd, *, cwd=None, stdout=None):
    log(f"starting: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=stdout or sys.stdout, stderr=subprocess.STDOUT)
    children.append(proc)
    return proc


def extend_face_library_path() -> None:
    site_packages = next(Path("/opt/shelfdeck-face/lib").glob("python*/site-packages"), None)
    if not site_packages:
        return
    libs = [str(path) for path in (site_packages / "nvidia").glob("*/lib") if path.is_dir()]
    if not libs:
        return
    current = os.environ.get("LD_LIBRARY_PATH", "")
    os.environ["LD_LIBRARY_PATH"] = ":".join(libs + ([current] if current else []))


def stop_all(*_args):
    log("stopping child processes")
    for proc in reversed(children):
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
    deadline = time.time() + 20
    for proc in reversed(children):
        while proc.poll() is None and time.time() < deadline:
            time.sleep(0.2)
        if proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass


def main() -> int:
    env_default("MEDIA_SERVICE_PORT", "18080")
    env_default("MEDIA_SERVICE_DATA_DIR", "/app/data")
    env_default("FACE_EMBEDDINGS_URL", "http://127.0.0.1:19110/v1/face/embeddings")
    env_default("FACE_MODEL_DIR", "/app/data/face-models")
    env_default("FACE_ONNX_PROVIDER", "OpenVINOExecutionProvider")
    env_default("FACE_OPENVINO_DEVICE", "AUTO:GPU,CPU")
    env_default("FACE_OPENVINO_CACHE_DIR", "/app/data/openvino-cache")

    os.makedirs(os.environ["MEDIA_SERVICE_DATA_DIR"], exist_ok=True)
    os.makedirs(os.environ["FACE_MODEL_DIR"], exist_ok=True)
    os.makedirs("/var/log/shelfdeck", exist_ok=True)
    extend_face_library_path()

    signal.signal(signal.SIGTERM, stop_all)
    signal.signal(signal.SIGINT, stop_all)

    face_log = open("/var/log/shelfdeck/face-service.log", "a", encoding="utf-8")
    start([sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "19110"], cwd="/app/face-service", stdout=face_log)
    wait_http("http://127.0.0.1:19110/v1/health", "face-service", 120)

    start(["node", "/app/src/server.js"])

    while True:
        for proc in children:
            code = proc.poll()
            if code is not None:
                stop_all()
                return code
        time.sleep(1)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        log(f"startup failed: {exc}")
        stop_all()
        raise
