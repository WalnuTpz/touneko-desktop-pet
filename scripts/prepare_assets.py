from __future__ import annotations

import hashlib
import json
import math
import re
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
STATIC_ROOT = LOCAL_ROOT / "static"
ANIMATED_ROOT = LOCAL_ROOT / "animated"
CATALOG_PATH = ASSETS_ROOT / "catalog.json"
GENERATED_ROOT = ASSETS_ROOT / "generated"
STAGING_ROOT = ASSETS_ROOT / "generated-staging"

SEMANTIC_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ALPHA_THRESHOLD = 8
TARGET_BODY_HEIGHT = 190
KEEP_HEIGHT_MIN = 180
KEEP_HEIGHT_MAX = 200
GLOBAL_DISPLAY_SCALE = 0.8
COLLISION_PADDING = 3


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


def alpha_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    thresholded = alpha.point(lambda value: 255 if value >= ALPHA_THRESHOLD else 0)
    bounds = thresholded.getbbox()
    return bounds if bounds is not None else (0, 0, 1, 1)


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
        frames = []
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
    asset_id: str,
    frames: list[FrameData],
    representative_index: int,
    multipliers: dict[str, float],
) -> float:
    bounds = frames[representative_index].bounds
    height = max(1, bounds[3] - bounds[1])
    base_scale = 1.0
    if height < KEEP_HEIGHT_MIN or height > KEEP_HEIGHT_MAX:
        base_scale = TARGET_BODY_HEIGHT / height
    multiplier = float(multipliers.get(asset_id, 1.0))
    if not math.isfinite(multiplier) or multiplier <= 0:
        raise ValueError(f"无效的素材缩放倍率：{asset_id}")
    return round(base_scale * multiplier * GLOBAL_DISPLAY_SCALE, 8)


def load_catalog() -> dict[str, Any]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("schemaVersion") != 4:
        raise ValueError("素材目录必须使用 schemaVersion 4")

    static_ids = list(catalog["staticAssets"])
    animated_ids = list(catalog["animatedAssets"])
    all_ids = static_ids + animated_ids
    if len(all_ids) != len(set(all_ids)):
        raise ValueError("素材目录存在重复 ID")
    invalid_ids = [asset_id for asset_id in all_ids if not SEMANTIC_ID.fullmatch(asset_id)]
    if invalid_ids:
        raise ValueError(f"素材 ID 格式无效：{', '.join(invalid_ids)}")

    references: list[str] = list(catalog["actions"])
    for daily in catalog["daily"]:
        references.extend([daily["idle"], *daily["hovers"]])
    for movement in catalog["movement"].values():
        animation = movement["animation"]
        if animation["type"] == "sequence":
            references.extend(frame["asset"] for frame in animation["frames"])
        elif animation["type"] == "gif":
            references.append(animation["asset"])
        else:
            raise ValueError(f"未知移动动画类型：{animation['type']}")
    references.extend(
        [
            catalog["throwBehavior"]["asset"],
            *catalog["throwBehavior"]["landingActions"],
            *catalog["playBehavior"]["swatAssets"],
            catalog["playBehavior"]["greetingAsset"],
            catalog["playBehavior"]["confusedAsset"],
            catalog["dragAsset"],
            catalog["iconAsset"],
        ]
    )
    references.extend(catalog.get("scaleMultipliers", {}).keys())
    missing = sorted(set(references) - set(all_ids))
    if missing:
        raise ValueError(f"素材目录引用了未声明 ID：{', '.join(missing)}")
    if len(catalog["actions"]) != len(set(catalog["actions"])):
        raise ValueError("普通动作列表存在重复 ID")
    return catalog


