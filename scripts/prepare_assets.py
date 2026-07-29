from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageFilter, ImageSequence


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ASSETS_ROOT = PROJECT_ROOT / "assets"
LOCAL_ROOT = ASSETS_ROOT / "local"
COLLECTION_ROOT = LOCAL_ROOT / "糖猫合集"
DAILY_ROOT = LOCAL_ROOT / "日常与悬停"
GENERATED_ROOT = ASSETS_ROOT / "generated"
STAGING_ROOT = ASSETS_ROOT / "generated-staging"
OVERRIDES_PATH = PROJECT_ROOT / "scripts" / "asset-overrides.json"

SUPPORTED_SUFFIXES = {".png", ".gif"}
ALPHA_THRESHOLD = 8
TARGET_BODY_HEIGHT = 190
KEEP_HEIGHT_MIN = 180
KEEP_HEIGHT_MAX = 200
COLLISION_PADDING = 3
MOVEMENT_FILES = {
    "跑": "跑.png",
    "跳": "跳跳.png",
    "迈步": "迈步.png",
    "飞猫": "飞猫.png",
}
MOVEMENT_SPEEDS = {
    "跑": 120,
    "跳": 80,
    "迈步": 50,
    "飞猫": 160,
}


@dataclass(frozen=True)
class FrameData:
    image: Image.Image
    duration_ms: int
    bounds: tuple[int, int, int, int]


def relative_source(path: Path) -> str:
    return path.relative_to(PROJECT_ROOT).as_posix()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_files(root: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in root.rglob("*")
            if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
        ),
        key=lambda path: path.relative_to(root).as_posix(),
    )


def alpha_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    thresholded = alpha.point(lambda value: 255 if value >= ALPHA_THRESHOLD else 0)
    bounds = thresholded.getbbox()
    if bounds is None:
        return (0, 0, 1, 1)
    return bounds


def bounds_dict(bounds: tuple[int, int, int, int]) -> dict[str, int]:
    left, top, right, bottom = bounds
    return {
        "x": left,
        "y": top,
        "width": max(1, right - left),
        "height": max(1, bottom - top),
    }


def load_frames(path: Path) -> tuple[list[FrameData], int]:
    with Image.open(path) as image:
        default_duration = int(image.info.get("duration", 100) or 100)
        loop = int(image.info.get("loop", 0) or 0)
        frames: list[FrameData] = []
        for frame in ImageSequence.Iterator(image):
            rgba = frame.convert("RGBA")
            duration = int(frame.info.get("duration", default_duration) or default_duration)
            frames.append(
                FrameData(
                    image=rgba.copy(),
                    duration_ms=max(20, duration),
                    bounds=alpha_bounds(rgba),
                )
            )
    if not frames:
        raise ValueError(f"素材没有可读取的画面：{path}")
    return frames, loop


def representative_frame_index(frames: list[FrameData]) -> int:
    heights = [
        (index, frame.bounds[3] - frame.bounds[1])
        for index, frame in enumerate(frames)
    ]
    median_height = statistics.median(height for _, height in heights)
    return min(heights, key=lambda item: (abs(item[1] - median_height), item[0]))[0]


def display_scale(
    source_path: Path,
    frames: list[FrameData],
    representative_index: int,
    multipliers: dict[str, float],
) -> float:
    bounds = frames[representative_index].bounds
    height = max(1, bounds[3] - bounds[1])
    base_scale = 1.0
    if height < KEEP_HEIGHT_MIN or height > KEEP_HEIGHT_MAX:
        base_scale = TARGET_BODY_HEIGHT / height
    multiplier = float(multipliers.get(relative_source(source_path), 1.0))
    if not math.isfinite(multiplier) or multiplier <= 0:
        raise ValueError(f"无效的素材缩放倍率：{relative_source(source_path)}")
    return round(base_scale * multiplier, 8)


def load_overrides() -> dict[str, Any]:
    if not OVERRIDES_PATH.exists():
        return {"scaleMultipliers": {}}
    return json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))


