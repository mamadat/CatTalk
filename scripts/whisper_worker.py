"""Private stdin/stdout worker. Runtime never downloads models or sends audio over a network."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import sys

for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_PROGRESS_BARS", "DO_NOT_TRACK"):
    os.environ[key] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
MAX_BYTES = 6 * 1024 * 1024
MAX_SECONDS = 125
MODEL_FILES = ("model.bin", "config.json", "tokenizer.json")


class InputError(Exception):
    def __init__(self, code):
        self.code = code


def model_ready(path):
    return bool(path) and all((Path(path) / name).is_file() and (Path(path) / name).stat().st_size > 0 for name in MODEL_FILES)


def probe():
    packages = all(importlib.util.find_spec(name) is not None for name in ("faster_whisper", "ctranslate2", "av", "numpy"))
    return {"runtime": packages, "fast": packages and model_ready(os.environ.get("CAT_WHISPER_FAST")), "accurate": packages and model_ready(os.environ.get("CAT_WHISPER_ACCURATE"))}


def decode_audio(encoded):
    import av
    import numpy as np
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > MAX_BYTES:
            raise InputError("AUDIO_SIZE")
        chunks, count = [], 0
        def append(frames):
            nonlocal count
            for frame in frames:
                data = frame.to_ndarray().reshape(-1)
                count += data.size
                if count > MAX_SECONDS * 16000:
                    raise InputError("AUDIO_DURATION")
                chunks.append(data)
        with av.open(io.BytesIO(raw), mode="r") as container:
            resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
            for frame in container.decode(audio=0):
                append(resampler.resample(frame))
            append(resampler.resample(None))
        if count < 1600:
            raise InputError("NO_SPEECH")
        audio = np.concatenate(chunks).astype(np.float32) / 32768.0
        if not np.any(audio):
            raise InputError("NO_SPEECH")
        return audio
    except InputError:
        raise
    except Exception:
        raise InputError("AUDIO_DECODE") from None


class Transcriber:
    def __init__(self):
        self.loaded_path = None
        self.model = None

    def run(self, request):
        if request.get("language") not in ("fa", "ja"):
            raise InputError("INVALID_LANGUAGE")
        mode = request.get("recognition", "fast")
        if mode not in ("fast", "accurate"):
            raise InputError("INVALID_RECOGNITION")
        hints = request.get("hints", [])
        if not isinstance(hints, list) or len(hints) > 8 or any(not isinstance(v, str) or not v.strip() or len(v) > 40 for v in hints) or len(", ".join(hints).encode("utf-8")) > 160:
            raise InputError("INVALID_SPOKEN_TERMS")
        path = os.environ.get("CAT_WHISPER_ACCURATE" if mode == "accurate" else "CAT_WHISPER_FAST", "")
        if not model_ready(path):
            raise InputError("LOCAL_MODEL_MISSING")
        audio = decode_audio(request.get("audioBase64", ""))
        if self.loaded_path != path:
            # Keep one model resident; switching to a different model releases the old one first.
            self.model = None
            self.loaded_path = None
            from faster_whisper import WhisperModel
            self.model = WhisperModel(path, device=os.environ.get("CAT_WHISPER_DEVICE", "cpu"), compute_type=os.environ.get("CAT_WHISPER_COMPUTE", "int8"), cpu_threads=int(os.environ.get("CAT_WHISPER_THREADS", "4")), num_workers=1, local_files_only=True)
            self.loaded_path = path
        segments, _ = self.model.transcribe(audio, language=request["language"], task="transcribe", beam_size=5 if mode == "accurate" else 1, temperature=0, initial_prompt=", ".join(hints) or None, vad_filter=True, vad_parameters={"min_silence_duration_ms": 2000})
        text = ""
        for segment in segments:
            text += segment.text
            # JS uses UTF-16 units; reject oversize instead of silently clipping.
            if len(text.encode("utf-16-le")) // 2 > 2000:
                raise InputError("LONG_TRANSCRIPT")
        if not text.strip():
            raise InputError("NO_SPEECH")
        return {"text": text.strip()}


def main():
    if "--probe" in sys.argv:
        print(json.dumps(probe()), flush=True)
        return
    transcriber = Transcriber()
    while True:
        # A malformed or excessive private protocol message ends this worker.
        line = sys.stdin.buffer.readline(9 * 1024 * 1024 + 1)
        if not line:
            return
        if len(line) > 9 * 1024 * 1024:
            return
        message = {}
        try:
            message = json.loads(line)
            result = {"id": message["id"], **transcriber.run(message)}
        except InputError as exc:
            result = {"id": message.get("id"), "error": exc.code}
        except Exception:
            # Never send paths, source audio, prompts, stack traces or credentials to the client.
            result = {"id": message.get("id"), "error": "LOCAL_RUNTIME"}
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
