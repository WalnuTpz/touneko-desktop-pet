from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


PROJECT_ROOT = Path(__file__).resolve().parent.parent
GENERATED_ROOT = PROJECT_ROOT / "assets" / "generated"
MANIFEST_PATH = GENERATED_ROOT / "manifest.json"
OUTPUT_ROOT = PROJECT_ROOT / "build" / "asset-catalog"

CELL_WIDTH = 480
CELL_HEIGHT = 360
COLUMNS = 4
ROWS = 4
BACKGROUND = (38, 41, 48, 255)
GRID = (72, 76, 86, 255)
BASELINE = (112, 117, 130, 255)
TEXT = (245, 246, 250, 255)


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def asset_order(manifest: dict) -> list[tuple[str, str]]:
    ordered: list[tuple[str, str]] = []
    seen: set[str] = set()
    for pair in manifest["daily"]:
        for asset_id, role in [(pair["idle"], "日常")]:
            if asset_id not in seen:
                ordered.append((asset_id, role))
                seen.add(asset_id)
        for asset_id in pair["hovers"]:
            if asset_id not in seen:
                ordered.append((asset_id, "悬停"))
                seen.add(asset_id)
    movement_ids = {
        entry["asset"]: name for name, entry in manifest["movement"].items()
    }
    for asset_id, name in movement_ids.items():
        if asset_id not in seen:
            ordered.append((asset_id, f"移动·{name}"))
            seen.add(asset_id)
    for asset_id in manifest["actions"]:
        if asset_id not in seen:
            ordered.append((asset_id, "普通动作"))
            seen.add(asset_id)
    return ordered


def render_cell(
    page: Image.Image,
    asset: dict,
    role: str,
    cell_x: int,
    cell_y: int,
    font: ImageFont.ImageFont,
) -> None:
    draw = ImageDraw.Draw(page)
    draw.rectangle(
        (cell_x, cell_y, cell_x + CELL_WIDTH - 1, cell_y + CELL_HEIGHT - 1),
        outline=GRID,
        width=1,
    )
    baseline_y = cell_y + CELL_HEIGHT - 24
    draw.line(
        (cell_x + 8, baseline_y, cell_x + CELL_WIDTH - 8, baseline_y),
        fill=BASELINE,
        width=1,
    )
    frame = asset["frames"][asset["representativeFrame"]]
    image = Image.open(GENERATED_ROOT / frame["file"]).convert("RGBA")
    scale = float(asset["displayScale"])
    width = max(1, round(image.width * scale))
    height = max(1, round(image.height * scale))
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    image_x = cell_x + (CELL_WIDTH - width) // 2
    image_y = baseline_y - height
    page.alpha_composite(image, (image_x, image_y))
    label = (
        f"{role} · {asset['name']} · {asset['kind']} · "
        f"{asset['contentBounds']['height']}px × {asset['displayScale']:.3f}"
    )
    draw.text((cell_x + 10, cell_y + 8), label, fill=TEXT, font=font)


def main() -> None:
    if not MANIFEST_PATH.exists():
        raise SystemExit("缺少 manifest.json，请先运行 npm run prepare:assets")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    ordered = asset_order(manifest)
    per_page = COLUMNS * ROWS
    page_count = math.ceil(len(ordered) / per_page)
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    font = load_font(16)

    for page_index in range(page_count):
        page = Image.new(
            "RGBA",
            (CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS),
            BACKGROUND,
        )
        start = page_index * per_page
        for local_index, (asset_id, role) in enumerate(
            ordered[start : start + per_page]
        ):
            row, column = divmod(local_index, COLUMNS)
            render_cell(
                page,
                manifest["assets"][asset_id],
                role,
                column * CELL_WIDTH,
                row * CELL_HEIGHT,
                font,
            )
        output = OUTPUT_ROOT / f"page-{page_index + 1:02d}.png"
        page.convert("RGB").save(output, quality=94)

    print(f"已生成 {page_count} 页素材尺寸目录图：{OUTPUT_ROOT}")


if __name__ == "__main__":
    main()