class AssetBuilder:
    def __init__(self, output_root: Path, overrides: dict[str, Any]) -> None:
        self.output_root = output_root
        self.multipliers = dict(overrides.get("scaleMultipliers", {}))
        self.assets: dict[str, dict[str, Any]] = {}
        self.asset_ids_by_hash: dict[str, str] = {}

    def register(self, source_path: Path) -> str:
        content_hash = sha256(source_path)
        existing_id = self.asset_ids_by_hash.get(content_hash)
        if existing_id is not None:
            sources = self.assets[existing_id]["sources"]
            source_name = relative_source(source_path)
            if source_name not in sources:
                sources.append(source_name)
            return existing_id

        asset_id = content_hash[:20]
        frames, source_loop = load_frames(source_path)
        representative_index = representative_frame_index(frames)
        scale = display_scale(
            source_path,
            frames,
            representative_index,
            self.multipliers,
        )
        canvas_width, canvas_height = frames[0].image.size
        union_bounds = (
            min(frame.bounds[0] for frame in frames),
            min(frame.bounds[1] for frame in frames),
            max(frame.bounds[2] for frame in frames),
            max(frame.bounds[3] for frame in frames),
        )
        kind = "gif" if source_path.suffix.lower() == ".gif" else "static"
        asset: dict[str, Any] = {
            "id": asset_id,
            "name": source_path.stem,
            "kind": kind,
            "sources": [relative_source(source_path)],
            "contentHash": content_hash,
            "canvas": {"width": canvas_width, "height": canvas_height},
            "contentBounds": bounds_dict(union_bounds),
            "representativeFrame": representative_index,
            "displayScale": scale,
            "displaySize": {
                "width": round(canvas_width * scale, 3),
                "height": round(canvas_height * scale, 3),
            },
            "collisionPadding": COLLISION_PADDING,
        }

        if kind == "static":
            suffix = source_path.suffix.lower()
            output_relative = Path("files") / "static" / f"{asset_id}{suffix}"
            output_path = self.output_root / output_relative
            output_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, output_path)
            asset["file"] = output_relative.as_posix()
            asset["frames"] = [
                {
                    "file": output_relative.as_posix(),
                    "durationMs": 0,
                    "bounds": bounds_dict(frames[0].bounds),
                }
            ]
            asset["loopDurationMs"] = 0
        else:
            animation_root = Path("files") / "animated" / asset_id
            copied_gif = animation_root / "source.gif"
            copied_gif_path = self.output_root / copied_gif
            copied_gif_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, copied_gif_path)

            frame_entries: list[dict[str, Any]] = []
            for index, frame in enumerate(frames):
                frame_relative = animation_root / f"frame-{index:03d}.png"
                frame_path = self.output_root / frame_relative
                frame.image.save(frame_path, format="PNG", optimize=True)
                frame_entries.append(
                    {
                        "file": frame_relative.as_posix(),
                        "durationMs": frame.duration_ms,
                        "bounds": bounds_dict(frame.bounds),
                    }
                )

            asset["file"] = copied_gif.as_posix()
            asset["frames"] = frame_entries
            asset["frameCount"] = len(frames)
            asset["loopDurationMs"] = sum(frame.duration_ms for frame in frames)
            asset["sourceLoop"] = source_loop

        self.asset_ids_by_hash[content_hash] = asset_id
        self.assets[asset_id] = asset
        return asset_id


def build_daily_pairs(builder: AssetBuilder) -> tuple[list[dict[str, Any]], set[str]]:
    numbered: dict[int, list[Path]] = {}
    for path in image_files(DAILY_ROOT):
        prefix, separator, _rest = path.name.partition("_")
        if not separator or not prefix.isdigit():
            continue
        numbered.setdefault(int(prefix), []).append(path)

    pairs: list[dict[str, Any]] = []
    daily_asset_ids: set[str] = set()
    for idle_number in sorted(number for number in numbered if number % 2 == 1):
        idle_files = numbered[idle_number]
        hover_files = numbered.get(idle_number + 1, [])
        if len(idle_files) != 1:
            raise ValueError(f"日常编号 {idle_number} 必须且只能有一张图片")
        if not hover_files:
            raise ValueError(f"日常编号 {idle_number} 缺少编号 {idle_number + 1} 的悬停图片")
        idle_id = builder.register(idle_files[0])
        hover_ids = [builder.register(path) for path in sorted(hover_files)]
        daily_asset_ids.add(idle_id)
        daily_asset_ids.update(hover_ids)
        pairs.append(
            {
                "id": f"daily-{idle_number}",
                "number": idle_number,
                "idle": idle_id,
                "hovers": hover_ids,
            }
        )
    if not pairs:
        raise ValueError("没有识别到日常与悬停配对")
    return pairs, daily_asset_ids