class AssetBuilder:
    def __init__(
        self,
        output_root: Path,
        static_ids: set[str],
        animated_ids: set[str],
        multipliers: dict[str, float],
    ) -> None:
        self.output_root = output_root
        self.static_ids = static_ids
        self.animated_ids = animated_ids
        self.multipliers = multipliers
        self.assets: dict[str, dict[str, Any]] = {}
        self.asset_ids_by_hash: dict[str, str] = {}

    def register(self, asset_id: str) -> str:
        if asset_id in self.assets:
            return asset_id
        if asset_id in self.static_ids:
            source_path = STATIC_ROOT / f"{asset_id}.png"
            kind = "static"
        elif asset_id in self.animated_ids:
            source_path = ANIMATED_ROOT / f"{asset_id}.gif"
            kind = "gif"
        else:
            raise KeyError(f"未声明的素材 ID：{asset_id}")
        if not source_path.is_file():
            raise FileNotFoundError(f"缺少素材：{source_path}")

        content_hash = sha256(source_path)
        duplicate_id = self.asset_ids_by_hash.get(content_hash)
        if duplicate_id is not None:
            raise ValueError(f"素材内容重复：{asset_id} 与 {duplicate_id}")

        frames, source_loop = load_frames(source_path)
        representative_index = representative_frame_index(frames)
        scale = display_scale(
            asset_id,
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
        output_key = content_hash[:20]
        asset: dict[str, Any] = {
            "id": asset_id,
            "kind": kind,
            "source": relative_source(source_path),
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
            output_relative = Path("files") / "static" / f"{output_key}.png"
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
            animation_root = Path("files") / "animated" / output_key
            copied_gif = animation_root / "source.gif"
            copied_gif_path = self.output_root / copied_gif
            copied_gif_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, copied_gif_path)

            frame_entries = []
            for index, frame in enumerate(frames):
                frame_relative = animation_root / f"frame-{index:03d}.png"
                frame.image.save(self.output_root / frame_relative, format="PNG", optimize=True)
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


def square_icon(source: Image.Image, size: int) -> Image.Image:
    rgba = source.convert("RGBA")
    cropped = rgba.crop(alpha_bounds(rgba))
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
    files = {}
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


def build_manifest(output_root: Path) -> dict[str, Any]:
    catalog = load_catalog()
    static_ids = list(catalog["staticAssets"])
    animated_ids = list(catalog["animatedAssets"])
    builder = AssetBuilder(
        output_root,
        set(static_ids),
        set(animated_ids),
        dict(catalog.get("scaleMultipliers", {})),
    )
    for asset_id in static_ids + animated_ids:
        builder.register(asset_id)

    action_ids = list(catalog["actions"])
    aliases = dict(catalog.get("dialogueAliases", {}))
    for asset_id in action_ids:
        builder.assets[asset_id]["dialogueId"] = aliases.get(asset_id, asset_id)
    static_action_ids = [
        asset_id for asset_id in action_ids if builder.assets[asset_id]["kind"] == "static"
    ]
    gif_action_ids = [
        asset_id for asset_id in action_ids if builder.assets[asset_id]["kind"] == "gif"
    ]

    icon_asset = builder.assets[catalog["iconAsset"]]
    icon_files = generate_icons(output_root, output_root / icon_asset["file"])
    return {
        "schemaVersion": 4,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "rules": {
            "dailyDelayMs": {"min": 20_000, "max": 30_000},
            "staticDurationMs": {"min": 2_000, "max": 4_000},
            "gifDurationMs": {"min": 3_000, "max": 6_000},
            "movementDurationMs": {"min": 3_000, "max": 8_000},
            "openingBubbleDurationMs": 3_500,
            "automaticActionProbability": 0.66,
            "automaticMovementProbability": 0.34,
            "movementAxisProbability": {"horizontal": 0.5, "vertical": 0.5},
            "recentLimit": 5,
            "hoverLeaveDelayMs": 120,
            "hoverTolerance": 4,
            "alphaThreshold": ALPHA_THRESHOLD,
            "baseDisplayScale": GLOBAL_DISPLAY_SCALE,
            "scaleOptions": [0.75, 1, 1.25, 1.5],
        },
        "daily": catalog["daily"],
        "actions": action_ids,
        "staticActions": static_action_ids,
        "gifActions": gif_action_ids,
        "movement": catalog["movement"],
        "throwBehavior": catalog["throwBehavior"],
        "playBehavior": catalog["playBehavior"],
        "dragAsset": catalog["dragAsset"],
        "iconAsset": catalog["iconAsset"],
        "icons": icon_files,
        "assets": builder.assets,
        "statistics": {
            "sourceFiles": len(static_ids) + len(animated_ids),
            "staticFiles": len(static_ids),
            "animatedFiles": len(animated_ids),
            "dailyPairs": len(catalog["daily"]),
            "actions": len(action_ids),
            "staticActions": len(static_action_ids),
            "gifActions": len(gif_action_ids),
            "movementBehaviors": len(catalog["movement"]),
        },
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
        (STAGING_ROOT / "manifest.json").write_text(
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
    manifest = write_generated_assets()
    statistics_data = manifest["statistics"]
    print(
        "素材准备完成："
        f"{statistics_data['sourceFiles']} 份素材，"
        f"{statistics_data['dailyPairs']} 组日常，"
        f"{statistics_data['actions']} 个普通动作，"
        f"{statistics_data['movementBehaviors']} 个移动行为"
    )


if __name__ == "__main__":
    main()
