#!/usr/bin/env python3
"""Build a deployable static website with all 352 offline built-in stickers."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    output = (repo / args.output_dir).resolve() if not args.output_dir.is_absolute() else args.output_dir.resolve()
    if output == repo or repo not in output.parents:
        raise RuntimeError("Output directory must be a child of the repository, not the repository root")

    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    # Copy exactly the static files that the Android WebView build already stages.
    shutil.copy2(repo / "index.html", output / "index.html")
    for pattern in ("*.js", "*.css", "*.json"):
        for source in repo.glob(pattern):
            if source.is_file():
                shutil.copy2(source, output / source.name)

    source_assets = repo / "assets"
    if source_assets.is_dir():
        shutil.copytree(source_assets, output / "assets", dirs_exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="twodeers-stickers-") as temporary:
        generated_root = Path(temporary) / "generated"
        subprocess.run([
            sys.executable,
            str(repo / "tools" / "prepare-builtin-stickers.py"),
            "--archive-one", str(repo / "sticker-source" / "表情包1.zip"),
            "--archive-two", str(repo / "sticker-source" / "表情包2.zip"),
            "--output-root", str(generated_root),
        ], check=True)
        generated_stickers = generated_root / "assets" / "builtin-stickers"
        target_stickers = output / "assets" / "builtin-stickers"
        if target_stickers.exists():
            shutil.rmtree(target_stickers)
        shutil.copytree(generated_stickers, target_stickers)

    manifest_path = output / "assets" / "builtin-stickers" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or manifest.get("totalCount") != 352:
        raise RuntimeError("Deploy output manifest must declare exactly 352 stickers")
    items = manifest.get("items")
    if not isinstance(items, list) or len(items) != 352:
        raise RuntimeError("Deploy output manifest does not contain 352 items")

    checked = 0
    for item in items:
        asset_url = item.get("assetUrl", "")
        prefix = "assets/builtin-stickers/"
        if not isinstance(asset_url, str) or not asset_url.startswith(prefix):
            raise RuntimeError("Invalid sticker asset URL: " + repr(asset_url))
        relative = unquote(asset_url[len(prefix):])
        asset_path = (output / prefix / relative).resolve()
        if output not in asset_path.parents or not asset_path.is_file():
            raise RuntimeError("Missing generated sticker asset: " + str(asset_path))
        if asset_path.stat().st_size != item.get("size"):
            raise RuntimeError("Sticker asset size mismatch: " + str(asset_path))
        checked += 1

    print(json.dumps({
        "status": "ok",
        "output": str(output),
        "manifest": str(manifest_path.relative_to(output)),
        "stickerCount": checked,
        "assetDirectoryBytes": sum(p.stat().st_size for p in (output / "assets" / "builtin-stickers").rglob("*") if p.is_file()),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