def build_manifest(output_root: Path) -> dict[str, Any]:
    if not COLLECTION_ROOT.is_dir() or not DAILY_ROOT.is_dir():
        raise FileNotFoundError(
            "缺少本地素材目录，请准备 assets/local/糖猫合集 和 assets/local/日常与悬停"
        )

    overrides = load_overrides()
    builder = AssetBuilder(output_root, overrides)
    daily_pairs, daily_asset_ids = build_daily_pairs(builder)

    movement: dict[str, dict[str, Any]] = {}
    movement_asset_ids: set[str] = set()
    for movement_name, filename in MOVEMENT_FILES.items():
        source_path = COLLECTION_ROOT / filename
        if not source_path.is_file():
            raise FileNotFoundError(f"缺少移动素材：{source_path}")
        asset_id = builder.register(source_path)
        movement_asset_ids.add(asset_id)
        movement[movement_name] = {
            "asset": asset_id,
            "speed": MOVEMENT_SPEEDS[movement_name],
        }

    collection_files = image_files(COLLECTION_ROOT)
    collection_asset_ids = [builder.register(path) for path in collection_files]
    action_ids: list[str] = []
    seen_action_ids: set[str] = set()
    excluded_ids = daily_asset_ids | movement_asset_ids
    for asset_id in collection_asset_ids:
        if asset_id in excluded_ids or asset_id in seen_action_ids:
            continue
        seen_action_ids.add(asset_id)
        action_ids.append(asset_id)

    gif_action_ids = [
        asset_id
        for asset_id in action_ids
        if builder.assets[asset_id]["kind"] == "gif"
    ]
    static_action_ids = [
        asset_id
        for asset_id in action_ids
        if builder.assets[asset_id]["kind"] == "static"
    ]

    stand_path = COLLECTION_ROOT / "站.png"
    if not stand_path.exists():
        raise FileNotFoundError(f"缺少图标素材：{stand_path}")
    stand_asset_id = builder.register(stand_path)
    stand_asset = builder.assets[stand_asset_id]
    if stand_asset["kind"] != "static":
        raise ValueError("站.png 必须是静态图片")
    icon_files = generate_icons(output_root, output_root / stand_asset["file"])

    return {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "rules": {
            "dailyDelayMs": {"min": 25_000, "max": 35_000},
            "staticDurationMs": {"min": 2_000, "max": 4_000},
            "movementDurationMs": {"min": 3_000, "max": 6_000},
            "automaticActionProbability": 0.66,
            "automaticMovementProbability": 0.34,
            "movementAxisProbability": {"horizontal": 0.5, "vertical": 0.5},
            "recentLimit": 5,
            "hoverLeaveDelayMs": 120,
            "hoverTolerance": 4,
            "alphaThreshold": ALPHA_THRESHOLD,
            "scaleOptions": [0.75, 1, 1.25, 1.5],
        },
        "daily": daily_pairs,
        "actions": action_ids,
        "staticActions": static_action_ids,
        "gifActions": gif_action_ids,
        "movement": movement,
        "iconAsset": stand_asset_id,
        "icons": icon_files,
        "assets": builder.assets,
        "statistics": {
            "collectionFiles": len(collection_files),
            "dailyFiles": len(image_files(DAILY_ROOT)),
            "dailyPairs": len(daily_pairs),
            "actions": len(action_ids),
            "staticActions": len(static_action_ids),
            "gifActions": len(gif_action_ids),
            "movementAssets": len(movement),
        },
    }


