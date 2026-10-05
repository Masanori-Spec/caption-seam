#!/usr/bin/env python3
"""Independent FFmpeg acceptance gate over the browser's actual downloaded files.

Usage: python3 tests/consumers.py [test-results/browser]
Requires ffmpeg and ffprobe. Does not import CaptionSeam or reproduce its cut math.
All expected caption times/text below are a hand-written six-cue acceptance fixture.
"""
from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

EXPECTED = [
    {"start": "1", "duration": "2", "text": "Welcome"},
    {"start": "4", "duration": "1", "text": "Before"},
    {"start": "5", "duration": "1", "text": "and after"},
    {"start": "7", "duration": "1", "text": "Middle"},
    {"start": "10", "duration": "1", "text": "Resume"},
    {"start": "12", "duration": "2", "text": "Last\ncaption"},
]
# Intentionally authored independently of the application and of its serializer.
CONTROL_SRT = """1
00:00:01,000 --> 00:00:03,000
Welcome

2
00:00:04,000 --> 00:00:05,000
Before

3
00:00:05,000 --> 00:00:06,000
and after

4
00:00:07,000 --> 00:00:08,000
Middle

5
00:00:10,000 --> 00:00:11,000
Resume

6
00:00:12,000 --> 00:00:14,000
Last
caption
"""
CONTROL_VTT = """WEBVTT

00:00:01.000 --> 00:00:03.000
Welcome

00:00:04.000 --> 00:00:05.000
Before

00:00:05.000 --> 00:00:06.000
and after

00:00:07.000 --> 00:00:08.000
Middle

00:00:10.000 --> 00:00:11.000
Resume

00:00:12.000 --> 00:00:14.000
Last
caption
"""


class CaptionMismatch(AssertionError):
    """A decoded consumer result disagrees with the independent hand fixture."""


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}\n{result.stderr}")
    return result.stdout


def packet_bytes(packet: dict) -> bytes:
    """Decode ffprobe's hex dump, never its lossy printable ASCII side column."""
    parts = []
    for line in packet.get("data", "").splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"([0-9a-fA-F]{8}): (.*)", line)
        if not match:
            raise RuntimeError(f"Unrecognized ffprobe packet dump: {line!r}")
        # ffprobe prints 16 bytes in a 39-character hex field, followed by ASCII.
        field = match.group(2)[:39]
        if not re.fullmatch(r"[0-9a-fA-F ]+", field):
            raise RuntimeError(f"Invalid ffprobe hex field: {field!r}")
        parts.append(bytes.fromhex(field))
    payload = b"".join(parts)
    if len(payload) != int(packet["size"]):
        raise RuntimeError(f"Packet dump byte count differs: {len(payload)} != {packet['size']}")
    return payload


def probe(path: Path) -> list[dict]:
    raw = json.loads(run([
        "ffprobe", "-v", "error", "-select_streams", "s:0", "-show_packets",
        "-show_data", "-show_entries", "packet=pts_time,duration_time,size,data",
        "-of", "json", str(path),
    ]))
    cues = []
    for packet in raw.get("packets", []):
        if "pts_time" not in packet or "duration_time" not in packet:
            raise CaptionMismatch(f"{path.name}: missing packet start/duration")
        payload = packet_bytes(packet)
        cues.append({
            "start": packet["pts_time"],
            "duration": packet["duration_time"],
            "text": payload.decode("utf-8", errors="strict"),
            "payloadUtf8Hex": payload.hex(),
        })
    return cues


def compare(cues: list[dict], label: str) -> None:
    if len(cues) != len(EXPECTED):
        raise CaptionMismatch(f"{label}: expected exactly {len(EXPECTED)} packets, got {len(cues)}")
    for number, (actual, expected) in enumerate(zip(cues, EXPECTED), 1):
        for field in ("start", "duration"):
            if Decimal(actual[field]) != Decimal(expected[field]):
                raise CaptionMismatch(f"{label}, cue {number}: {field} {actual[field]} != {expected[field]}")
        if actual["text"] != expected["text"]:
            raise CaptionMismatch(f"{label}, cue {number}: UTF-8 text {actual['text']!r} != {expected['text']!r}")


