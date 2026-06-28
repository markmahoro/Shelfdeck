import os
import signal
import subprocess
import sys
import time
import urllib.request


children = []


def log(message: str) -> None:
    print(f"[all-in-one] {time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}", flush=True)


def env_default(key: str, value: str) -> str:
    if not os.environ.get(key):
        os.environ[key] = value
    return os.environ[key]


def wait_http(url: str, name: str, timeout_sec: int = 180) -> None:
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


def model_exists(model: str) -> bool:
    out = subprocess.run(["ollama", "list"], check=False, text=True, capture_output=True)
    if out.returncode != 0:
        return False
    names = [line.split()[0] for line in out.stdout.splitlines()[1:] if line.split()]
    return model in names


def main() -> int:
    env_default("WORKER_PORT", "19000")
    env_default("WORKER_TEMP_ROOT", "/tmp/shelfdeck-worker")
    env_default("WORKER_AI_DATA_ROOT", "/data/ai")
    env_default("OLLAMA_HOST", "127.0.0.1:11434")
    env_default("OLLAMA_MODELS", "/data/ollama")
    env_default("OLLAMA_MODEL", "llava:7b")
    env_default("OLLAMA_KEEP_ALIVE", "30m")
    env_default("VISION_BASE_URL", "http://127.0.0.1:11434/v1")
    env_default("VISION_MODEL", os.environ["OLLAMA_MODEL"])
    env_default("FACE_EMBEDDINGS_URL", "http://127.0.0.1:19110/v1/face/embeddings")
    env_default("FACE_ONNX_PROVIDER", "CUDAExecutionProvider")

    os.makedirs(os.environ["WORKER_TEMP_ROOT"], exist_ok=True)
    os.makedirs(os.environ["WORKER_AI_DATA_ROOT"], exist_ok=True)
    os.makedirs(os.environ["OLLAMA_MODELS"], exist_ok=True)
    os.makedirs("/var/log/shelfdeck-worker", exist_ok=True)

    signal.signal(signal.SIGTERM, stop_all)
    signal.signal(signal.SIGINT, stop_all)

    ollama_log = open("/var/log/shelfdeck-worker/ollama.log", "a", encoding="utf-8")
    start(["ollama", "serve"], stdout=ollama_log)
    wait_http(f"http://{os.environ['OLLAMA_HOST']}/api/tags", "ollama", 180)

    model = os.environ.get("OLLAMA_MODEL", "")
    if model and os.environ.get("OLLAMA_AUTO_PULL", "true") != "false":
        if not model_exists(model):
            log(f"pulling Ollama model {model}")
            subprocess.run(["ollama", "pull", model], check=True)
        else:
            log(f"Ollama model {model} already exists")

    if os.environ.get("FACE_AUTO_WARMUP", "true") != "false":
        log("warming up face embedding model")
        subprocess.run(
            [sys.executable, "-c", "from app import get_detector, get_recognizer, ensure_models; ensure_models(); get_detector(); get_recognizer(); print('face model ready')"],
            cwd="/app/face-service",
            check=True,
        )

    face_log = open("/var/log/shelfdeck-worker/face-service.log", "a", encoding="utf-8")
    start([sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "19110"], cwd="/app/face-service", stdout=face_log)
    wait_http("http://127.0.0.1:19110/v1/health", "face-service", 120)

    worker = start(["node", "/app/src/server.js"])

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