def square_icon(source: Image.Image, size: int) -> Image.Image:
    rgba = source.convert("RGBA")
    bounds = alpha_bounds(rgba)
    cropped = rgba.crop(bounds)
    margin = max(1, round(size * 0.075))
    inner = max(1, size - margin * 2)
    ratio = min(inner / cropped.width, inner / cropped.height)
    resized = cropped.resize(
        (
            max(1, round(cropped.width * ratio)),
            max(1, round(cropped.height * ratio)),
        ),
        Image.Resampling.LANCZOS,
    )
    if size <= 48:
        resized = resized.filter(
            ImageFilter.UnsharpMask(radius=0.45, percent=110, threshold=1)
        )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
    )
    return canvas


def generate_icons(output_root: Path, source_path: Path) -> dict[str, Any]:
    with Image.open(source_path) as image:
        source = image.convert("RGBA")
    icon_root = output_root / "icons"
    icon_root.mkdir(parents=True, exist_ok=True)
    sizes = [16, 20, 24, 30, 32, 36, 40, 48, 64, 128, 256]
    files: dict[str, str] = {}
    for size in sizes:
        relative = Path("icons") / f"tangmao-{size}.png"
        square_icon(source, size).save(output_root / relative, format="PNG")
        files[str(size)] = relative.as_posix()
    shutil.copy2(output_root / files["256"], output_root / "icon-source.png")
    return {
        "sizes": files,
        "appSource": "icon-source.png",
        "trayRepresentations": [
            {"scaleFactor": 1, "file": files["16"]},
            {"scaleFactor": 1.25, "file": files["20"]},
            {"scaleFactor": 1.5, "file": files["24"]},
            {"scaleFactor": 2, "file": files["32"]},
        ],
    }


def validate_generated_roots() -> None:
    resolved_assets = ASSETS_ROOT.resolve()
    resolved_generated = GENERATED_ROOT.resolve()
    resolved_staging = STAGING_ROOT.resolve()
    if resolved_generated.parent != resolved_assets or resolved_generated.name != "generated":
        raise RuntimeError(f"拒绝操作不安全的生成目录：{resolved_generated}")
    if resolved_staging.parent != resolved_assets or resolved_staging.name != "generated-staging":
        raise RuntimeError(f"拒绝操作不安全的暂存目录：{resolved_staging}")


def write_generated_assets() -> dict[str, Any]:
    validate_generated_roots()
    ASSETS_ROOT.mkdir(parents=True, exist_ok=True)
    if STAGING_ROOT.exists():
        shutil.rmtree(STAGING_ROOT)
    STAGING_ROOT.mkdir(parents=True)
    try:
        manifest = build_manifest(STAGING_ROOT)
        manifest_path = STAGING_ROOT / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if GENERATED_ROOT.exists():
            shutil.rmtree(GENERATED_ROOT)
        STAGING_ROOT.replace(GENERATED_ROOT)
        return manifest
    except Exception:
        shutil.rmtree(STAGING_ROOT, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="准备糖猫桌宠第二版素材副本")
    parser.add_argument(
        "--check",
        action="store_true",
        help="生成素材后额外核对预期的素材池数量",
    )
    args = parser.parse_args()

    manifest = write_generated_assets()
    statistics_data = manifest["statistics"]
    if args.check:
        expected = {
            "collectionFiles": 135,
            "dailyFiles": 17,
            "dailyPairs": 5,
            "actions": 114,
            "staticActions": 99,
            "gifActions": 15,
            "movementAssets": 4,
        }
        mismatches = {
            key: (statistics_data.get(key), value)
            for key, value in expected.items()
            if statistics_data.get(key) != value
        }
        if mismatches:
            details = "，".join(
                f"{key}={actual}（预期 {expected_value}）"
                for key, (actual, expected_value) in mismatches.items()
            )
            raise SystemExit(f"素材池数量检查失败：{details}")

    print(
        "素材准备完成："
        f"{statistics_data['dailyPairs']} 组日常，"
        f"{statistics_data['actions']} 个普通动作，"
        f"{statistics_data['movementAssets']} 个移动素材"
    )


if __name__ == "__main__":
    main()
