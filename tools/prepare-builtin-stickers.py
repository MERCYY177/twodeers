#!/usr/bin/env python3
"""Stage the complete offline sticker catalogue for the Android WebView."""
from __future__ import annotations

import argparse
import hashlib
import json
import io
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

EXPECTED_COUNTS = {"jpeg": 199, "gif": 131, "png": 4, "heif": 18}


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


def inspect_image(data: bytes) -> tuple[int, int, int]:
    """Decode the source's displayed first frame and report display dimensions."""
    try:
        with Image.open(io.BytesIO(data)) as source_image:
            frame_count = int(getattr(source_image, "n_frames", 1))
            source_image.seek(0)
            source_image.load()
            displayed = ImageOps.exif_transpose(source_image)
            width, height = displayed.size
            if width < 1 or height < 1:
                raise RuntimeError("Image has invalid displayed dimensions")
            return width, height, frame_count
    except Exception as exc:
        raise RuntimeError("Image decode failed: " + str(exc)) from exc


def convert_heif(data: bytes, output: Path, expected_size: tuple[int, int]) -> tuple[int, int]:
    """Decode HEIF with libheif via pillow-heif, honoring the display transform/crop."""
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(io.BytesIO(data)) as source_image:
            if (source_image.format or "").upper() not in {"HEIF", "HEIC"}:
                raise RuntimeError("HEIF decoder received " + repr(source_image.format))
            source_image.seek(0)
            source_image.load()
            displayed = ImageOps.exif_transpose(source_image)
            width, height = displayed.size
            if (width, height) != expected_size:
                raise RuntimeError(
                    f"HEIF displayed dimensions changed during decode: {expected_size} -> {(width, height)}"
                )
            displayed.convert("RGB").save(
                output, format="JPEG", quality=94, optimize=True, progressive=True
            )
    except Exception as exc:
        raise RuntimeError("Native HEIF conversion failed for " + output.name + ": " + str(exc)) from exc

    try:
        with Image.open(output) as converted:
            converted.load()
            if converted.format != "JPEG" or converted.size != expected_size:
                raise RuntimeError(
                    f"HEIF JPEG readback mismatch: expected {expected_size}, "
                    f"got {converted.format} {converted.size}"
                )
    except Exception as exc:
        raise RuntimeError("Generated HEIF JPEG failed validation: " + str(exc)) from exc
    return expected_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-one", required=True, type=Path)
    parser.add_argument("--archive-two", required=True, type=Path)
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
                source_width, source_height, frame_count = inspect_image(source)
                item_id = "builtin-" + digest[:24]
                if item_id in seen_ids:
                    raise RuntimeError("Duplicate source image detected: " + archive_path.name + ":" + entry)
                seen_ids.add(item_id)
                counts[fmt] += 1
                total_source_bytes += len(source)

                if fmt == "heif":
                    relative = f"heif/{item_id}.jpg"
                    destination = output_root / "assets" / "builtin-stickers" / relative
                    output_width, output_height = convert_heif(
                        source, destination, (source_width, source_height)
                    )
                    mime = "image/jpeg"
                else:
                    relative = f"{folder}/{entry}"
                    destination = output_root / "assets" / "builtin-stickers" / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(source)
                    output_width, output_height = source_width, source_height
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
                    "sourceWidth": source_width,
                    "sourceHeight": source_height,
                    "width": output_width,
                    "height": output_height,
                    "frames": frame_count,
                    "archive": archive_path.name,
                    "archiveEntry": entry,
                })

    actual_counts = {key: counts.get(key, 0) for key in sorted(EXPECTED_COUNTS)}
    if actual_counts != EXPECTED_COUNTS:
        raise RuntimeError(f"Sticker format counts differ from the audited set: {actual_counts}; expected {EXPECTED_COUNTS}")
    if len(items) != 352:
        raise RuntimeError(f"Expected 352 built-in stickers, found {len(items)}")
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
        with Image.open(output_path) as generated_image:
            generated_image.seek(0)
            generated_image.load()
            if generated_image.size != (item["width"], item["height"]):
                raise RuntimeError(
                    f"Generated image dimensions differ from its manifest: {item['name']}: "
                    f"{generated_image.size} != {(item['width'], item['height'])}"
                )
            if item["format"] != "heif" and int(getattr(generated_image, "n_frames", 1)) != item["frames"]:
                raise RuntimeError("Generated animation frame count changed: " + item["name"])
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
