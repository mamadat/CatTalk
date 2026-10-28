"""Opt-in REAL local model smoke check. Requires installed model + synthetic audio files.

The supplied smoke audio is an English system voice reading romanized Persian/Japanese.
This tests execution and network independence, NOT native-speaker recognition accuracy.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import socket
import time

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("CAT_WHISPER_FAST", str(ROOT / ".local/whisper/models/small"))
os.environ.setdefault("CAT_WHISPER_ACCURATE", os.environ["CAT_WHISPER_FAST"])
spec = importlib.util.spec_from_file_location("whisper_worker", ROOT / "scripts/whisper_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def no_network(*args, **kwargs):
    raise AssertionError("Local model attempted network access")


socket.socket.connect = no_network
socket.getaddrinfo = no_network
transcriber = worker.Transcriber()
results = []
for language in ("ja", "fa"):
    audio = ROOT / "artifacts" / f"local-whisper-synthetic-{language}.wav"
    started = time.monotonic()
    result = transcriber.run({"language": language, "recognition": "fast", "audioBase64": base64.b64encode(audio.read_bytes()).decode()})
    results.append({"language": language, "text": result["text"], "elapsedMs": round((time.monotonic() - started) * 1000), "fixture": audio.name})
report = {"model": "small", "network": "blocked during inference", "input": "English system TTS pronouncing romanized FA/JA; not an accuracy benchmark", "results": results}
(ROOT / "artifacts/local-whisper-smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False))
