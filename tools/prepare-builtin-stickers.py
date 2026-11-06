#!/usr/bin/env python3
"""Stage the complete offline sticker catalogue for the Android WebView."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote

EXPECTED_COUNTS = {"jpeg": 199, "gif": 132, "png": 4, "heif": 18}
EXTRA_GIF_SHA256 = "efcf43188bb01cf086b851da4cc108327fa5733d588d347b689e5d2f5b836216"


def detect_format(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 16 and data[4:8] == b"ftyp":
        brands = data[8:40]
        if any(tag in brands for tag in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heif")):
            return "heif"
    return None


def safe_member_name(name: str) -> str:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name:
        raise RuntimeError(f"Unsafe ZIP entry path: {name!r}")
    return path.as_posix()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded_asset_url(relative_path: str) -> str:
    return "assets/builtin-stickers/" + "/".join(quote(part, safe="-_.~()") for part in PurePosixPath(relative_path).parts)


def convert_heif(data: bytes, output: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to convert the 18 HEIF images to JPEG")
    output.parent.mkdir(parents=True, exist_ok=True)
    # FFmpeg's HEIF demuxer requires a seekable input; stdin pipes are not supported.
    with tempfile.NamedTemporaryFile(suffix=".heic", delete=False) as source_file:
        source_file.write(data)
        source_path = Path(source_file.name)
    try:
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source_path),
                   "-frames:v", "1", "-q:v", "2", "-pix_fmt", "yuvj420p", str(output)]
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode != 0:
            raise RuntimeError("HEIF conversion failed for " + output.name + ": " + result.stderr.decode("utf-8", "replace")[-1000:])
    finally:
        source_path.unlink(missing_ok=True)
    converted = output.read_bytes()
    if detect_format(converted) != "jpeg" or not converted:
        raise RuntimeError("HEIF conversion did not produce a valid JPEG: " + str(output))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-one", required=True, type=Path)
    parser.add_argument("--archive-two", required=True, type=Path)
    parser.add_argument("--extra-gif-b64-dir", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    args = parser.parse_args()

    output_root = args.output_root.resolve()
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    archives = [(args.archive_one, "source-1"), (args.archive_two, "source-2")]
    counts: Counter[str] = Counter()
    items = []
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    total_source_bytes = 0

    for archive_path, folder in archives:
        if not archive_path.is_file():
            raise RuntimeError("Missing source archive: " + str(archive_path))
        with zipfile.ZipFile(archive_path) as zf:
            if zf.testzip() is not None:
                raise RuntimeError("ZIP CRC check failed: " + archive_path.name)
            members = [m for m in zf.infolist() if not m.is_dir()]
            for member in members:
                entry = safe_member_name(member.filename)
                source = zf.read(member)
                fmt = detect_format(source)
                if fmt is None:
                    raise RuntimeError(f"Unsupported/non-image entry in {archive_path.name}: {entry}")
                digest = sha256(source)
                item_id = "builtin-" + digest[:24]
                if item_id in seen_ids:
                    raise RuntimeError("Duplicate source image detected: " + archive_path.name + ":" + entry)
                seen_ids.add(item_id)
                counts[fmt] += 1
                total_source_bytes += len(source)

                if fmt == "heif":
                    relative = f"heif/{item_id}.jpg"
                    destination = output_root / "assets" / "builtin-stickers" / relative
                    convert_heif(source, destination)
                    mime = "image/jpeg"
                else:
                    relative = f"{folder}/{entry}"
                    destination = output_root / "assets" / "builtin-stickers" / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(source)
                    mime = {"jpeg": "image/jpeg", "gif": "image/gif", "png": "image/png"}[fmt]

                if relative in seen_paths:
                    raise RuntimeError("Duplicate generated asset path: " + relative)
                seen_paths.add(relative)
                output_size = destination.stat().st_size
                items.append({
                    "id": item_id,
                    "name": PurePosixPath(entry).name,
                    "assetUrl": encoded_asset_url(relative),
                    "mimeType": mime,
                    "size": output_size,
                    "sourceBytes": len(source),
                    "sourceSha256": digest,
                    "format": fmt,
                    "archive": archive_path.name,
                    "archiveEntry": entry,
                })

    if not args.extra_gif_b64_dir.is_dir():
        raise RuntimeError("Missing additional GIF Base64 directory: " + str(args.extra_gif_b64_dir))
    parts = sorted(args.extra_gif_b64_dir.glob("part-*.b64"))
    if not parts:
        raise RuntimeError("No additional GIF Base64 parts were found")
    encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
    try:
        extra = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise RuntimeError("Additional GIF Base64 parts are corrupt: " + str(error)) from error
    if len(extra) != 91645 or detect_format(extra) != "gif" or sha256(extra) != EXTRA_GIF_SHA256:
        raise RuntimeError("The reconstructed additional GIF does not match the audited 91,645-byte source")
    extra_id = "builtin-" + EXTRA_GIF_SHA256[:24]
    if extra_id in seen_ids:
        raise RuntimeError("Additional GIF duplicates an existing sticker")
    relative = "extra/wmqt-6-efcf4318.gif"
    destination = output_root / "assets" / "builtin-stickers" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(extra)
    counts["gif"] += 1
    total_source_bytes += len(extra)
    items.append({
        "id": extra_id,
        "name": "wmqt (6).gif",
        "assetUrl": encoded_asset_url(relative),
        "mimeType": "image/gif",
        "size": destination.stat().st_size,
        "sourceBytes": len(extra),
        "sourceSha256": EXTRA_GIF_SHA256,
        "format": "gif",
        "archive": None,
        "archiveEntry": "wmqt (6).gif",
    })

    actual_counts = {key: counts.get(key, 0) for key in sorted(EXPECTED_COUNTS)}
    if actual_counts != EXPECTED_COUNTS:
        raise RuntimeError(f"Sticker format counts differ from the audited set: {actual_counts}; expected {EXPECTED_COUNTS}")
    if len(items) != 353:
        raise RuntimeError(f"Expected 353 built-in stickers, found {len(items)}")
    items.sort(key=lambda x: x["id"])

    manifest = {
        "version": 1,
        "totalCount": len(items),
        "sourceBytes": total_source_bytes,
        "counts": actual_counts,
        "items": items,
    }
    manifest_path = output_root / "assets" / "builtin-stickers" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Verify every generated asset against its manifest entry before Gradle stages it.
    for item in items:
        relative_url = unquote(item["assetUrl"].removeprefix("assets/builtin-stickers/"))
        output_path = output_root / "assets" / "builtin-stickers" / relative_url
        if not output_path.is_file() or output_path.stat().st_size != item["size"]:
            raise RuntimeError("Generated asset size/readback mismatch: " + item["id"])
    print(json.dumps({
        "status": "ok",
        "totalCount": len(items),
        "counts": actual_counts,
        "sourceBytes": total_source_bytes,
        "generatedBytes": sum((output_root / "assets" / "builtin-stickers" / unquote(item["assetUrl"].removeprefix("assets/builtin-stickers/"))).stat().st_size for item in items),
        "manifest": str(manifest_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
