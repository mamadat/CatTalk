"""Decoder and inference settings tests; synthetic audio and a clearly mocked model."""
import base64
import importlib.util
import io
import math
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave

spec = importlib.util.spec_from_file_location("whisper_worker", Path(__file__).resolve().parents[1] / "scripts" / "whisper_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def audio(seconds=.3, silent=False, channels=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        values = b"".join(struct.pack("<h", 0 if silent else int(12000 * math.sin(2 * math.pi * 440 * i / 16000))) * channels for i in range(int(seconds * 16000)))
        wav.writeframes(values)
    return base64.b64encode(output.getvalue()).decode()


class LocalVoiceTests(unittest.TestCase):
    def test_decode_mono_and_stereo_to_16khz_bounded_audio(self):
        for channels in (1, 2):
            decoded = worker.decode_audio(audio(channels=channels))
            self.assertEqual(len(decoded), 4800)
            self.assertEqual(str(decoded.dtype), "float32")

    def test_corruption_silence_too_short_and_excessive_duration(self):
        for value, code in (("!@@", "AUDIO_DECODE"), (audio(silent=True), "NO_SPEECH"), (audio(.01), "NO_SPEECH"), (audio(126, silent=True), "AUDIO_DURATION")):
            with self.assertRaises(worker.InputError) as exc:
                worker.decode_audio(value)
            self.assertEqual(exc.exception.code, code)

    def test_offline_model_loading_and_transcription_settings(self):
        with tempfile.TemporaryDirectory(prefix="cattalk-whisper-python-") as folder:
            for name in worker.MODEL_FILES:
                (Path(folder) / name).write_bytes(b"fixture")
            fake = type("Model", (), {})()
            calls = []
            def transcribe(data, **kwargs):
                calls.append(kwargs)
                return [type("Segment", (), {"text": "こんにちは"})()], None
            fake.transcribe = transcribe
            with patch.dict(os.environ, {"CAT_WHISPER_FAST": folder, "CAT_WHISPER_ACCURATE": folder}), patch("faster_whisper.WhisperModel", return_value=fake) as constructor:
                transcriber = worker.Transcriber()
                for mode, language in (("fast", "fa"), ("accurate", "ja")):
                    self.assertEqual(transcriber.run({"language": language, "recognition": mode, "audioBase64": audio(), "hints": ["東京"]}), {"text": "こんにちは"})
                self.assertEqual(constructor.call_count, 1, "reuse a loaded local model")
                self.assertTrue(constructor.call_args.kwargs["local_files_only"])
                self.assertEqual([v["beam_size"] for v in calls], [1, 5])
                self.assertEqual([v["language"] for v in calls], ["fa", "ja"])
                self.assertTrue(all(v["task"] == "transcribe" and v["initial_prompt"] == "東京" for v in calls))
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")

    def test_worker_rejects_unsupported_language_and_missing_model(self):
        transcriber = worker.Transcriber()
        with self.assertRaises(worker.InputError):
            transcriber.run({"language": "en"})
        with patch.dict(os.environ, {"CAT_WHISPER_FAST": "/missing-model"}):
            with self.assertRaises(worker.InputError) as exc:
                transcriber.run({"language": "fa", "audioBase64": audio()})
            self.assertEqual(exc.exception.code, "LOCAL_MODEL_MISSING")


if __name__ == "__main__":
    unittest.main()
