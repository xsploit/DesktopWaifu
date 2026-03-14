from __future__ import annotations

import argparse
import json
import re
import sys
from typing import List, Pattern, Set


class TextSplitter:
    def __init__(self, max_len: int = 40, min_len: int = 5):
        self.max_len = max_len
        self.min_len = min_len
        self.end_chars: Set[str] = {
            "。",
            "！",
            "？",
            "…",
            "!",
            "?",
            ".",
        }
        self.all_puncts_chars: Set[str] = self.end_chars | {
            "，",
            "、",
            "；",
            "：",
            "——",
            ",",
            ";",
            ":",
            "“",
            "”",
            "‘",
            "’",
            '"',
            "'",
        }
        sorted_puncts: List[str] = sorted(list(self.all_puncts_chars), key=len, reverse=True)
        escaped_puncts: List[str] = [re.escape(p) for p in sorted_puncts]
        self.pattern: Pattern = re.compile(f"((?:{'|'.join(escaped_puncts)})+)")

    @staticmethod
    def get_char_width(char: str) -> int:
        return 1 if ord(char) < 128 else 2

    def get_effective_len(self, text: str) -> int:
        length = 0
        for char in text:
            if char in self.all_puncts_chars:
                continue
            length += self.get_char_width(char)
        return length

    def is_terminator_block(self, block: str) -> bool:
        return any(char in self.end_chars for char in block)

    def split(self, text: str) -> List[str]:
        if not text:
            return []

        text = text.replace("\n", "")
        segments: List[str] = self.pattern.split(text)
        sentences: List[str] = []
        current_buffer = ""

        for segment in segments:
            if not segment:
                continue

            is_punct_block = segment[0] in self.all_puncts_chars

            if is_punct_block:
                current_buffer += segment
                eff_len = self.get_effective_len(current_buffer)

                if self.is_terminator_block(segment):
                    if eff_len >= self.min_len:
                        sentences.append(current_buffer.strip())
                        current_buffer = ""
                elif eff_len >= self.max_len:
                    sentences.append(current_buffer.strip())
                    current_buffer = ""
            else:
                current_buffer += segment

        if current_buffer:
            self._flush_buffer(sentences, current_buffer)

        return sentences

    def _flush_buffer(self, sentences: List[str], buffer: str) -> None:
        candidate = buffer.strip()
        if not candidate:
            return
        eff_len = self.get_effective_len(candidate)
        if eff_len > 0:
            sentences.append(candidate)
        elif sentences:
            sentences[-1] += candidate


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Split text using Genie-style sentence splitting.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--max-len", type=int, default=40)
    parser.add_argument("--min-len", type=int, default=5)
    args = parser.parse_args()

    splitter = TextSplitter(max_len=args.max_len, min_len=args.min_len)
    chunks = splitter.split(args.text)
    items = [
        {
            "index": index + 1,
            "text": chunk,
            "effectiveLength": splitter.get_effective_len(chunk),
        }
        for index, chunk in enumerate(chunks)
    ]
    print(
        json.dumps(
            {
                "ok": True,
                "maxLen": args.max_len,
                "minLen": args.min_len,
                "count": len(items),
                "items": items,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
