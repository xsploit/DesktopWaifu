from __future__ import annotations

import argparse
import json
import sys


def configure_console() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    configure_console()

    parser = argparse.ArgumentParser(description="Transcribe a reference clip with faster-whisper.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        args.audio,
        language=args.language or None,
        vad_filter=True,
        beam_size=5
    )

    segment_list = list(segments)
    text = " ".join(segment.text.strip() for segment in segment_list if segment.text.strip()).strip()

    print(json.dumps({
        "text": text,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "segments": [
            {
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip()
            }
            for seg in segment_list
        ]
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
