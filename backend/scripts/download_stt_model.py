import argparse

from faster_whisper import WhisperModel


def main() -> None:
    parser = argparse.ArgumentParser(description="Preload a faster-whisper model")
    parser.add_argument("--model", default="small")
    parser.add_argument("--output", default="/models/whisper")
    args = parser.parse_args()

    WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        download_root=args.output,
        local_files_only=False,
    )
    print(f"STT model ready: {args.model} in {args.output}")


if __name__ == "__main__":
    main()