def consume(path: Path) -> dict:
    content = path.read_bytes()
    cues = probe(path)
    compare(cues, path.name)
    return {"file": path.name, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "packets": cues}


def controls(directory: Path) -> dict:
    """The real decoder must accept good data and reject timing/text corruption."""
    positive = []
    for ext, text in (("srt", CONTROL_SRT), ("vtt", CONTROL_VTT)):
        path = directory / f"positive-control.{ext}"
        path.write_text(text, encoding="utf-8")
        positive.append(consume(path))
    negative = []
    corruptions = [
        ("srt", "start", CONTROL_SRT.replace("00:00:01,000", "00:00:01,250", 1)),
        ("srt", "duration", CONTROL_SRT.replace("00:00:03,000", "00:00:03,001", 1)),
        ("vtt", "multiline-text", CONTROL_VTT.replace("Last\ncaption", "Last caption")),
        ("vtt", "text", CONTROL_VTT.replace("and after", "and before")),
    ]
    for ext, reason, text in corruptions:
        path = directory / f"bad-{reason}.{ext}"
        path.write_text(text, encoding="utf-8")
        try:
            consume(path)
        except CaptionMismatch as error:
            negative.append({"name": reason, "rejected": True, "reason": str(error)})
        else:
            raise AssertionError(f"Negative control accepted bad {reason} output")
    # Exercise strict decoding with multibyte UTF-8, not ffprobe's ASCII display.
    unicode_path = directory / "unicode-control.vtt"
    unicode_path.write_text(CONTROL_VTT.replace("Welcome", "ようこそ 🌱"), encoding="utf-8")
    decoded = probe(unicode_path)
    if decoded[0]["text"] != "ようこそ 🌱":
        raise AssertionError("ffprobe UTF-8 hex decode control failed")
    return {"positive": positive, "negative": negative, "multibyteUtf8Decode": "pass"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", default="test-results/browser")
    parser.add_argument("--input-origin", choices=["browser-download", "cli-export"], default="browser-download")
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    report = {"status": "fail", "inputOrigin": args.input_origin, "independentExpectation": EXPECTED, "inputs": [], "controls": {}}
    try:
        if args.input_origin == "browser-download":
            browser = json.loads((directory / "results.json").read_text(encoding="utf-8"))
            if browser.get("status") != "pass" or browser.get("chromiumSandbox") is not True:
                raise AssertionError("Passing sandboxed browser report is required")
            hashes = {entry["name"]: entry["sha256"] for entry in browser["actualDownloads"]}
            for filename in ("recut.srt", "recut.vtt"):
                if hashlib.sha256((directory / filename).read_bytes()).hexdigest() != hashes.get(filename):
                    raise AssertionError(f"Browser-download SHA-256 mismatch: {filename}")
        report["ffmpeg"] = run(["ffmpeg", "-version"]).splitlines()[0]
        report["ffprobe"] = run(["ffprobe", "-version"]).splitlines()[0]
        with tempfile.TemporaryDirectory(prefix="caption-seam-ffmpeg-") as temporary:
            temporary = Path(temporary)
            report["controls"] = controls(temporary)
            for name in ("recut.srt", "recut.vtt"):
                path = directory / name
                if not path.is_file():
                    raise FileNotFoundError(f"Actual browser download required: {path}; run npm run test:browser first")
                report["inputs"].append(consume(path))
            converted = temporary / "ffmpeg-converted.vtt"
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(directory / "recut.srt"), "-map", "0:s:0", "-c:s", "webvtt", str(converted)])
            report["convertedSrtToVtt"] = consume(converted)
            # Retain actual consumer output as evidence, never as a new fixture/oracle.
            (directory / "ffmpeg-converted.vtt").write_bytes(converted.read_bytes())
        report["status"] = "pass"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    (directory / "consumer-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if report["status"] != "pass":
        print(report["error"], file=sys.stderr)
        return 1
    print(f"PASS ({args.input_origin}): SRT, VTT and FFmpeg SRT→VTT: six exact packet times/durations/UTF-8 texts; positive and corruption controls passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
