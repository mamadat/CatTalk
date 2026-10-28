"""Explicit installation step; network is used only to fetch the requested public model."""
import argparse
import os
from pathlib import Path

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
MODELS = {name: f"Systran/faster-whisper-{name}" for name in ("tiny", "base", "small", "medium", "large-v3")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=MODELS, required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    from huggingface_hub import snapshot_download
    folder = Path(args.root).resolve() / args.model
    snapshot_download(MODELS[args.model], local_dir=str(folder), allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"], max_workers=2)
    for name in ("model.bin", "config.json", "tokenizer.json"):
        if not (folder / name).is_file():
            raise RuntimeError("Model installation is incomplete; rerun the installer.")
    print(f"Local multilingual Whisper model ready: {args.model}")


if __name__ == "__main__":
    main()
